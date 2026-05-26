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

// ✅ Tenta resolver o LID para um JID numérico usando todas as fontes disponíveis
async function resolverLID(lid, msg, sock) {
    // 1. Tenta o Redis primeiro (mais rápido)
    const doRedis = await redis.get(`lid:${lid}`);
    if (doRedis) {
        console.log(`[LID Mapper] ✅ Resolvido via Redis: ${lid} -> ${doRedis}`);
        return doRedis;
    }

    // 2. Tenta extrair do próprio objeto msg
    // Quando o WhatsApp envia com @lid, às vezes popula o verifiedBizName ou pushName
    // mas o campo mais confiável é o message.senderKeyDistributionMessage ou o deviceSentMessage
    const participantMsg = msg.participant || msg.key?.participant;
    if (participantMsg && !participantMsg.endsWith('@lid')) {
        console.log(`[LID Mapper] ✅ Resolvido via msg.participant: ${lid} -> ${participantMsg}`);
        await redis.set(`lid:${lid}`, participantMsg);
        return participantMsg;
    }

    // 3. Tenta resolver via store do sock
    if (sock.store?.contacts) {
        const contato = sock.store.contacts[lid];
        if (contato?.id && !contato.id.endsWith('@lid')) {
            console.log(`[LID Mapper] ✅ Resolvido via store: ${lid} -> ${contato.id}`);
            await redis.set(`lid:${lid}`, contato.id);
            return contato.id;
        }
    }

    // 4. Última tentativa: busca no banco de dados pelo lid salvo anteriormente
    try {
        const result = await query(
            `SELECT celular FROM leads WHERE lid = $1 LIMIT 1`,
            [lid]
        );
        if (result.rows[0]?.celular) {
            const jid = `${result.rows[0].celular}@s.whatsapp.net`;
            console.log(`[LID Mapper] ✅ Resolvido via banco: ${lid} -> ${jid}`);
            await redis.set(`lid:${lid}`, jid);
            return jid;
        }
    } catch (e) { /* ignora */ }

    return null; // Não foi possível resolver
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

    sock.ev.on('contacts.upsert', async (contacts) => {
        for (const contact of contacts) {
            if (contact.lid && contact.id) {
                await redis.set(`lid:${contact.lid}`, contact.id);
                console.log(`[LID Mapper] contacts.upsert → ${contact.lid} -> ${contact.id}`);
                try {
                    const numero = contact.id.replace('@s.whatsapp.net', '');
                    await query(
                        `UPDATE leads SET lid = $1 WHERE celular LIKE $2 AND (lid IS NULL OR lid = '')`,
                        [contact.lid, `%${numero}%`]
                    );
                } catch (e) {
                    console.error(`[LID Mapper] Erro banco:`, e.message);
                }
            }
        }
    });

    sock.ev.on('contacts.update', async (contacts) => {
        for (const contact of contacts) {
            if (contact.lid && contact.id) {
                await redis.set(`lid:${contact.lid}`, contact.id);
                console.log(`[LID Mapper] contacts.update → ${contact.lid} -> ${contact.id}`);
                try {
                    const numero = contact.id.replace('@s.whatsapp.net', '');
                    await query(
                        `UPDATE leads SET lid = $1 WHERE celular LIKE $2 AND (lid IS NULL OR lid = '')`,
                        [contact.lid, `%${numero}%`]
                    );
                } catch (e) {
                    console.error(`[LID Mapper] Erro banco:`, e.message);
                }
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        const msg = m.messages[0];
        if (!msg.message) return; 

        let from = msg.key.remoteJid;

        // ✅ RESOLUÇÃO COMPLETA DO LID
        if (from && from.endsWith('@lid')) {
            const lidOriginal = from;
            const jidResolvido = await resolverLID(from, msg, sock);

            if (jidResolvido) {
                from = jidResolvido;
                msg.key.remoteJid = jidResolvido; // ✅ Atualiza o msg para o fluxo.js receber correto

                // Salva no banco para garantir mapeamento futuro
                try {
                    const numero = jidResolvido.replace('@s.whatsapp.net', '');
                    const atualizado = await query(
                        `UPDATE leads SET lid = $1 WHERE celular LIKE $2 AND (lid IS NULL OR lid = '') RETURNING id`,
                        [lidOriginal, `%${numero}%`]
                    );
                    if (atualizado.rows[0]) {
                        console.log(`[LID Mapper] Lead ${atualizado.rows[0].id} atualizado com LID no banco.`);
                    }
                } catch (e) { /* ignora */ }

            } else {
                // ✅ ÚLTIMO RECURSO: tenta buscar o lead pelo LID diretamente no banco
                // Isso cobre casos onde o lead já foi enviado mas o LID nunca foi salvo
                try {
                    const result = await query(
                        `SELECT id, celular FROM leads WHERE fase_bot IN ('aguardando_nps', 'aguardando_feedback_ruim') ORDER BY atualizado_em DESC LIMIT 1`,
                        []
                    );
                    if (result.rows[0]) {
                        const lead = result.rows[0];
                        const jidFallback = `${lead.celular}@s.whatsapp.net`;
                        from = jidFallback;
                        msg.key.remoteJid = jidFallback;

                        // Salva o mapeamento para nunca mais cair aqui
                        await redis.set(`lid:${lidOriginal}`, jidFallback);
                        await query(`UPDATE leads SET lid = $1 WHERE id = $2`, [lidOriginal, lead.id]);

                        console.log(`[LID Mapper] ✅ Fallback: LID ${lidOriginal} mapeado para lead ${lead.id} (${jidFallback})`);
                    } else {
                        console.warn(`[LID Mapper] ❌ Impossível resolver LID: ${lidOriginal}. Nenhum lead aguardando.`);
                        return;
                    }
                } catch (e) {
                    console.warn(`[LID Mapper] ❌ LID sem mapeamento: ${from}. Ignorando.`);
                    return;
                }
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
                io.emit(`new-log-${clienteId}`, { 
                    msg: `🚫 Mensagem ignorada (Número não autorizado): ${fromLimpo}`, 
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