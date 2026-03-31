const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion 
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const path = require("path");
const fs = require("fs"); 

// 🏆 O "Estacionamento" de Bots: guarda quem está conectado
const sessions = new Map();

async function connectToWhatsApp(clienteId, onMessage) {
    const { io } = require('../index'); 

    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`- Iniciando WhatsApp para Cliente ID: ${clienteId} (v${version.join('.')})`);

    // Define o caminho da pasta principal "sessions"
    const sessionsDir = path.resolve(__dirname, '..', 'sessions');
    
    // Se a pasta "sessions" não existir, o bot cria ela automaticamente
    if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
    }

    // 🔒 ISOLAMENTO: Cria a pasta única do cliente DENTRO da pasta sessions
    const authPath = path.resolve(sessionsDir, `auth_info_${clienteId}`);
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true, // Deixei true para você ver no terminal por enquanto
        logger: pino({ level: 'silent' }),
        browser: [`LeadsFlow - Cliente ${clienteId}`, "Chrome", "120.0"], 
        markOnlineOnConnect: true,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            io.emit(`qr-${clienteId}`, qr); 
            io.emit(`status-${clienteId}`, 'desconectado');
        }

        if (connection === 'close') {
            io.emit(`status-${clienteId}`, 'desconectado');
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            
            // Se o cliente deslogou pelo celular OU a sessão corrompeu (401 Unauthorized)
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log(`🛑 Cliente ${clienteId} desconectou ou sessão expirou. Limpando dados...`);
                sessions.delete(clienteId); 

                // 💥 DELETA A PASTA CORROMPIDA OU DESLOGADA
                if (fs.existsSync(authPath)) {
                    fs.rmSync(authPath, { recursive: true, force: true });
                    console.log(`🗑️ Pasta de sessão do cliente ${clienteId} removida com sucesso.`);
                }

                io.emit(`new-log-${clienteId}`, { msg: `Sessão encerrada. Por favor, leia o QR Code novamente.`, type: 'error' });
                
                // Reinicia a conexão do zero para gerar um novo QR Code limpo
                setTimeout(() => connectToWhatsApp(clienteId, onMessage), 2000);

            } else {
                // Quedas normais de internet (Reconecta sem apagar a pasta)
                console.log(`⚠️ Cliente ${clienteId} caiu (Erro: ${statusCode}). Reconectando...`);
                setTimeout(() => connectToWhatsApp(clienteId, onMessage), 5000);
            }
        } else if (connection === 'open') {
            console.log(`✅ BOT DO CLIENTE ${clienteId} ONLINE!`);
            sessions.set(clienteId, sock); 
            io.emit(`status-${clienteId}`, 'conectado'); 
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        const msg = m.messages[0];
        if (!msg.message) return; 

        const from = msg.key.remoteJid;
        if (from.endsWith('@g.us')) return; // Ignora grupos

        // 🚧 MODO DE TESTE (SANDBOX): Só processa o número permitido ou comandos próprios
        const numeroPermitido = (process.env.NUMEROS_PERMITIDOS || '').split(',');
        
        // Se a mensagem não veio do número permitido E não fui eu mesmo enviando, ignora!
        if (!from.includes(numeroPermitido) && !msg.key.fromMe) {
            console.log(`[Sandbox] Ignorando mensagem do número: ${from}`);
            return;
        }

        const texto = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || "").toLowerCase();

        if (msg.key.fromMe && texto !== '!disparar' && texto !== '/relatorio') return;

        // Passa a mensagem adiante apenas se passou no filtro
        await onMessage(clienteId, sock, msg);
    });

    return sock;
}

function getClientSocket(clienteId) {
    return sessions.get(clienteId);
}

module.exports = { connectToWhatsApp, getClientSocket };