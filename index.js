require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const RedisStore = require("connect-redis").default; // .default é essencial para v7+
const IORedis = require("ioredis");
const cron = require('node-cron');
const bcrypt = require('bcrypt');

// Configuração do Cliente Redis para Sessões e Filas
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

// Exportamos o 'io' para o whatsapp.js conseguir usar
module.exports = { io };

// --- CONFIGURAÇÕES DA DASHBOARD ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// SESSÃO CONFIGURADA COM REDIS (Blindagem contra crash e memory leak)
app.use(session({ 
    store: new RedisStore({ 
        client: redisClient,
        prefix: "leadsflow_sess:" 
    }),
    secret: process.env.SESSION_SECRET || 'secret_flow', 
    resave: false, 
    saveUninitialized: false,
    cookie: {
        secure: false, // Defina como true se usar HTTPS (SSL)
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 // 1 dia de validade
    }
}));

// Middleware de Identificação de Cliente (Multi-tenant)
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

// Lógica de Socket.io
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

// TESTE DE ENVIO (Puxando número do Coolify/ENV)
app.get('/api/teste-post-venda', async (req, res) => {
    try {
        const numeroDestino = (process.env.NUMEROS_PERMITIDOS || "").split(',')[0].trim();
        
        if (!numeroDestino) {
            throw new Error("Nenhum número configurado em NUMEROS_PERMITIDOS no Coolify.");
        }

        const { agendarMensagens } = require('./Chat/RissatoMotors/scheduler');
        
        const clienteTeste = {
            nome: "Amanda Teste LeadsFlow",
            telefone: numeroDestino,
            dataSaida: new Date().getTime().toString()
        };

        await agendarMensagens(clienteTeste);
        res.send(`✅ Teste enviado para a fila para o número ${numeroDestino}! O bot processará em breve.`);
    } catch (error) {
        res.status(500).send("Erro no agendamento: " + error.message);
    }
});

app.get('/api/relatorio/pdf', async (req, res) => {
    if (!req.session.logged) return res.status(401).send("Não autorizado");
    try {
        const { filePath } = await gerarRelatorioPDF(req.cliente.id);
        res.download(filePath, 'Relatorio_LeadsFlow.pdf', (err) => {
            if (!err && fs.existsSync(filePath)) fs.unlinkSync(filePath); 
        });
    } catch (error) {
        res.status(500).send("Erro ao gerar relatório.");
    }
});

app.post('/api/webhook/:subdominio', async (req, res) => {
    const subdominio = req.params.subdominio;
    const token = req.headers['authorization'];
    try {
        const result = await query('SELECT api_token FROM clientes_config WHERE subdominio = $1', [subdominio]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Cliente não encontrado." });
        if (token !== `Bearer ${result.rows[0].api_token}`) return res.status(403).json({ error: "Token inválido." });

        const apiPath = path.join(__dirname, 'Chat', subdominio, 'api.js');
        if (fs.existsSync(apiPath)) {
            require(apiPath).receberDadosERP(req, res);
        } else {
            res.status(501).json({ error: "Integração não implementada." });
        }
    } catch (err) { res.status(500).json({ error: "Erro interno." }); }
});

app.post('/api/sync-erp', async (req, res) => {
    try {
        const credenciais = { chave: process.env.ERP_CHAVE, usuario: process.env.ERP_USER, senha: process.env.ERP_PASS };
        await adicionarAoFluxoRPA(req.cliente.id, credenciais);
        res.json({ success: true, message: "Sincronização iniciada!" });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/resetar-sessao', async (req, res) => {
    if (!req.session.logged) return res.status(401).json({ error: "Não autorizado" });
    const clienteId = req.cliente.id;
    try {
        const sock = getClientSocket(clienteId);
        if (sock) { sock.logout(); } 
        else {
            const authPath = path.resolve(__dirname, 'sessions', `auth_info_${clienteId}`);
            if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true });
        }
        res.json({ success: true, message: "Sessão limpa." });
    } catch (error) { res.status(500).json({ success: false }); }
});

// --- FUNÇÃO PRINCIPAL DO BOT ---
async function start() {
    console.log("🚀 LeadsFlow SaaS: Buscando clientes ativos...");
    try {
        const result = await query("SELECT id, nome_oficina, subdominio FROM clientes_config WHERE status_assinatura = 'ativo'");
        for (const cliente of result.rows) {
            console.log(`⚙️ Iniciando motor para: ${cliente.nome_oficina}...`);
            
            await connectToWhatsApp(cliente.id, async (clienteId, sock, msg) => {
                const texto = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || "").toLowerCase();
                const fluxoPath = path.join(__dirname, 'Chat', cliente.subdominio, 'fluxo.js');
                
                if (fs.existsSync(fluxoPath)) {
                    require(fluxoPath).executar(sock, msg);
                    if (!texto.startsWith('!') && !texto.startsWith('/')) return;
                }

                if (texto === '!disparar') {
                    await processarCampanhaPosVenda(sock, clienteId); 
                }
            });

            // INICIALIZAÇÃO DO WORKER BULLMQ
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
    } catch (err) { console.error("❌ Erro fatal no SaaS:", err); }
}

const exportacoes = { app, server, io, start };

// EXECUÇÃO DO SERVIDOR E CRON
if (process.env.NODE_ENV !== 'test') {
    server.listen(3000, '0.0.0.0', () => {
        console.log("🚀 LeadsFlow SaaS Online!");
        start(); 
    });

    cron.schedule('0 18 * * *', async () => {
        console.log("⏰ Iniciando agendamento diário na Fila BullMQ...");
        try {
            const result = await query("SELECT id, nome_oficina, subdominio FROM clientes_config WHERE status_assinatura = 'ativo'");
            for (const cliente of result.rows) {
                const credenciais = { chave: process.env.ERP_CHAVE, usuario: process.env.ERP_USER, senha: process.env.ERP_PASS };
                await adicionarAoFluxoRPA(cliente.id, credenciais); 
            }
        } catch (err) { console.error("❌ Erro no Cron:", err); }
    }, { timezone: "America/Sao_Paulo" });
}

module.exports = exportacoes;