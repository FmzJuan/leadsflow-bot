// Engine/whatsapp.js

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion 
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const path = require("path");
const fs = require("fs"); 
const redis = require("../DataBase/redis");
const { query } = require('../DataBase/conection');

const sessions = new Map();
const workersAtivos = new Set();

async function connectToWhatsApp(clienteId, onMessage, onWorker) {
    const { io } = require('../index'); 

    const { version } = await fetchLatestBaileysVersion();
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
                workersAtivos.delete(clienteId);

                if (fs.existsSync(authPath)) {
                    fs.rmSync(authPath, { recursive: true, force: true });
                    console.log(`🗑️ Pasta de sessão do cliente ${clienteId} removida com sucesso.`);
                }

                io.emit(`new-log-${clienteId}`, { msg: `Sessão encerrada. Por favor, leia o QR Code novamente.`, type: 'error' });
                setTimeout(() => connectToWhatsApp(clienteId, onMessage, onWorker), 2000);

            } else {
                console.log(`⚠️ Cliente ${clienteId} caiu (Erro: ${statusCode}). Reconectando...`);
                setTimeout(() => connectToWhatsApp(clienteId, onMessage, onWorker), 5000);
            }

        } else if (connection === 'open') {
            console.log(`✅ BOT DO CLIENTE ${clienteId} ONLINE!`);
            sessions.set(clienteId, sock); 
            io.emit(`status-${clienteId}`, 'conectado');

            if (onWorker && typeof onWorker === 'function' && !workersAtivos.has(clienteId)) {
                onWorker(sock);
                workersAtivos.add(clienteId);
                console.log(`👷 Worker BullMQ ATIVADO para cliente ${clienteId}`);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // ✅ Salva usando o LID completo como chave (ex: "lid:67319736848503@lid")
    sock.ev.on('contacts.upsert', async (contacts) => {
        for (const contact of contacts) {
            if (contact.lid && contact.id) {
                const chave = `lid:${contact.lid}`;
                await redis.set(chave, contact.id);
                console.log(`[LID Mapper] contacts.upsert → ${contact.lid} -> ${contact.id}`);

                try {
                    const numero = contact.id.replace('@s.whatsapp.net', '');
                    await query(
                        `UPDATE leads SET lid = $1 WHERE celular LIKE $2 AND (lid IS NULL OR lid = '')`,
                        [contact.lid, `%${numero}%`]
                    );
                } catch (e) {
                    console.error(`[LID Mapper] Erro ao salvar no banco:`, e.message);
                }
            }
        }
    });

    sock.ev.on('contacts.update', async (contacts) => {
        for (const contact of contacts) {
            if (contact.lid && contact.id) {
                const chave = `lid:${contact.lid}`;
                await redis.set(chave, contact.id);
                console.log(`[LID Mapper] contacts.update → ${contact.lid} -> ${contact.id}`);

                try {
                    const numero = contact.id.replace('@s.whatsapp.net', '');
                    await query(
                        `UPDATE leads SET lid = $1 WHERE celular LIKE $2 AND (lid IS NULL OR lid = '')`,
                        [contact.lid, `%${numero}%`]
                    );
                } catch (e) {
                    console.error(`[LID Mapper] Erro ao atualizar no banco:`, e.message);
                }
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        const msg = m.messages[0];
        if (!msg.message) return; 

        let from = msg.key.remoteJid;

        // ✅ CORRIGIDO: busca com o LID completo, igual ao que foi salvo no contacts.upsert
        if (from && from.endsWith('@lid')) {
            const chave = `lid:${from}`; // ex: "lid:67319736848503@lid"
            const jidMapeado = await redis.get(chave);

            if (jidMapeado) {
                console.log(`[LID Mapper] ✅ Resolvido: ${from} -> ${jidMapeado}`);
                msg.key.remoteJid = jidMapeado; // atualiza o objeto msg também
                from = jidMapeado;
            } else {
                console.warn(`[LID Mapper] ⚠️ LID sem mapeamento: ${from}. Ignorando.`);
                return;
            }
        }

        if (from.endsWith('@g.us') || from === 'status@broadcast') return;

        const envLista = process.env.NUMEROS_PERMITIDOS || "";
        const numerosPermitidos = envLista.split(',').map(n => n.trim().replace(/\D/g, '')).filter(n => n.length > 0);
        const fromLimpo = from.replace(/\D/g, '');

        if (numerosPermitidos.length > 0 && !msg.key.fromMe) {
            const numeroAutorizado = numerosPermitidos.some(numEnv => fromLimpo.includes(numEnv));
            if (!numeroAutorizado) {
                console.log(`[Sandbox] Ignorando mensagem não autorizada do número: ${from}`);
                return;
            }
        }

        const texto = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || "").toLowerCase();
        if (msg.key.fromMe && texto !== '!disparar' && texto !== '/relatorio') return;

        await onMessage(clienteId, sock, msg);
    });

    return sock;
}

function getClientSocket(clienteId) {
    return sessions.get(clienteId);
}

module.exports = { connectToWhatsApp, getClientSocket };