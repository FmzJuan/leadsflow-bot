// Chat/RissatoMotors/fluxo.js

const { query } = require('../../DataBase/conection');
const { respostasNPS } = require('./mensagens');

/**
 * 👇 FUNÇÃO NOVA: Sorteia uma mensagem dentro de um array para o bot não ficar repetitivo
 */
function mensagemAleatoria(array) {
    if (Array.isArray(array)) {
        return array[Math.floor(Math.random() * array.length)];
    }
    return array; // Se não for array, retorna o texto direto
}

/**
 * ✅ SOLUÇÃO AVANÇADA: AGRUPAMENTO DE MENSAGENS (DEBOUNCE)
 */
const timersAgrupamento = new Map(); // leadId -> NodeJS.Timeout
const mensagensAcumuladas = new Map(); // leadId -> string[]

async function executar(sock, msg) {
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
        }

        const tempoEspera = 30000; // 30 segundos
        const timer = setTimeout(async () => {
            await processarFluxoAgrupado(sock, from, lead, mensagensAcumuladas.get(lead.id));
            timersAgrupamento.delete(lead.id);
            mensagensAcumuladas.delete(lead.id);
        }, tempoEspera);

        timersAgrupamento.set(lead.id, timer);

    } catch (error) {
        console.error(`[Fluxo] Erro ao iniciar agrupamento para ${from}:`, error);
    }
}

async function processarFluxoAgrupado(sock, from, lead, mensagens) {
    const textoCompleto = mensagens.join(" | ");
    const numeroLimpo = from.replace(/\D/g, '');
    const { io } = require('../../index');

    try {
        if (lead.fase_bot === 'aguardando_feedback_ruim') {
            await query("UPDATE leads SET fase_bot = 'pausado_humano', atualizado_em = CURRENT_TIMESTAMP WHERE id = $1", [lead.id]);

            await sock.sendPresenceUpdate('composing', from);
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const textoFinal = mensagemAleatoria(respostasNPS.detrator_encerramento);
            await sock.sendMessage(from, { text: textoFinal });

            // LOG NA DASHBOARD COM NOME E NÚMERO NO META
            io.emit(`new-log-${lead.cliente_id}`, { 
                meta: `${lead.nome} (${numeroLimpo})`,
                msg: `📤 Bot enviou: "Agradecimento Feedback"`, 
                type: 'success' 
            });

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
                
                // LOG NA DASHBOARD COM NOME E NÚMERO NO META
                io.emit(`new-log-${lead.cliente_id}`, { 
                    meta: `${lead.nome} (${numeroLimpo})`,
                    msg: `📤 Bot enviou: "Pergunta Feedback Detrator"`, 
                    type: 'success' 
                });
            } else {
                await sock.sendMessage(from, { text: respostasNPS.promotor_agradecimento });
                
                // LOG NA DASHBOARD COM NOME E NÚMERO NO META
                io.emit(`new-log-${lead.cliente_id}`, { 
                    meta: `${lead.nome} (${numeroLimpo})`,
                    msg: `📤 Bot enviou: "Agradecimento Promotor + Link Google"`, 
                    type: 'success' 
                });
            }
            
            console.log(`[Fluxo] ${lead.nome} deu nota ${nota}. Próxima fase: ${proximaFase}`);
        }
    } catch (error) {
        console.error(`[Fluxo] Erro ao processar bloco de ${lead.nome}:`, error);
    }
}

module.exports = { executar };
