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

async function resolverLID(lid, msg, sock) {
    const doRedis = await redis.get(`lid:${lid}`);
    if (doRedis) return doRedis;

    const participantMsg = msg.participant || msg.key?.participant;
    if (participantMsg && !participantMsg.endsWith('@lid')) {
        await redis.set(`lid:${lid}`, participantMsg);
        return participantMsg;
    }

    if (sock.store?.contacts) {
        const contato = sock.store.contacts[lid];
        if (contato?.id && !contato.id.endsWith('@lid')) {
            await redis.set(`lid:${lid}`, contato.id);
            return contato.id;
        }
    }

    try {
        const result = await query(
            `SELECT celular FROM leads WHERE lid = $1 LIMIT 1`,
            [lid]
        );
        if (result.rows[0]?.celular) {
            const jid = `${result.rows[0].celular}@s.whatsapp.net`;
            await redis.set(`lid:${lid}`, jid);
            return jid;
        }
    } catch (e) { /* ignora */ }

    try {
        const resultFallback = await query(
            `SELECT id, celular FROM leads 
             WHERE (lid IS NULL OR lid = '') 
             AND status_envio = 'enviado' 
             AND fase_bot IN ('aguardando_nps', 'aguardando_feedback_ruim')
             ORDER BY atualizado_em DESC LIMIT 1`,
            []
        );
        if (resultFallback.rows[0]) {
            const lead = resultFallback.rows[0];
            const jidFallback = `${lead.celular}@s.whatsapp.net`;
            await redis.set(`lid:${lid}`, jidFallback);
            await query(`UPDATE leads SET lid = $1 WHERE id = $2`, [lid, lead.id]);
            console.log(`[LID Mapper] 🎯 Fallback: Mapeado LID ${lid} para Lead ${lead.id} (${lead.celular})`);
            return jidFallback;
        }
    } catch (e) { /* ignora */ }

    return null;
}

// ✅ Extrai apenas os dígitos numéricos de um JID (ex: "5511976378041@s.whatsapp.net" -> "5511976378041")
function extrairNumeroDoJid(jid) {
    return (jid || '').split('@')[0].replace(/\D/g, '');
}

// ✅ Últimos N dígitos de uma string numérica
function ultimosDigitos(numStr, n = 8) {
    return numStr.slice(-n);
}

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
                sessions.delete(clienteId);
                workersAtivos.delete(clienteId);

                if (fs.existsSync(authPath)) {
                    fs.rmSync(authPath, { recursive: true, force: true });
                }

                io.emit(`new-log-${clienteId}`, { msg: `Sessão encerrada. Por favor, leia o QR Code novamente.`, type: 'error' });
                setTimeout(() => connectToWhatsApp(clienteId, onMessage, onWorker), 2000);

            } else {
                setTimeout(() => connectToWhatsApp(clienteId, onMessage, onWorker), 5000);
            }

        } else if (connection === 'open') {
            console.log(`✅ BOT DO CLIENTE ${clienteId} ONLINE!`);
            sessions.set(clienteId, sock); 
            io.emit(`status-${clienteId}`, 'conectado');

            if (onWorker && typeof onWorker === 'function' && !workersAtivos.has(clienteId)) {
                onWorker(clienteId);
                workersAtivos.add(clienteId);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('contacts.upsert', async (contacts) => {
        for (const contact of contacts) {
            if (contact.lid && contact.id && !contact.id.endsWith('@lid')) {
                await redis.set(`lid:${contact.lid}`, contact.id);
                try {
                    const numero = contact.id.replace('@s.whatsapp.net', '');
                    await query(
                        `UPDATE leads SET lid = $1 WHERE celular LIKE $2 AND (lid IS NULL OR lid = '')`,
                        [contact.lid, `%${numero}%`]
                    );
                } catch (e) { /* ignora */ }
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        const msg = m.messages[0];
        if (!msg.message) return; 

        let from = msg.key.remoteJid;

        // ✅ RESOLUÇÃO DO LID
        if (from && from.endsWith('@lid')) {
            const lidOriginal = from;
            const jidResolvido = await resolverLID(from, msg, sock);

            if (jidResolvido) {
                from = jidResolvido;
                msg.key.remoteJid = jidResolvido; 
                io.emit(`new-log-${clienteId}`, { 
                    meta: `Sistema (LID Mapper)`,
                    msg: `✅ ID Resolvido: ${lidOriginal} -> ${jidResolvido}`, 
                    type: 'success' 
                });
            } else {
                io.emit(`new-log-${clienteId}`, { 
                    meta: `Sistema (LID Mapper)`,
                    msg: `⚠️ Não foi possível resolver LID: ${lidOriginal}`, 
                    type: 'error' 
                });
                return; // Não processa se não resolveu o LID
            }
        }

        if (from.endsWith('@g.us') || from === 'status@broadcast') return;

        // ✅ LISTA BRANCA - lógica corrigida
        const envLista = (process.env.NUMEROS_PERMITIDOS || "").trim();
        const numerosPermitidos = envLista
            .split(',')
            .map(n => n.trim().replace(/\D/g, ''))  // remove tudo que não é dígito
            .filter(n => n.length > 0);

        // ✅ Extrai o número do JID de forma segura (split no '@', pega só os dígitos)
        const fromNumero = extrairNumeroDoJid(from);

        if (numerosPermitidos.length > 0 && !msg.key.fromMe) {
            const finalRecebido = ultimosDigitos(fromNumero, 8);

            const numeroAutorizado = numerosPermitidos.some(numEnv => {
                const finalEnv = ultimosDigitos(numEnv, 8);

                // ✅ LOG DE DEBUG — remova após confirmar que está funcionando
                console.log(`[WhiteList Debug] Comparando: recebido="${finalRecebido}" vs env="${finalEnv}" (original env="${numEnv}")`);

                return finalRecebido === finalEnv;
            });

            if (!numeroAutorizado) {
                io.emit(`new-log-${clienteId}`, { 
                    meta: `Desconhecido (${fromNumero})`,
                    msg: `🚫 Mensagem ignorada (Número não autorizado na Lista Branca)`, 
                    type: 'error' 
                });
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