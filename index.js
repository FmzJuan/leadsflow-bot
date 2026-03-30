require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const cron = require('node-cron');

// Importações de Motores e Funções Globais
const { connectToWhatsApp, getClientSocket } = require('./Engine/whatsapp'); 
const { query } = require('./DataBase/conection');
const { gerarRelatorioPDF } = require('./Functions/report.js');
const { salvarNoSheets, processarCampanhaPosVenda } = require('./Functions/googleSheets');

// IMPORTAÇÕES DINÂMICAS: Removemos o require() fixo da Rissato daqui.

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Variável global para rastrear o status da conexão
let botConectado = false;

// Exportamos o 'io' para o whatsapp.js conseguir usar (QR Code, Status)
module.exports = { io };

// --- CRON JOB MULTI-TENANT ---
// Agenda para rodar todo dia às 18:00 para TODOS os clientes ativos
cron.schedule('0 18 * * *', async () => {
    console.log("⏰ Iniciando sincronização diária com ERPs...");
    try {
        const result = await query("SELECT id, nome_oficina, subdominio FROM clientes_config WHERE status_assinatura = 'ativo'");
        const clientes = result.rows;

        for (const cliente of clientes) {
            // Tenta carregar o erpSync do cliente específico
            const erpPath = path.join(__dirname, 'Chat', cliente.subdominio, 'erpSync.js');
            if (fs.existsSync(erpPath)) {
                console.log(`➡️ Sincronizando ERP de: ${cliente.nome_oficina}`);
                const { extrairDadosDoERP } = require(erpPath);
                // Passa o cliente.id para o erpSync saber de qual banco/planilha puxar
                await extrairDadosDoERP(cliente.id); 
            } else {
                console.log(`⏭️ Cliente ${cliente.nome_oficina} não possui integração ERP configurada.`);
            }
        }
    } catch (err) {
        console.error("❌ Erro no Cron Job Multi-tenant:", err);
    }
}, {
    timezone: "America/Sao_Paulo"
});

// --- CONFIGURAÇÕES DA DASHBOARD ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ 
    secret: process.env.SESSION_SECRET || 'secret_flow', 
    resave: false, 
    saveUninitialized: true 
}));

app.use(async (req, res, next) => {
    const host = req.headers.host;
    const subdominio = host.split('.')[0]; 

    if (subdominio && subdominio !== 'localhost' && subdominio !== 'www') {
        try {
            const result = await query(
                'SELECT * FROM clientes_config WHERE subdominio = $1', 
                [subdominio]
            );

            if (result.rows.length > 0) {
                req.cliente = result.rows[0]; 
                res.locals.cliente = req.cliente; 
                console.log(`✅ Acesso identificado: ${req.cliente.nome_oficina}`);
            } else {
                return res.status(404).send('Oficina não encontrada no sistema.');
            }
        } catch (err) {
            console.error('Erro ao buscar cliente:', err);
        }
    }
    next();
});

// --- LÓGICA DE SINCRONIZAÇÃO INSTANTÂNEA ---
io.on('connection', (socket) => {
    console.log(`📊 Dashboard conectada ao servidor via Socket.io`);
});

// --- ROTAS DE AUTENTICAÇÃO ---
app.get('/login', (req, res) => res.render('login'));

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (req.cliente) {
        if (username === req.cliente.email_contato && password === req.cliente.senha_dashboard) {
            req.session.logged = true;
            req.session.clienteId = req.cliente.id; 
            return res.redirect('/');
        }
    }

    if (username === process.env.PANEL_USER && password === process.env.PANEL_PASS) {
        req.session.logged = true;
        return res.redirect('/');
    }

    res.send('<script>alert("Usuário ou senha inválidos para este subdomínio!"); window.location="/login";</script>');
});

