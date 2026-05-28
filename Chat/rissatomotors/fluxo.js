const { query } = require('../../DataBase/conection');
const { respostasNPS } = require('./mensagens');
const { normalizarJid } = require('../../utils/formatador');

function mensagemAleatoria(array) {
    if (Array.isArray(array)) {
        return array[Math.floor(Math.random() * array.length)];
    }
    return array;
}

function enviarLogFront(io, clienteId, msg, type = 'default', meta = '') {
    if (io && clienteId) {
        io.emit(`new-log-${clienteId}`, { msg, type, meta });
        console.log(`[Front Log - ${type.toUpperCase()}] ${meta ? meta + ' - ' : ''}${msg}`);
    } else {
        console.log(`[Terminal] ${msg}`);
    }
}

async function executar(sock, msg, io, clienteId) {
    const from = normalizarJid(msg.key.remoteJid);
    const textoOriginal = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || "").trim();

    if (!textoOriginal) return;

    try {
        // FILTRO MULTI-TENANT: Busca o status relacionando a Oficina (clienteId) com o Número (from)
        const res = await query("SELECT status FROM clientes WHERE cliente_id = $1 AND whatsapp_id = $2", [clienteId, from]);
        
        // Se o cliente não existe no banco para esta oficina, registra
        if (res.rowCount === 0) {
            await query("INSERT INTO clientes (cliente_id, whatsapp_id, status) VALUES ($1, $2, 'inicio')", [clienteId, from]);
            enviarLogFront(io, clienteId, `📥 Novo cliente [${from}] registrado com status 'inicio'.`, 'info');
            await tratarMensagemForaDeFluxo(sock, from, clienteId, io);
            return;
        }

        const statusAtual = res.rows[0].status;
        enviarLogFront(io, clienteId, `📥 Mensagem de [${from}] com status '${statusAtual}'.`, 'info');

        // Se está em atendimento humano, o bot não responde nada
        if (statusAtual === 'atendimento_manual' || statusAtual === 'pausado_humano') {
            enviarLogFront(io, clienteId, `🚫 Cliente [${from}] em atendimento manual, ignorando mensagem.`, 'warning');
            return;
        }

        // Resposta para Pós-Venda de 5 meses (Vai direto para o humano)
        if (statusAtual === 'enviado') {
            await sock.sendMessage(from, { 
                text: "Obrigado pelo seu retorno! Recebemos sua mensagem e um de nossos consultores vai prosseguir com o seu atendimento em instantes." 
            });
            await query("UPDATE clientes SET status = 'atendimento_manual', atualizado_em = CURRENT_TIMESTAMP WHERE cliente_id = $1 AND whatsapp_id = $2", [clienteId, from]);
            enviarLogFront(io, clienteId, `📤 Resposta de 5 meses recebida de [${from}]. Transferido para 'atendimento_manual'.`, 'success');
            return;
        }

        // Evita o limbo: Se o cliente mandar mais mensagens com status 'inicio', trata como humana
        if (statusAtual === 'inicio') {
            await tratarMensagemForaDeFluxo(sock, from, clienteId, io);
            return;
        }

        // Processa o fluxo normal de capturar nota NPS
        await processarFluxoNormal(sock, from, textoOriginal, statusAtual, io, clienteId);

    } catch (error) {
        console.error(`[Fluxo] Erro ao processar mensagem para ${from}:`, error);
        enviarLogFront(io, clienteId, `❌ Erro ao processar mensagens de [${from}]: ${error.message}`, 'error');
    }
}

async function tratarMensagemForaDeFluxo(sock, from, clienteId, io) {
    await sock.sendMessage(from, { 
        text: "Olá! Recebemos sua mensagem. Um de nossos consultores já foi notificado e vai te atender em instantes." 
    });
    await query("UPDATE clientes SET status = 'atendimento_manual', atualizado_em = CURRENT_TIMESTAMP WHERE cliente_id = $1 AND whatsapp_id = $2", [clienteId, from]);
    enviarLogFront(io, clienteId, `👤 Cliente [${from}] direcionado para 'atendimento_manual' (Mensagem espontânea).`, 'default');
}

async function processarFluxoNormal(sock, from, texto, statusAtual, io, clienteId) {
    const metaInfo = `(${from})`;
    enviarLogFront(io, clienteId, `🚀 Analisando mensagem de ${from}...`, 'default', metaInfo);

    try {
        if (statusAtual === 'pos_vendas_enviado') {
            // Regex inteligente para isolar números de 0 a 10 mesmo colados com caracteres especiais
            const matchNota = texto.match(/\b([0-9]|10)\b/);

            if (!matchNota) {
                await sock.sendMessage(from, { text: "Por favor, responda essa mensagem apenas com um número de 0 a 10 para que eu possa entender sua nota." });
                return; 
            }

            const nota = parseInt(matchNota[0], 10);
            const proximaFase = (nota >= 0 && nota <= 6) ? 'aguardando_feedback_ruim' : 'atendimento_manual';
            
            // FILTRO MULTI-TENANT: Atualiza apenas o status desta oficina
            await query("UPDATE clientes SET status = $1, atualizado_em = CURRENT_TIMESTAMP WHERE cliente_id = $2 AND whatsapp_id = $3", [proximaFase, clienteId, from]);

            await sock.sendPresenceUpdate('composing', from);
            await new Promise(resolve => setTimeout(resolve, 2000));

            if (nota >= 0 && nota <= 6) {
                const perguntaRuim = mensagemAleatoria(respostasNPS.detrator_pergunta);
                await sock.sendMessage(from, { text: preguntaRuim });
                enviarLogFront(io, clienteId, `📤 Bot enviou: "Pergunta Feedback Detrator"`, 'success', metaInfo);
            } else {
                await sock.sendMessage(from, { text: respostasNPS.promotor_agradecimento });
                enviarLogFront(io, clienteId, `📤 Bot enviou: "Agradecimento Promotor + Link Google"`, 'success', metaInfo);
            }
            return;
        }

        if (statusAtual === 'aguardando_feedback_ruim') {
            // FILTRO MULTI-TENANT
            await query("UPDATE clientes SET status = 'atendimento_manual', atualizado_em = CURRENT_TIMESTAMP WHERE cliente_id = $1 AND whatsapp_id = $2", [clienteId, from]);

            await sock.sendPresenceUpdate('composing', from);
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const textoFinal = mensagemAleatoria(respostasNPS.detrator_encerramento);
            await sock.sendMessage(from, { text: textoFinal });

            enviarLogFront(io, clienteId, `📤 Bot enviou: "Agradecimento Encerramento Detrator"`, 'success', metaInfo);
            return;
        }

    } catch (error) {
        console.error(`[Fluxo] Erro ao processar fluxo normal para ${from}:`, error);
        enviarLogFront(io, clienteId, `❌ Erro ao processar fluxo normal de [${from}]: ${error.message}`, 'error');
    }
}

module.exports = { executar };