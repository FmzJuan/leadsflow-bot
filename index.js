require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const RedisStore = require("connect-redis").default; // Adicionado
const IORedis = require("ioredis"); // Adicionado
const cron = require('node-cron');
const bcrypt = require('bcrypt');

// Conexão Redis para Sessões e Filas
const redisClient = new IORedis({ 
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379
});

// workers e reddis
const { adicionarAoFluxoRPA } = require('./queues/rpaqueue');
require('./workers/rpaworker');

// Importações de Motores e Funções Globais
const { connectToWhatsApp, getClientSocket } = require('./Engine/whatsapp'); 
const { query } = require('./DataBase/conection');
const { gerarRelatorioPDF } = require('./Functions/report.js');
const { salvarNoSheets, processarCampanhaPosVenda } = require('./Functions/googleSheets');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

module.exports = { io };

// --- CONFIGURAÇÕES DA DASHBOARD ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração de Sessão usando REDIS (Evita o erro de MemoryStore)
app.use(session({ 
    store: new RedisStore({ client: redisClient }), // Sessões agora ficam no Redis
    secret: process.env.SESSION_SECRET || 'secret_flow', 
    resave: false, 
    saveUninitialized: false 
}));

app.use(async (req, res, next) => {
    const host = req.headers.host;
    let subdominio = host.split('.')[0]; 

    if (host.includes('195.200.6.54')) {
        subdominio = '195.200.6.54';
    }

    if (subdominio && subdominio !== 'localhost' && subdominio !== 'www') {
        try {
            const result = await query(
                'SELECT * FROM clientes_config WHERE subdominio = $1', 
                [subdominio]
            );

            if (result.rows.length > 0) {
                req.cliente = result.rows[0]; 
                res.locals.cliente = req.cliente; 
                console.log(`✅ Oficina Identificada: ${req.cliente.nome_oficina}`);
            }
        } catch (err) {
            console.error('❌ Erro ao buscar cliente no banco:', err);
        }
    }
    next();
});

io.on('connection', (socket) => {
    console.log(`📊 Dashboard conectada ao servidor via Socket.io`);
});

// --- ROTAS DE AUTENTICAÇÃO ---
app.get('/login', (req, res) => res.render('login'));

app.post('/login', async (req, res) => {
    const username = (req.body.username || req.body.email || '').toLowerCase().trim();
    const password = (req.body.password || req.body.senha || '').trim();

    try {
        if (req.cliente) {
            const emailBanco = (req.cliente.email_contato || '').toLowerCase().trim();
            if (username === emailBanco) {
                const match = await bcrypt.compare(password, req.cliente.senha_dashboard);
                if (match) {
                    req.session.logged = true;
                    req.session.clienteId = req.cliente.id; 
                    return res.redirect('/');
                }
            }
        }
        if (username === process.env.PANEL_USER && password === process.env.PANEL_PASS) {
            req.session.logged = true;
            return res.redirect('/');
        }
        res.send('<script>alert("Usuário ou senha inválidos!"); window.location="/login";</script>');
    } catch (error) {
        console.error("🚨 Erro na autenticação:", error);
        res.status(500).send("Erro interno no servidor.");
    }
});

// --- ROTAS DO PAINEL ---
app.get('/', (req, res) => {
    if (!req.session.logged) return res.redirect('/login');
    if (!req.cliente) return res.send('<h2>Painel Admin Global</h2>');

    const statusBot = getClientSocket(req.cliente.id) ? 'conectado' : 'desconectado';
    res.render('index', { 
        sheetLink: `https://docs.google.com/spreadsheets/d/${req.cliente.google_sheets_id || process.env.SHEET_ID}`,
        nomeCliente: req.cliente.nome_oficina,
        nomeEmpresa: req.cliente.nome_oficina,
        clienteId: req.cliente.id,       
        statusAtual: statusBot           
    });
});

