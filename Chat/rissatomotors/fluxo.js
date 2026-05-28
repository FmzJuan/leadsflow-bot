const { query } = require(\'../../DataBase/conection\');
const { respostasNPS } = require(\'./mensagens\');
const { normalizarJid } = require(\'../../utils/formatador\');

function mensagemAleatoria(array) {
    if (Array.isArray(array)) {
        return array[Math.floor(Math.random() * array.length)];
    }
    return array;
}

function enviarLogFront(io, clienteId, msg, type = \'default\', meta = \'\') {
    if (io && clienteId) {
        io.emit(`new-log-${clienteId}`, { msg, type, meta });
        console.log(`[Front Log - ${type.toUpperCase()}] ${meta ? meta + \' - \' : \'\'}${msg}`);
    } else {
        console.log(`[Terminal] ${msg}`);
    }
}

async function executar(sock, msg, io, clienteId) {
    const from = normalizarJid(msg.key.remoteJid);
    const textoOriginal = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || \"\").trim();

    if (!textoOriginal) return;

    try {
        const res = await query("SELECT status FROM clientes WHERE whatsapp_id = $1", [from]);
        
        if (res.rowCount === 0) {
            await query("INSERT INTO clientes (whatsapp_id, status) VALUES ($1, \'inicio\')", [from]);
            enviarLogFront(io, clienteId, `📥 Novo cliente [${from}] registrado com status 'inicio'.`, \'info\');
            // Aqui você chamaria a função para enviar o menu principal, por exemplo:
            // return enviarMenuPrincipal(sock, from);
            return;
        }

        const statusAtual = res.rows[0].status;
        enviarLogFront(io, clienteId, `📥 Mensagem de [${from}] com status '${statusAtual}'.`, \'info\');

        if (statusAtual === \'atendimento_manual\') {
            enviarLogFront(io, clienteId, `🚫 Cliente [${from}] em atendimento manual, ignorando mensagem.`, \'warning\');
            return;
        }

        if (statusAtual === \'pos_vendas_enviado\') {
            await sock.sendMessage(from, { 
                text: \"Obrigado pelo seu retorno! Recebemos sua resposta sobre o pós-vendas e um de nossos agentes vai analisar. Deseja falar com o suporte agora?\" 
            });
            await query("UPDATE clientes SET status = \'atendimento_manual\' WHERE whatsapp_id = $1", [from]);
            enviarLogFront(io, clienteId, `📤 Resposta de pós-vendas enviada para [${from}]. Status atualizado para 'atendimento_manual'.`, \'success\');
            return; 
        }

        // Se não for nenhum dos casos acima, processa o fluxo normal do bot
        await processarFluxoNormal(sock, from, textoOriginal, statusAtual, io, clienteId);

    } catch (error) {
        console.error(`[Fluxo] Erro ao processar mensagem para ${from}:`, error);
        enviarLogFront(io, clienteId, `❌ Erro ao processar mensagens de [${from}]: ${error.message}`, \'error\');
    }
}

async function processarFluxoNormal(sock, from, texto, statusAtual, io, clienteId) {
    const metaInfo = `(${from})`;
    enviarLogFront(io, clienteId, `🚀 Analisando mensagem de ${from}...`, \'default\', metaInfo);

    try {
        // Lógica original do fluxo, adaptada para usar o status do banco
        // e o JID normalizado. Exemplo com base no que foi fornecido:

        if (statusAtual === \'aguardando_feedback_ruim\') {
            await query("UPDATE clientes SET status = \'pausado_humano\', atualizado_em = CURRENT_TIMESTAMP WHERE whatsapp_id = $1", [from]);

            await sock.sendPresenceUpdate(\'composing\', from);
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const textoFinal = mensagemAleatoria(respostasNPS.detrator_encerramento);
            await sock.sendMessage(from, { text: textoFinal });

            enviarLogFront(io, clienteId, `📤 Bot enviou: \"Agradecimento Feedback\"`, \'success\', metaInfo);

            console.log(`[Fluxo] ${from} finalizado -> pausado_humano.`);
            return;
        }

        if (statusAtual === \'aguardando_nps\') {
            const todasAsPalavras = texto.split(/\s+|\|/);
            const notaEncontrada = todasAsPalavras.find(p => /^\\d+$/.test(p));

            if (!notaEncontrada) {
                await sock.sendMessage(from, { text: \"Por favor, responda essa mensagem com números apenas para que eu possa entender sua nota.\" });
                return; 
            }

            const nota = parseInt(notaEncontrada, 10);

            if (nota < 0 || nota > 10) {
                await sock.sendMessage(from, { text: \"A nota precisa ser um numero entre 0 e 10. Como foi sua experiencia?\" });
                return;
            }

            const proximaFase = (nota >= 0 && nota <= 6) ? \'aguardando_feedback_ruim\' : \'inativo\';
            await query("UPDATE clientes SET status = $1, atualizado_em = CURRENT_TIMESTAMP WHERE whatsapp_id = $2", [proximaFase, from]);

            await sock.sendPresenceUpdate(\'composing\', from);
            await new Promise(resolve => setTimeout(resolve, 2000));

            if (nota >= 0 && nota <= 6) {
                const perguntaRuim = mensagemAleatoria(respostasNPS.detrator_pergunta);
                await sock.sendMessage(from, { text: perguntaRuim });
                
                enviarLogFront(io, clienteId, `📤 Bot enviou: \"Pergunta Feedback Detrator\"`, \'success\', metaInfo);
            } else {
                await sock.sendMessage(from, { text: respostasNPS.promotor_agradecimento });
                
                enviarLogFront(io, clienteId, `📤 Bot enviou: \"Agradecimento Promotor + Link Google\"`, \'success\', metaInfo);
            }
            
            console.log(`[Fluxo] ${from} deu nota ${nota}. Próxima fase: ${proximaFase}`);
        }
    } catch (error) {
        console.error(`[Fluxo] Erro ao processar fluxo normal para ${from}:`, error);
        enviarLogFront(io, clienteId, `❌ Erro ao processar fluxo normal de [${from}]: ${error.message}`, \'error\');
    }
}

module.exports = { executar };
