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
            // Emite o QR Code avisando de qual cliente é
            io.emit(`qr-${clienteId}`, qr); 
            io.emit(`status-${clienteId}`, 'desconectado');
        }

        if (connection === 'close') {
            io.emit(`status-${clienteId}`, 'desconectado');
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log(`⚠️ Cliente ${clienteId} caiu. Reconectando...`);
                setTimeout(() => connectToWhatsApp(clienteId, onMessage), 5000);
            } else {
                console.log(`🛑 Cliente ${clienteId} desconectou o celular.`);
                sessions.delete(clienteId); // Tira do estacionamento
            }
        } else if (connection === 'open') {
            console.log(`✅ BOT DO CLIENTE ${clienteId} ONLINE!`);
            sessions.set(clienteId, sock); // Guarda o bot pronto
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