// Chat/RissatoMotors/fluxo.js

const { query } = require('../../DataBase/conection');
const { respostasNPS } = require('./mensagens');

/**
 * FUNÇÃO NOVA: Sorteia uma mensagem dentro de um array para o bot não ficar repetitivo
 */
function mensagemAleatoria(array) {
    if (Array.isArray(array)) {
        return array[Math.floor(Math.random() * array.length)];
    }
    return array; // Se não for array, retorna o texto direto
}

// FUNÇÃO NOVA: Envia o log em tempo real para o Front-end
// 👇 AJUSTE: Adicionei o "meta = ''" aqui para você poder passar o nome e número do cliente!
function enviarLogFront(io, clienteId, msg, type = 'default', meta = '') {
    if (io && clienteId) {
        io.emit(`new-log-${clienteId}`, { msg, type, meta });
        // Mantém o console.log para você ver no terminal também
        console.log(`[Front Log - ${type.toUpperCase()}] ${meta ? meta + ' - ' : ''}${msg}`);
    } else {
        console.log(`[Terminal] ${msg}`);
    }
}

/**
 * SOLUÇÃO AVANÇADA: AGRUPAMENTO DE MENSAGENS (DEBOUNCE)
 */
const timersAgrupamento = new Map(); // leadId -> NodeJS.Timeout
const mensagensAcumuladas = new Map(); // leadId -> string[]

async function executar(sock, msg, io, clienteId) {
    const from = msg.key.remoteJid;
    const textoOriginal = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || "").trim();

    if (!textoOriginal) return;

    const numeroLimpo = from.replace(/\D/g, '');

    try {
        const result = await query(`
            SELECT id, cliente_id, nome, fase_bot 
            FROM leads 
            WHERE celular LIKE $1 
               OR celular = $2
            LIMIT 1
        `, [`%${numeroLimpo}%`, from.split('@')[0]]);

        const lead = result.rows[0];

        if (!lead || (lead.fase_bot !== 'aguardando_nps' && lead.fase_bot !== 'aguardando_feedback_ruim')) {
            return; 
        }

        const mensagens = mensagensAcumuladas.get(lead.id) || [];
        mensagens.push(textoOriginal);
        mensagensAcumuladas.set(lead.id, mensagens);

        if (timersAgrupamento.has(lead.id)) {
            clearTimeout(timersAgrupamento.get(lead.id));
            enviarLogFront(io, clienteId, `⏳ [${lead.nome}]-[${numeroLimpo}] enviou mais mensagens. Agrupando...`, 'default');
        } else { 
            enviarLogFront(io, clienteId, `📥 Nova interaçao de [${lead.nome}]-[${numeroLimpo}]->Iniciando leitura`, 'default');
        }

        const tempoEspera = 30000; // 30 segundos
        const timer = setTimeout(async () => {
            const mensagensParaProcessar = mensagensAcumuladas.get(lead.id);
            timersAgrupamento.delete(lead.id);
            mensagensAcumuladas.delete(lead.id);
            
            await processarFluxoAgrupado(sock, from, lead, mensagensParaProcessar, io, clienteId);
        }, tempoEspera);

        timersAgrupamento.set(lead.id, timer);

    } catch (error) {
        console.error(`[Fluxo] Erro ao iniciar agrupamento para ${from}:`, error);
        enviarLogFront(io, clienteId, `❌ Erro ao processar mensagens de [${from}]: ${error.message}`, 'error');
    }
}

async function processarFluxoAgrupado(sock, from, lead, mensagens, io, clienteId) {
    const textoCompleto = mensagens.join(" | ");
    const numeroLimpo = from.replace(/\D/g, '');
    const metaInfo = `${lead.nome} (${numeroLimpo})`;

    enviarLogFront(io, clienteId, `🚀 Analisando bloco de mensagens de ${lead.nome}...`, 'default', metaInfo);
    
    // 👇 AJUSTE: Removido o "const { io } = require('../../index');" que causava erro fatal no Node.

    try {
        if (lead.fase_bot === 'aguardando_feedback_ruim') {
            await query("UPDATE leads SET fase_bot = 'pausado_humano', atualizado_em = CURRENT_TIMESTAMP WHERE id = $1", [lead.id]);

            await sock.sendPresenceUpdate('composing', from);
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const textoFinal = mensagemAleatoria(respostasNPS.detrator_encerramento);
            await sock.sendMessage(from, { text: textoFinal });

            // 👇 AJUSTE: Usando a sua função enviarLogFront para manter o padrão e evitar repetição de código
            enviarLogFront(io, clienteId, `📤 Bot enviou: "Agradecimento Feedback"`, 'success', metaInfo);

            console.log(`[Fluxo] ${lead.nome} finalizado -> pausado_humano.`);
            return;
        }

        if (lead.fase_bot === 'aguardando_nps') {
            const todasAsPalavras = textoCompleto.split(/\s+|\|/);
            const notaEncontrada = todasAsPalavras.find(p => /^\d+$/.test(p));

            if (!notaEncontrada) {
                await sock.sendMessage(from, { text: "Por favor, responda essa mensagem com números apenas para que eu possa entender sua nota." });
                return; 
            }

            const nota = parseInt(notaEncontrada, 10);

            if (nota < 0 || nota > 10) {
                await sock.sendMessage(from, { text: "A nota precisa ser um numero entre 0 e 10. Como foi sua experiencia?" });
                return;
            }

            const proximaFase = (nota >= 0 && nota <= 6) ? 'aguardando_feedback_ruim' : 'inativo';
            await query("UPDATE leads SET fase_bot = $1, atualizado_em = CURRENT_TIMESTAMP WHERE id = $2", [proximaFase, lead.id]);

            await sock.sendPresenceUpdate('composing', from);
            await new Promise(resolve => setTimeout(resolve, 2000));

            if (nota >= 0 && nota <= 6) {
                const perguntaRuim = mensagemAleatoria(respostasNPS.detrator_pergunta);
                await sock.sendMessage(from, { text: perguntaRuim });
                
                // 👇 AJUSTE: Usando a sua função enviarLogFront
                enviarLogFront(io, clienteId, `📤 Bot enviou: "Pergunta Feedback Detrator"`, 'success', metaInfo);
            } else {
                await sock.sendMessage(from, { text: respostasNPS.promotor_agradecimento });
                
                // 👇 AJUSTE: Usando a sua função enviarLogFront
                enviarLogFront(io, clienteId, `📤 Bot enviou: "Agradecimento Promotor + Link Google"`, 'success', metaInfo);
            }
            
            console.log(`[Fluxo] ${lead.nome} deu nota ${nota}. Próxima fase: ${proximaFase}`);
        }
    } catch (error) {
        console.error(`[Fluxo] Erro ao processar bloco de ${lead.nome}:`, error);
    }
}

module.exports = { executar };