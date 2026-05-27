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
const sessionStores = new Map();

function criarContactStore() {
    const contacts = {};

    function bind(ev) {
        ev.on('contacts.upsert', (lista) => {
            for (const c of lista) {
                if (c.id) contacts[c.id] = c;
                if (c.lid) contacts[c.lid] = c;
            }
        });
        ev.on('contacts.update', (updates) => {
            for (const upd of updates) {
                const id = upd.id || upd.lid;
                if (id) contacts[id] = { ...(contacts[id] || {}), ...upd };
            }
        });
    }

    return { contacts, bind };
}

async function resolverLID(lid, msg, sock) {
    // 1️⃣ Cache Redis — mais rápido
    const doRedis = await redis.get(`lid:${lid}`);
    if (doRedis) return doRedis;

    // 2️⃣ Campo participant da mensagem
    const participantMsg = msg.participant || msg.key?.participant;
    if (participantMsg && !participantMsg.endsWith('@lid')) {
        await redis.set(`lid:${lid}`, participantMsg, 'EX', 604800);
        return participantMsg;
    }

    // 3️⃣ Store em memória desta sessão
    const store = sessionStores.get(sock._clienteId);
    if (store?.contacts) {
        const contato = store.contacts[lid];
        if (contato?.id && !contato.id.endsWith('@lid')) {
            const jidLimpo = `${contato.id.split('@')[0].replace(/\D/g, '')}@s.whatsapp.net`;
            await redis.set(`lid:${lid}`, jidLimpo, 'EX', 604800);
            return jidLimpo;
        }
    }

    // 4️⃣ Banco de dados — campo lid já salvo
    try {
        const result = await query(
            `SELECT celular FROM leads WHERE lid = $1 LIMIT 1`,
            [lid]
        );
        if (result.rows[0]?.celular) {
            const celularLimpo = result.rows[0].celular.replace(/\D/g, '');
            const jid = `${celularLimpo}@s.whatsapp.net`;
            await redis.set(`lid:${lid}`, jid, 'EX', 604800);
            return jid;
        }
    } catch (e) {
        console.error(`[resolverLID] Erro banco (lid salvo) para ${lid}:`, e.message);
    }

    // 5️⃣ FALLBACK — busca lead aguardando resposta que ainda não tem LID mapeado
    // Essencial para o primeiro contato após envio da mensagem de NPS
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
            const celularLimpo = lead.celular.replace(/\D/g, '');
            const jidFallback = `${celularLimpo}@s.whatsapp.net`;

            await redis.set(`lid:${lid}`, jidFallback, 'EX', 604800);
            await query(`UPDATE leads SET lid = $1 WHERE id = $2`, [lid, lead.id]);

            console.log(`[LID Mapper] 🎯 Fallback: Mapeado LID ${lid} -> Lead ${lead.id} (${celularLimpo})`);
            return jidFallback;
        }
    } catch (e) {
        console.error(`[resolverLID] Erro banco (fallback) para ${lid}:`, e.message);
    }

    return null;
}

function extrairNumeroDoJid(jid) {
    return (jid || '').split('@')[0].replace(/\D/g, '');
}

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
        printQRInTerminal: false, // ✅ Remove warning de deprecated
        logger: pino({ level: 'silent' }),
        browser: [`LeadsFlow - Cliente ${clienteId}`, "Chrome", "120.0"], 
        markOnlineOnConnect: true,
    });

    const store = criarContactStore();
    store.bind(sock.ev);
    sessionStores.set(clienteId, store);
    sock._clienteId = clienteId;

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
                sessionStores.delete(clienteId);

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

    // ✅ Salva mapeamento LID->JID no Redis e no banco ao receber contatos
    sock.ev.on('contacts.upsert', async (contacts) => {
        for (const contact of contacts) {
            if (contact.lid && contact.id && !contact.id.endsWith('@lid')) {
                const jidLimpo = `${contact.id.split('@')[0].replace(/\D/g, '')}@s.whatsapp.net`;
                await redis.set(`lid:${contact.lid}`, jidLimpo, 'EX', 604800);
                console.log(`[Contacts Upsert] Mapeado: ${contact.lid} -> ${jidLimpo}`);
                try {
                    const numero = contact.id.replace('@s.whatsapp.net', '').replace(/\D/g, '');
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

        // ✅ Resolução de LID
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
                return;
            }
        }

        if (from.endsWith('@g.us') || from === 'status@broadcast') return;

        // ✅ Lista branca
        const envLista = (process.env.NUMEROS_PERMITIDOS || "").trim();
        const numerosPermitidos = envLista
            .split(',')
            .map(n => n.trim().replace(/\D/g, ''))
            .filter(n => n.length > 0);

        const fromNumero = extrairNumeroDoJid(from);

        if (numerosPermitidos.length > 0 && !msg.key.fromMe) {
            const finalRecebido = ultimosDigitos(fromNumero, 8);

            const numeroAutorizado = numerosPermitidos.some(numEnv => {
                const finalEnv = ultimosDigitos(numEnv, 8);
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