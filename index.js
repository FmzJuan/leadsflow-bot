// index.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

const sessionConfig = require('./config/session');
const tenantMiddleware = require('./middlewares/tenant');

const { connectToWhatsApp, getClientSocket } = require('./Engine/whatsapp'); 
const { query } = require('./DataBase/conection');
const { adicionarAoFluxoRPA } = require('./queues/rpaqueue');
require('./workers/rpaworker');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- CONFIGURAÇÕES GLOBAIS ---
app.set('view engine', 'ejs');
app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionConfig);
app.use(tenantMiddleware);
app.get('/health', (req, res) => res.status(200).send('OK'));

// --- ROTAS MODULARIZADAS ---
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const apiRoutes = require('./routes/api');

app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/api', apiRoutes);

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    console.log(`📊 Dashboard conectada ao servidor via Socket.io`);
});

// --- FUNÇÃO AUXILIAR PARA AUTO-MIGRAÇÃO DO BANCO ---
async function verificarEInicializarBanco() {
    try {
        const sqlPath = path.join(__dirname, 'DataBase', 'init.sql');
        
        if (fs.existsSync(sqlPath)) {
            const sqlConteudo = fs.readFileSync(sqlPath, 'utf8');
            await query(sqlConteudo);
            console.log("🗄️ [Banco de Dados] Tabelas e sementes checadas/criadas com sucesso!");
        } else {
            console.warn("⚠️ [Banco de Dados] Arquivo init.sql não encontrado para auto-inicialização.");
        }
    } catch (err) {
        console.error("❌ [Banco de Dados] Erro crítico ao executar o init.sql:", err);
    }
}

// --- FUNÇÃO PRINCIPAL DO BOT ---
async function start() {
    await verificarEInicializarBanco();

    console.log("🚀 LeadsFlow SaaS: Buscando clientes ativos...");
    try {
        const result = await query("SELECT id, nome_oficina, subdominio FROM clientes_config WHERE status_assinatura = 'ativo'");
        const clientes = result.rows;

 for (const cliente of clientes) {
            console.log(`⚙️ Iniciando motor para: ${cliente.nome_oficina}...`);

            // 1. Defina a variável do Worker
            let funcaoWorker = null;

            const workerPath = path.join(__dirname, 'Chat', cliente.subdominio, 'worker.js');
            if (fs.existsSync(workerPath)) {
                const { iniciarWorker } = require(workerPath);
                
                if (typeof iniciarWorker === 'function') {
                    funcaoWorker = iniciarWorker; 
                    funcaoWorker(cliente.id);    
                    console.log(`👷 Worker BullMQ iniciado para: ${cliente.nome_oficina}`);
                }
            }

            // 👇👇👇 AQUI ESTÁ O QUE FULTOU NO SEU CÓDIGO 👇👇👇
            const cronPath = path.join(__dirname, 'Chat', cliente.subdominio, 'cron.js');
            if (fs.existsSync(cronPath)) {
                const cronCliente = require(cronPath);
                if (typeof cronCliente.iniciarCronJobs === 'function') {
                    cronCliente.iniciarCronJobs();
                    console.log(`⏰ CronJob ativado para a oficina: ${cliente.nome_oficina}`);
                }
            }
            // 👆👆👆 ------------------------------------------ 👆👆👆

            // 2. Agora chama a Engine do WhatsApp
            await connectToWhatsApp(cliente.id, async (clienteId, sock, msg) => {
                const fluxoPath = path.join(__dirname, 'Chat', cliente.subdominio, 'fluxo.js');
                if (fs.existsSync(fluxoPath)) {
                    const fluxoCliente = require(fluxoPath);
                    await fluxoCliente.executar(sock, msg, io, clienteId);
                }
            }, funcaoWorker); 
        }
    } catch (err) {
        console.error("❌ Erro fatal ao iniciar o sistema SaaS:", err);
    }
}

if (process.env.NODE_ENV !== 'test') {
    server.listen(3000, '0.0.0.0', () => {
        console.log("🚀 LeadsFlow SaaS Online!");
        
        if (process.env.DISABLE_WHATSAPP !== 'true') {
            start();
        } else {
            console.log("🛠️ [DEV] Motor WhatsApp desativado.");
        }
    });

    cron.schedule('0 8 * * *', async () => {
        console.log("⏰ Iniciando agendamento diário na Fila BullMQ...");
        try {
            const result = await query(`
                SELECT id, nome_oficina, subdominio, erp_chave, erp_user, erp_pass 
                FROM clientes_config 
                WHERE status_assinatura = 'ativo'
            `);

            for (const cliente of result.rows) {
                const credenciais = {
                    chave: cliente.erp_chave,
                    usuario: cliente.erp_user,
                    senha: cliente.erp_pass
                };

                if (!credenciais.chave || !credenciais.usuario || !credenciais.senha) {
                    console.warn(`⚠️ [Sincronização] Cliente ${cliente.nome_oficina} ignorado: Credenciais ERP ausentes.`);
                    continue;
                }

                console.log(`[Queue] Job de sincronização agendado para: ${cliente.nome_oficina}`);
                await adicionarAoFluxoRPA(cliente.id, credenciais); 
            }
        } catch (err) {
            console.error("❌ Erro no Cron Job de Sincronização:", err);
        }
    }, { timezone: "America/Sao_Paulo" });
}

// ✅ APENAS UMA EXPORTAÇÃO COMPLETA NO FINAL DO ARQUIVO
module.exports = { app, server, io, start };