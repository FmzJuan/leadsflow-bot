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

const sessions = new Map();
const workersAtivos = new Set(); // ✅ Evita ativar o worker mais de uma vez

async function connectToWhatsApp(clienteId, onMessage, onWorker) {
    const { io } = require('../index'); 

    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`- Iniciando WhatsApp para Cliente ID: ${clienteId} (v${version.join('.')})`);

    const sessionsDir = path.resolve(__dirname, '..', 'sessions');
    if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
    }

    const authPath = path.resolve(sessionsDir, `auth_info_${clienteId}`);
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
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
            
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log(`🛑 Cliente ${clienteId} desconectou ou sessão expirou. Limpando dados...`);
                sessions.delete(clienteId);
                workersAtivos.delete(clienteId); // ✅ Permite reativar na reconexão

                if (fs.existsSync(authPath)) {
                    fs.rmSync(authPath, { recursive: true, force: true });
                    console.log(`🗑️ Pasta de sessão do cliente ${clienteId} removida com sucesso.`);
                }

                io.emit(`new-log-${clienteId}`, { msg: `Sessão encerrada. Por favor, leia o QR Code novamente.`, type: 'error' });
                setTimeout(() => connectToWhatsApp(clienteId, onMessage, onWorker), 2000); // ✅ passa onWorker

            } else {
                console.log(`⚠️ Cliente ${clienteId} caiu (Erro: ${statusCode}). Reconectando...`);
                setTimeout(() => connectToWhatsApp(clienteId, onMessage, onWorker), 5000); // ✅ passa onWorker
            }

        } else if (connection === 'open') {
            console.log(`✅ BOT DO CLIENTE ${clienteId} ONLINE!`);
            sessions.set(clienteId, sock); 
            io.emit(`status-${clienteId}`, 'conectado');

            // ✅ Ativa o worker UMA ÚNICA VEZ
            if (onWorker && typeof onWorker === 'function' && !workersAtivos.has(clienteId)) {
                onWorker(sock);
                workersAtivos.add(clienteId);
                console.log(`👷 Worker BullMQ ATIVADO para cliente ${clienteId}`);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        const msg = m.messages[0];
        if (!msg.message) return; 

        const from = msg.key.remoteJid;
        if (from.endsWith('@g.us') || from === 'status@broadcast') return;

        // 🛡️ NOVO SANDBOX INTELIGENTE
        const envLista = process.env.NUMEROS_PERMITIDOS || "";
        const numerosPermitidos = envLista.split(',').map(n => n.trim().replace(/\D/g, '')).filter(n => n.length > 0);
        const fromLimpo = from.replace(/\D/g, ''); // Tira o @lid e @s.whatsapp.net para comparar

        // Se a trava estiver ativada no .env e não for mensagem do próprio bot
        if (numerosPermitidos.length > 0 && !msg.key.fromMe) {
            const numeroAutorizado = numerosPermitidos.some(numEnv => fromLimpo.includes(numEnv));

            if (!numeroAutorizado) {
                console.log(`[Sandbox] Ignorando mensagem não autorizada do número: ${from}`);
                return;
            }
        }

        const texto = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || "").toLowerCase();

        if (msg.key.fromMe && texto !== '!disparar' && texto !== '/relatorio') return;

        // Se chegou aqui, passou pelo Sandbox! Manda para o fluxo.js
        await onMessage(clienteId, sock, msg);
    });

    return sock;
}

function getClientSocket(clienteId) {
    return sessions.get(clienteId);
}

module.exports = { connectToWhatsApp, getClientSocket };