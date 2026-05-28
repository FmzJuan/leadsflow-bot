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

async function ejecutar(sock, msg, io, clienteId) {
    const from = normalizarJid(msg.key.remoteJid);
    const textoOriginal = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || "").trim();

    if (!textoOriginal) return;

    try {
        const res = await query("SELECT status FROM clientes WHERE whatsapp_id = $1", [from]);
        
        // Se o cliente não existe no banco de dados do bot, registra ele
        if (res.rowCount === 0) {
            await query("INSERT INTO clientes (whatsapp_id, status) VALUES ($1, 'inicio')", [from]);
            enviarLogFront(io, clienteId, `📥 Novo cliente [${from}] registrado com status 'inicio'.`, 'info');
            return;
        }

        const statusAtual = res.rows[0].status;
        enviarLogFront(io, clienteId, `📥 Mensagem de [${from}] com status '${statusAtual}'.`, 'info');

        // Se o cliente já está em atendimento manual ou pausado para humano, ignora completamente
        if (statusAtual === 'atendimento_manual' || statusAtual === 'pausado_humano') {
            enviarLogFront(io, clienteId, `🚫 Cliente [${from}] em atendimento manual, ignorando mensagem.`, 'warning');
            return;
        }

        // Tratamento para o Pós-Venda de 5 meses (status 'enviado' vindo do worker)
        // Como o de 5 meses não é NPS, se ele responder, jogamos direto para o atendimento humano
        if (statusAtual === 'enviado') {
            await sock.sendMessage(from, { 
                text: "Obrigado pelo seu retorno! Recebemos sua mensagem e um de nossos consultores vai prosseguir com o seu atendimento em instantes." 
            });
            await query("UPDATE clientes SET status = 'atendimento_manual', atualizado_em = CURRENT_TIMESTAMP WHERE whatsapp_id = $1", [from]);
            enviarLogFront(io, clienteId, `📤 Resposta de 5 meses recebida de [${from}]. Transferido para 'atendimento_manual'.`, 'success');
            return;
        }

        // Se o cliente não se enquadrar nos cortes acima, processa o fluxo de NPS/Feedback
        await processarFluxoNormal(sock, from, textoOriginal, statusAtual, io, clienteId);

    } catch (error) {
        console.error(`[Fluxo] Erro ao processar mensagem para ${from}:`, error);
        enviarLogFront(io, clienteId, `❌ Erro ao processar mensagens de [${from}]: ${error.message}`, 'error');
    }
}

async function processarFluxoNormal(sock, from, texto, statusAtual, io, clienteId) {
    const metaInfo = `(${from})`;
    enviarLogFront(io, clienteId, `🚀 Analisando mensagem de ${from}...`, 'default', metaInfo);

    try {
        // AGORA SIM: Se o status for 'pos_vendas_enviado', capturamos a nota do NPS
        if (statusAtual === 'pos_vendas_enviado') {
            const todasAsPalavras = texto.split(/\s+|\|/);
            const notaEncontrada = todasAsPalavras.find(p => /^\d+$/.test(p));

            // Se o cliente mandou texto mas nenhuma nota em número
            if (!notaEncontrada) {
                await sock.sendMessage(from, { text: "Por favor, responda essa mensagem apenas com um número de 0 a 10 para que eu possa entender sua nota." });
                return; 
            }

            const nota = parseInt(notaEncontrada, 10);

            // Validação de intervalo da nota
            if (nota < 0 || nota > 10) {
                await sock.sendMessage(from, { text: "A nota precisa ser um número entre 0 e 10. Como foi sua experiência?" });
                return;
            }

            // Define o próximo passo: 
            // Notas de 0 a 6 -> Vai para 'aguardando_feedback_ruim' (solicitar justificativa)
            // Notas de 7 a 10 -> Promotor/Neutro, envia agradecimento e finaliza enviando para o painel humano ('atendimento_manual')
            const proximaFase = (nota >= 0 && nota <= 6) ? 'aguardando_feedback_ruim' : 'atendimento_manual';
            await query("UPDATE clientes SET status = $1, atualizado_em = CURRENT_TIMESTAMP WHERE whatsapp_id = $2", [proximaFase, from]);

            await sock.sendPresenceUpdate('composing', from);
            await new Promise(resolve => setTimeout(resolve, 2000));

            if (nota >= 0 && nota <= 6) {
                const perguntaRuim = mensagemAleatoria(respostasNPS.detrator_pergunta);
                await sock.sendMessage(from, { text: perguntaRuim });
                enviarLogFront(io, clienteId, `📤 Bot enviou: "Pergunta Feedback Detrator"`, 'success', metaInfo);
            } else {
                await sock.sendMessage(from, { text: respostasNPS.promotor_agradecimento });
                enviarLogFront(io, clienteId, `📤 Bot enviou: "Agradecimento Promotor + Link Google"`, 'success', metaInfo);
            }
            
            console.log(`[Fluxo] ${from} deu nota ${nota}. Próxima fase: ${proximaFase}`);
            return;
        }

        // Se o status for 'aguardando_feedback_ruim', significa que ele já deu a nota baixa e agora mandou o texto explicando o motivo
        if (statusAtual === 'aguardando_feedback_ruim') {
            // Atualiza para atendimento_manual para os operadores verem o problema e assumirem
            await query("UPDATE clientes SET status = 'atendimento_manual', atualizado_em = CURRENT_TIMESTAMP WHERE whatsapp_id = $1", [from]);

            await sock.sendPresenceUpdate('composing', from);
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const textoFinal = mensagemAleatoria(respostasNPS.detrator_encerramento);
            await sock.sendMessage(from, { text: textoFinal });

            enviarLogFront(io, clienteId, `📤 Bot enviou: "Agradecimento Encerramento Detrator"`, 'success', metaInfo);
            console.log(`[Fluxo] ${from} justificou a nota baixa. Finalizado e enviado para atendimento_manual.`);
            return;
        }

    } catch (error) {
        console.error(`[Fluxo] Erro ao processar fluxo normal para ${from}:`, error);
        enviarLogFront(io, clienteId, `❌ Erro ao processar fluxo normal de [${from}]: ${error.message}`, 'error');
    }
}

module.exports = { executar };