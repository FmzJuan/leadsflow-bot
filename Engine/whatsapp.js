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

// Guarda referência ao onMessage de cada cliente para reprocessamento de pendentes
const onMessageHandlers = new Map();

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

// ✅ FUNÇÃO AUXILIAR RIGOROSA: Vincula o LID no Postgres usando DDD + 8 dígitos finais (Evita Colisões)
async function atualizarLidNoBanco(jid, lid) {
    try {
        const digitos = jid.split('@')[0].replace(/\D/g, ''); // Remove tudo que não for número
        
        // Extrai o DDD de forma inteligente (se começar com 55 pega o 3º e 4º dígito, senão pega os 2 primeiros)
        const ddd = digitos.startsWith('55') ? digitos.substring(2, 4) : digitos.substring(0, 2);
        const final8 = digitos.slice(-8); // Pega os últimos 8 dígitos obrigatórios
        
        // A busca vira %DDD%ÚLTIMOS8 (ex: %11%91961603). 
        // Isso acha tanto com nono dígito quanto sem, mas trava o DDD para não cruzar pessoas de outras cidades!
        const termoBusca = `%${ddd}%${final8}`;

        const resultado = await query(
            `UPDATE leads 
             SET lid = $1 
             WHERE celular LIKE $2 
               AND (lid IS NULL OR lid = '')`,
            [lid, termoBusca]
        );

        if (resultado.rowCount > 0) {
            console.log(`[Postgres] 🔗 LID ${lid} vinculado com sucesso para o JID ${jid}`);
        }
    } catch (e) {
        console.error(`[Postgres] Erro ao salvar LID no banco para ${jid}:`, e.message);
    }
}

async function resolverLID(lid, msg, sock) {
    // 1️⃣ Cache Redis — mais rápido
    const doRedis = await redis.get(`lid:${lid}`);
    if (doRedis) return doRedis;

    // 2️⃣ Campo participant da mensagem
    const participantMsg = msg.participant || msg.key?.participant;
    if (participantMsg && !participantMsg.endsWith('@lid')) {
        const jidLimpo = participantMsg.replace(/:\d+@/, '@');
        await redis.set(`lid:${lid}`, jidLimpo, 'EX', 604800);
        
        // 🔥 CORREÇÃO: Salva no banco de dados para não ficar nulo!
        await atualizarLidNoBanco(jidLimpo, lid);
        
        return jidLimpo;
    }

    // 3️⃣ Store em memória desta sessão
    const store = sessionStores.get(sock._clienteId);
    if (store?.contacts) {
        const contato = store.contacts[lid];
        if (contato?.id && !contato.id.endsWith('@lid')) {
            const jidLimpo = `${contato.id.split('@')[0].replace(/\D/g, '')}@s.whatsapp.net`;
            await redis.set(`lid:${lid}`, jidLimpo, 'EX', 604800);
            
            // 🔥 CORREÇÃO: Salva no banco de dados para não ficar nulo!
            await atualizarLidNoBanco(jidLimpo, lid);
            
            return jidLimpo;
        }
    }

    // 4️⃣ Banco de dados — campo lid já salvo anteriormente
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

    // ❌ Fallback de adivinhação removido — evita cruzamento de mensagens entre clientes
    return null;
}

// ✅ Salva mensagem no Redis + Postgres quando o LID não pôde ser resolvido
async function salvarLidPendente(lid, clienteId, msg) {
    const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const payload = JSON.stringify({ texto, clienteId, timestamp: Date.now() });

    // Redis com TTL de 2h (tempo suficiente para o contacts.upsert disparar)
    await redis.set(`lid_pendente:${lid}`, payload, 'EX', 7200);

    // Postgres para persistence além do TTL e visibilidade operacional
    try {
        await query(
            `INSERT INTO lid_pendentes (lid, cliente_id, texto, criado_em)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (lid) DO UPDATE SET texto = $3, criado_em = NOW()`,
            [lid, clienteId, texto]
        );
    } catch (e) {
        console.warn(`[LID Pendente] Aviso ao salvar no banco: ${e.message}`);
    }
}

// ✅ Tenta reprocessar mensagem pendente após o LID ser resolvido pelo contacts.upsert
async function reprocessarLidPendente(lid, jidResolvido, sock, clienteId) {
    const raw = await redis.get(`lid_pendente:${lid}`);
    if (!raw) return;

    let payload;
    try {
        payload = JSON.parse(raw);
    } catch {
        return;
    }

    // Remove do Redis imediatamente para evitar duplo processamento
    await redis.del(`lid_pendente:${lid}`);

    // Remove do Postgres também
    try {
        await query(`DELETE FROM lid_pendentes WHERE lid = $1`, [lid]);
    } catch { /* ignora */ }

    const onMessage = onMessageHandlers.get(clienteId);
    if (!onMessage) return;

    // Reconstrói a mensagem no formato que o onMessage espera
    const msgFake = {
        key: { remoteJid: jidResolvido, fromMe: false },
        message: { conversation: payload.texto }
    };

    console.log(`[LID Pendente] ✅ Reprocessando mensagem de ${jidResolvido}: "${payload.texto}"`);
    await onMessage(clienteId, sock, msgFake);
}

function extrairNumeroDoJid(jid) {
    return (jid || '').split('@')[0].replace(/\D/g, '');
}

function ultimosDigitos(numStr, n = 8) {
    return numStr.slice(-n);
}

async function connectToWhatsApp(clienteId, onMessage, onWorker) {
    const { io } = require('../index'); 

    // Guarda referência ao handler para uso no reprocessamento
    onMessageHandlers.set(clienteId, onMessage);

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
        printQRInTerminal: false,
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
                onMessageHandlers.delete(clienteId);

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

    // ✅ Salva mapeamento LID->JID e reprocessa pendentes
    sock.ev.on('contacts.upsert', async (contacts) => {
        for (const contact of contacts) {
            if (contact.lid && contact.id && !contact.id.endsWith('@lid')) {
                const jidLimpo = `${contact.id.split('@')[0].replace(/\D/g, '')}@s.whatsapp.net`;
                
                // Salva no Redis
                await redis.set(`lid:${contact.lid}`, jidLimpo, 'EX', 604800);
                console.log(`[Contacts Upsert] Mapeado: ${contact.lid} -> ${jidLimpo}`);
                
                // 🔥 CORREÇÃO RIGOROSA: Atualiza o banco usando a nova regra de segurança (DDD + 8 dígitos)
                await atualizarLidNoBanco(jidLimpo, contact.lid);

                // ✅ Verifica e reprocessa mensagem pendente para esse LID
                await reprocessarPendente(contact.lid, jidLimpo, sock, clienteId);
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
                // ✅ Salva como pendente — será reprocessado quando contacts.upsert resolver
                await salvarLidPendente(lidOriginal, clienteId, msg);

                io.emit(`new-log-${clienteId}`, { 
                    meta: `Sistema (LID Mapper)`,
                    msg: `⏳ LID não resolvido, salvo como pendente: ${lidOriginal}`, 
                    type: 'warning' 
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