// TESTE PARA ENVIO DE MENSAGENS (Ajustado para pegar do Coolify/ENV)
app.get('/api/teste-post-venda', async (req, res) => {
    try {
        // Pega o primeiro número da lista permitida no Coolify
        const numeroTeste = (process.env.NUMEROS_PERMITIDOS || "").split(',')[0].trim();
        
        if (!numeroTeste) {
            return res.status(400).send("❌ Erro: Nenhum número configurado em NUMEROS_PERMITIDOS no Coolify.");
        }

        const { agendarMensagens } = require('./Chat/RissatoMotors/scheduler');
        
        const clienteTeste = {
            nome: "Cliente Teste LeadsFlow",
            telefone: numeroTeste,
            dataSaida: new Date().getTime().toString()
        };

        await agendarMensagens(clienteTeste);
        res.send(`✅ Teste enviado para a fila para o número ${numeroTeste}! Verifique o log do Worker.`);
    } catch (error) {
        res.status(500).send("Erro ao agendar teste: " + error.message);
    }
});

// --- RESTANTE DAS ROTAS (PDF, WEBHOOK, SYNC) MANTIDAS IGUAIS ---
app.get('/api/relatorio/pdf', async (req, res) => { /* ... */ });
app.post('/api/webhook/:subdominio', async (req, res) => { /* ... */ });
app.post('/api/sync-erp', async (req, res) => { /* ... */ });
app.post('/api/finalizar-servico', async (req, res) => { /* ... */ });
app.post('/api/resetar-sessao', async (req, res) => { /* ... */ });

// --- FUNÇÃO PRINCIPAL DO BOT ---
async function start() {
    console.log("🚀 LeadsFlow SaaS: Buscando clientes ativos...");
    try {
        const result = await query("SELECT id, nome_oficina, subdominio FROM clientes_config WHERE status_assinatura = 'ativo'");
        const clientes = result.rows;

        for (const cliente of clientes) {
            console.log(`⚙️ Iniciando motor para: ${cliente.nome_oficina}...`);
            
            await connectToWhatsApp(cliente.id, async (clienteId, sock, msg) => {
                const texto = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || "").toLowerCase();

                const fluxoPath = path.join(__dirname, 'Chat', cliente.subdominio, 'fluxo.js');
                if (fs.existsSync(fluxoPath)) {
                    const fluxoCliente = require(fluxoPath);
                    await fluxoCliente.executar(sock, msg);
                    if (!texto.startsWith('!') && !texto.startsWith('/')) return;
                }

                if (texto === '!disparar') {
                    await processarCampanhaPosVenda(sock, clienteId); 
                    return;
                }
            });

            // GATILHO DO WORKER
            const workerPath = path.join(__dirname, 'Chat', cliente.subdominio, 'worker.js');
            if (fs.existsSync(workerPath)) {
                const { iniciarWorker } = require(workerPath);
                
                const checkSocket = setInterval(() => {
                    const sock = getClientSocket(cliente.id);
                    if (sock) {
                        iniciarWorker(sock); 
                        console.log(`👷 Worker BullMQ ATIVADO para: ${cliente.nome_oficina}`);
                        clearInterval(checkSocket);
                    }
                }, 5000);
            }
        }
    } catch (err) {
        console.error("❌ Erro fatal ao iniciar o sistema SaaS:", err);
    }
}

// INICIALIZAÇÃO BLINDADA
const exportacoes = { app, server, io, start };

if (process.env.NODE_ENV !== 'test') {
    server.listen(3000, '0.0.0.0', () => {
        console.log("🚀 LeadsFlow SaaS Online!");
        start(); 
    });

    // CRON JOB ÚNICO (Removido a duplicata)
    cron.schedule('0 18 * * *', async () => {
        console.log("⏰ Iniciando agendamento diário na Fila BullMQ...");
        try {
            const result = await query("SELECT id, nome_oficina, subdominio FROM clientes_config WHERE status_assinatura = 'ativo'");
            for (const cliente of result.rows) {
                const credenciais = {
                    chave: process.env.ERP_CHAVE,
                    usuario: process.env.ERP_USER,
                    senha: process.env.ERP_PASS
                };
                await adicionarAoFluxoRPA(cliente.id, credenciais); 
            }
        } catch (err) { console.error("❌ Erro no Cron:", err); }
    }, { timezone: "America/Sao_Paulo" });
}

module.exports = exportacoes;