// --- ROTAS DO PAINEL ---
app.get('/', (req, res) => {
    if (!req.session.logged) return res.redirect('/login');
    
    const statusBot = getClientSocket(req.cliente.id) ? 'conectado' : 'desconectado';

    res.render('index', { 
        sheetLink: `https://docs.google.com/spreadsheets/d/${req.cliente.google_sheets_id || process.env.SHEET_ID}`,
        nomeCliente: req.cliente.nome_oficina,
        nomeEmpresa: req.cliente.nome_oficina,
        clienteId: req.cliente.id,       
        statusAtual: statusBot           
    });
});

app.get('/api/relatorio/pdf', async (req, res) => {
    if (!req.session.logged) return res.status(401).send("Não autorizado");
    try {
        const { filePath } = await gerarRelatorioPDF(req.cliente.id);
        res.download(filePath, 'Relatorio_LeadsFlow.pdf', (err) => {
            if (!err) {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath); 
            }
        });
    } catch (error) {
        console.error("Erro ao gerar PDF via Web:", error);
        res.status(500).send("Erro ao gerar relatório.");
    }
});

// --- WEBHOOKS DE INTEGRAÇÃO (ERP) ---
// Transformado em uma rota genérica /api/webhook/:subdominio
app.post('/api/webhook/:subdominio', async (req, res) => {
    const subdominio = req.params.subdominio;
    const token = req.headers['authorization'];

    try {
        const result = await query('SELECT api_token FROM clientes_config WHERE subdominio = $1', [subdominio]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Cliente não encontrado." });
        
        const tokenCliente = result.rows[0].api_token;
        
        if (token !== `Bearer ${tokenCliente}`) {
            console.log(`⚠️ [Segurança] Tentativa de acesso bloqueada no webhook do cliente ${subdominio}.`);
            return res.status(403).json({ error: "Acesso Negado. Token inválido." });
        }

        const apiPath = path.join(__dirname, 'Chat', subdominio, 'api.js');
        if (fs.existsSync(apiPath)) {
            const clienteApi = require(apiPath);
            clienteApi.receberDadosERP(req, res);
        } else {
            return res.status(501).json({ error: "Integração não implementada para este cliente." });
        }
    } catch (err) {
        console.error(`Erro no webhook do cliente ${subdominio}:`, err);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

app.post('/api/finalizar-servico', async (req, res) => {
    try {
        // Como o botão está na Dashboard, pegamos o subdomínio da requisição
        const subdominio = req.headers.host.split('.')[0];
        const { nome, telefone } = req.body;
        
        const schedulerPath = path.join(__dirname, 'Chat', subdominio, 'scheduler.js');
        if (fs.existsSync(schedulerPath)) {
            const { agendarMensagens } = require(schedulerPath);
            await agendarMensagens({
                nome: nome,
                telefone: telefone,
                dataSaida: new Date().toLocaleDateString()
            });
            res.json({ success: true, message: "Agendado no sistema com sucesso!" });
        } else {
            res.status(501).json({ success: false, error: "Agendamento não configurado para este cliente." });
        }
    } catch (error) {
        console.error("Erro na API de agendamento:", error);
        res.status(500).json({ success: false, error: "Erro ao agendar" });
    }
});

// --- FUNÇÃO PRINCIPAL DO BOT (MULTI-TENANT) ---
async function start() {
    console.log("🚀 LeadsFlow SaaS: Buscando clientes ativos no banco de dados...");
    
    try {
        const result = await query("SELECT id, nome_oficina, subdominio FROM clientes_config WHERE status_assinatura = 'ativo'");
        const clientes = result.rows;

        if (clientes.length === 0) {
            console.log("⚠️ Nenhum cliente ativo encontrado no banco.");
            return;
        }

        for (const cliente of clientes) {
            console.log(`⚙️ Iniciando motor para: ${cliente.nome_oficina}...`);
            
            await connectToWhatsApp(cliente.id, async (clienteId, sock, msg, onlySave = false) => {
                const from = msg.key.remoteJid;
                const nome = msg.pushName || "Cliente";
                const texto = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || "").toLowerCase();

                // 1. GATILHO DO MÓDULO DO CLIENTE ESPECÍFICO (ROTEAMENTO DINÂMICO)
                const fluxoPath = path.join(__dirname, 'Chat', cliente.subdominio, 'fluxo.js');
                if (fs.existsSync(fluxoPath)) {
                    const fluxoCliente = require(fluxoPath);
                    await fluxoCliente.executar(sock, msg);
                if (!texto.startsWith('!') && !texto.startsWith('/')) return;                }

                // 2. COMANDOS DE ADMINISTRADOR
                if (texto === '!disparar') {
                    io.emit(`new-log-${clienteId}`, { msg: `⚡ Comando !disparar recebido`, type: 'success' });
                    await sock.sendMessage(from, { text: "⏳ Iniciando processamento da lista de pós-venda..." });
                    await processarCampanhaPosVenda(sock, clienteId); 
                    return;
                }
                if (texto === '/relatorio') {
                    io.emit(`new-log-${clienteId}`, { msg: `📄 Gerando PDF para o admin ${nome}...` });
                    await sock.sendMessage(from, { text: "⏳ Gerando seu relatório PDF..." });
                    try {
                        const { filePath } = await gerarRelatorioPDF(clienteId);
                        await sock.sendMessage(from, { 
                            document: fs.readFileSync(filePath), 
                            fileName: 'Relatorio_Leads.pdf', 
                            mimetype: 'application/pdf' 
                        });
                        fs.unlinkSync(filePath); 
                        io.emit(`new-log-${clienteId}`, { msg: `✅ Relatório enviado com sucesso via WhatsApp.`, type: 'success' });
                    } catch (error) {
                        console.error("Erro PDF via comando:", error);
                        io.emit(`new-log-${clienteId}`, { msg: `❌ Erro ao gerar PDF: ${error.message}` });
                    }
                    return; 
                }

                // 3. SALVAMENTO AUTOMÁTICO DE LEADS
                const numeroLimpo = from.replace(/\D/g, ''); 
                const dataHora = new Date().toLocaleString('pt-BR');

                try {
                    io.emit(`new-log-${clienteId}`, { msg: `👤 Novo lead detectado: ${nome} (${numeroLimpo})` });
                    
                    await query(
                        `INSERT INTO leads (cliente_id, nome, celular) 
                         VALUES ($1, $2, $3) 
                         ON CONFLICT DO NOTHING`, 
                        [clienteId, nome, numeroLimpo]
                    );

                   const dadosParaPlanilha = [dataHora, nome, numeroLimpo, `https://wa.me/${numeroLimpo}`, "Lead Novo", from];
                   await salvarNoSheets(dadosParaPlanilha, clienteId);
                   io.emit(`new-log-${clienteId}`, { msg: `📊 Lead ${nome} salvo no Google Sheets.`, type: 'success' });
                    
                    if (!onlySave && texto !== '!disparar') {
                        // Mensagem genérica caso o fluxo.js não exista
                        if(!fs.existsSync(fluxoPath)){
                            await sock.sendMessage(from, { 
                                text: `Olá ${nome}! O sistema da oficina está ativo.` 
                            });
                        }
                    }
                } catch (err) {
                    console.error("❌ Erro no processamento de lead:", err);
                }
            });

            // 💡 ADICIONE ISSO AQUI:
            // Liga o Worker do BullMQ para este cliente específico
            const workerPath = path.join(__dirname, 'Chat', cliente.subdominio, 'worker.js');
            if (fs.existsSync(workerPath)) {
                const { iniciarWorker } = require(workerPath);
                // Pegamos o socket que acabou de ser conectado
                const sock = getClientSocket(cliente.id);
                if (sock) {
                    iniciarWorker(sock); 
                    console.log(`👷 Worker BullMQ ativado para: ${cliente.nome_oficina}`);
                }
            }
        }
    } catch (err) {
        console.error("❌ Erro fatal ao iniciar o sistema SaaS:", err);
    }
}


// Inicia o Servidor
server.listen(3000, () => {
    console.log("🌐 Painel LeadsFlow: http://rissatomotors.localhost:3000");
    start(); 
});