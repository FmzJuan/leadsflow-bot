require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const cron = require('node-cron');
const bcrypt = require('bcrypt');

// workers e reddis
const { adicionarAoFluxoRPA } = require('./queues/rpaqueue');
require('./workers/rpaworker');

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
    console.log("⏰ Iniciando agendamento diário na Fila BullMQ...");
    try {
        const result = await query("SELECT id, nome_oficina, subdominio FROM clientes_config WHERE status_assinatura = 'ativo'");
        const clientes = result.rows;

        for (const cliente of clientes) {
            console.log(`➡️ Agendando sincronização ERP para: ${cliente.nome_oficina}`);
            
            // Em produção, o ideal é puxar as credenciais do banco (cliente.erp_chave, etc).
            // Como fallback, usamos o .env para os testes atuais.
            const credenciais = {
                chave: process.env.ERP_CHAVE,
                usuario: process.env.ERP_USER,
                senha: process.env.ERP_PASS
            };

            // Ao invés de rodar o robô e travar o Node, apenas jogamos na fila!
            await adicionarAoFluxoRPA(cliente.id, credenciais); 
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
    let subdominio = host.split('.')[0]; 

    if (host.includes('195.200.6.54')) {
        subdominio = '195.200.6.54'; // Agora sim, batendo idêntico ao banco de dados!
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
                // Log para você ver no Coolify se ele achou a oficina
                console.log(`✅ Oficina Identificada: ${req.cliente.nome_oficina}`);
            }
        } catch (err) {
            console.error('❌ Erro ao buscar cliente no banco:', err);
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
    const username = (req.body.username || req.body.email || '').toLowerCase().trim();
    const password = (req.body.password || req.body.senha || '').trim();

    try {
        // Login para Clientes (Multi-tenant)
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

        // Login para Admin Global (Vem do .env)
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
    
    // Se logar como Admin ou subdomínio não identificado
    if (!req.cliente) {
        return res.send('<h2>Painel Admin Global</h2><p>Identifique-se via subdomínio de cliente para acessar a dashboard.</p>');
    }

    const statusBot = getClientSocket(req.cliente.id) ? 'conectado' : 'desconectado';

    res.render('index', { 
        sheetLink: `https://docs.google.com/spreadsheets/d/${req.cliente.google_sheets_id || process.env.SHEET_ID}`,
        nomeCliente: req.cliente.nome_oficina,
        nomeEmpresa: req.cliente.nome_oficina,
        clienteId: req.cliente.id,       
        statusAtual: statusBot           
    });
});
// teste para envio de menssagens 
app.get('/api/teste-post-venda', async (req, res) => {
    try {
        const { agendarMensagens } = require('./Chat/rissatomotors/scheduler');
        
        const clienteTeste = {
            nome: "amanda teste",
            telefone: "5511976378041",
            dataSaida: new Date().getTime().toString()
        };

        await agendarMensagens(clienteTeste);
        res.send("✅ Agendamento de teste enviado para a fila! Em 10 segundos o bot vai começar a 'digitar' para você.");
    } catch (error) {
        res.status(500).send(error.message);
    }
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
//adicionando api post para o sync da erp
app.post('/api/sync-erp', async (req, res) => {
    try {
        // req.cliente vem do seu middleware de subdomínio que já fizemos na Tarefa 2
        const clienteId = req.cliente.id; 
        
        // Em produção, as credenciais viriam do Banco de Dados
        // Para o seu teste manual agora, você pode pegar do .env
        const credenciais = {
            chave: process.env.ERP_CHAVE,
            usuario: process.env.ERP_USER,
            senha: process.env.ERP_PASS
        };

        await adicionarAoFluxoRPA(clienteId, credenciais);

        res.json({ success: true, message: "Sincronização iniciada em segundo plano!" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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

// -- ROTA DE EMERGENCIA : RESETAR A SESSAO MANUALMENTE --
app.post('/api/resetar-sessao', async (req, res) => {
    if (!req.session.logged) return res.status(401).json({ error: "Não autorizado" });
    
    const clienteId = req.cliente.id;
    console.log(`🔄 Recebido pedido de RESET MANUAL para o cliente ${clienteId}`);

    try {
        const sock = getClientSocket(clienteId);
        if (sock) {
            sock.logout(); // Desloga e a própria engine apaga a pasta
        } else {
            const authPath = path.resolve(__dirname, 'sessions', `auth_info_${clienteId}`);
            if (fs.existsSync(authPath)) {
                fs.rmSync(authPath, { recursive: true, force: true });
                console.log(`🗑️ [Reset Manual] Pasta removida na força para cliente ${clienteId}.`);
            }
            
            io.emit(`new-log-${clienteId}`, { msg: `Sistema resetado manualmente. Aguarde o novo QR Code.`, type: 'warning' });
            io.emit(`status-${clienteId}`, 'desconectado');
        }

        res.json({ success: true, message: "Sessão limpa. Escaneie o QR Code novamente." });
    } catch (error) {
        console.error("❌ Erro ao resetar sessão:", error);
        res.status(500).json({ success: false, error: "Erro interno ao resetar." });
    }
});
// --- FUNÇÃO PRINCIPAL DO BOT (MULTI-TENANT) ---
async function start() {
    console.log("🚀 LeadsFlow SaaS: Buscando clientes ativos...");
    
    try {
        const result = await query("SELECT id, nome_oficina, subdominio FROM clientes_config WHERE status_assinatura = 'ativo'");
        const clientes = result.rows;

        for (const cliente of clientes) {
            console.log(`⚙️ Iniciando motor para: ${cliente.nome_oficina}...`);
            
            await connectToWhatsApp(cliente.id, async (clienteId, sock, msg, onlySave = false) => {
                // --- ISSO AQUI É O GATILHO DE MENSAGENS RECEBIDAS ---
                const from = msg.key.remoteJid;
                const nome = msg.pushName || "Cliente";
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
                // ... (restante do seu código de comandos e salvamento de leads)
            });

            // --- A CORREÇÃO ESTÁ AQUI ---
            // Precisamos esperar um pouco o socket estabilizar ou injetar o worker quando o evento 'open' ocorrer
            // Por agora, para testarmos rápido, vamos forçar a inicialização do Worker 
            // garantindo que ele tenha acesso ao socket assim que ele logar.
            
            const workerPath = path.join(__dirname, 'Chat', cliente.subdominio, 'worker.js');
            if (fs.existsSync(workerPath)) {
                const { iniciarWorker } = require(workerPath);
                
                // Criamos um intervalo pequeno para checar se o socket já existe
                const checkSocket = setInterval(() => {
                    const sock = getClientSocket(cliente.id);
                    if (sock) {
                        iniciarWorker(sock); 
                        console.log(`👷 Worker BullMQ ATIVADO para: ${cliente.nome_oficina}`);
                        clearInterval(checkSocket); // Para de checar
                    }
                }, 5000); // Checa a cada 5 segundos até conectar
            }
        }
    } catch (err) {
        console.error("❌ Erro fatal ao iniciar o sistema SaaS:", err);
    }
}

// Inicia o Servidor
/*server.listen(3000, '0.0.0.0', () => {
    console.log("🚀 LeadsFlow SaaS Online!");
    console.log("🌐 Local: http://localhost:3000");
    console.log("🌍 Produção: http://195.200.6.54:3000");
    start(); 
});*/
// 1. Criamos um objeto com tudo o que o sistema precisa exportar
const exportacoes = { app, server, io, start };

// 2. Trava de segurança para Cron e Listen (Não rodam em modo de teste)
if (process.env.NODE_ENV !== 'test') {
    // Só inicia o servidor se não for teste
    server.listen(3000, '0.0.0.0', () => {
        console.log("🚀 LeadsFlow SaaS Online!");
        start(); 
    });

    // --- CRON JOB MULTI-TENANT BLINDADO ---
    cron.schedule('0 18 * * *', async () => {
        console.log("⏰ Iniciando agendamento diário na Fila BullMQ...");
        try {
            const result = await query("SELECT id, nome_oficina, subdominio FROM clientes_config WHERE status_assinatura = 'ativo'");
            const clientes = result.rows;

            for (const cliente of clientes) {
                console.log(`➡️ Agendando sincronização ERP para: ${cliente.nome_oficina}`);
                
                // Em produção, o ideal é puxar as credenciais do banco.
                const credenciais = {
                    chave: process.env.ERP_CHAVE,
                    usuario: process.env.ERP_USER,
                    senha: process.env.ERP_PASS
                };

                // Jogamos na fila sem travar a thread principal!
                await adicionarAoFluxoRPA(cliente.id, credenciais); 
            }
        } catch (err) {
            console.error("❌ Erro no Cron Job Multi-tenant:", err);
        }
    }, {
        timezone: "America/Sao_Paulo"
    });
}

// 3. Exportação Única e Limpa
module.exports = exportacoes;