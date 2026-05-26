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
 * 1. Quando chega uma mensagem, o bot espera um tempo (ex: 30s) para ver se chegam mais.
 * 2. Todas as mensagens enviadas nesse intervalo são acumuladas.
 * 3. Após o tempo, o bot processa o bloco de texto inteiro uma única vez.
 */
const timersAgrupamento = new Map(); // leadId -> NodeJS.Timeout
const mensagensAcumuladas = new Map(); // leadId -> string[]

async function executar(sock, msg) {
    const from = msg.key.remoteJid;
    const textoOriginal = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || "").trim();

    if (!textoOriginal) return;

    const numeroLimpo = from.replace(/\D/g, '');

    try {
        // Busca o lead
        const result = await query(`
            SELECT id, nome, fase_bot 
            FROM leads 
            WHERE celular LIKE $1 
               OR celular = $2
            LIMIT 1
        `, [`%${numeroLimpo}%`, from.split('@')[0]]);

        const lead = result.rows[0];

        // Se não achou ou não está em uma fase interativa, ignora
        if (!lead || (lead.fase_bot !== 'aguardando_nps' && lead.fase_bot !== 'aguardando_feedback_ruim')) {
            return; 
        }

        // --- LÓGICA DE AGRUPAMENTO (DEBOUNCE) ---
        
        // 1. Acumula a mensagem atual
        const mensagens = mensagensAcumuladas.get(lead.id) || [];
        mensagens.push(textoOriginal);
        mensagensAcumuladas.set(lead.id, mensagens);

        // 2. Se já existe um timer rodando, cancela o anterior para reiniciar a contagem
        if (timersAgrupamento.has(lead.id)) {
            clearTimeout(timersAgrupamento.get(lead.id));
            console.log(`[Fluxo] ⏳ Aguardando mais mensagens de ${lead.nome}... (Timer reiniciado)`);
        } else {
            console.log(`[Fluxo] ⏳ Iniciando agrupamento de mensagens para ${lead.nome}...`);
        }

        // 3. Define o timer para processar (30 segundos é um tempo seguro e ágil)
        const tempoEspera = 30000; // 30 segundos
        const timer = setTimeout(async () => {
            await processarFluxoAgrupado(sock, from, lead, mensagensAcumuladas.get(lead.id));
            
            // Limpa as travas após processar
            timersAgrupamento.delete(lead.id);
            mensagensAcumuladas.delete(lead.id);
        }, tempoEspera);

        timersAgrupamento.set(lead.id, timer);

    } catch (error) {
        console.error(`[Fluxo] Erro ao iniciar agrupamento para ${from}:`, error);
    }
}

/**
 * Função que realmente executa a lógica do bot após o tempo de espera
 */
async function processarFluxoAgrupado(sock, from, lead, mensagens) {
    // Pega a primeira mensagem (geralmente a nota) e junta o resto como comentário
    const textoPrincipal = mensagens[0];
    const textoCompleto = mensagens.join(" | ");

    console.log(`[Fluxo] 🚀 Processando bloco de mensagens de ${lead.nome}: "${textoCompleto}"`);

    try {
        // FLUXO B: RECEBENDO O MOTIVO DA NOTA BAIXA (Cliente acabou de digitar a reclamação)
        if (lead.fase_bot === 'aguardando_feedback_ruim') {
            await query("UPDATE leads SET fase_bot = 'pausado_humano', atualizado_em = CURRENT_TIMESTAMP WHERE id = $1", [lead.id]);

            await sock.sendPresenceUpdate('composing', from);
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // 👇 ALTERAÇÃO: Manda um ENCERRAMENTO aleatório, sem fazer novas perguntas
            const textoFinal = mensagemAleatoria(respostasNPS.detrator_encerramento);
            await sock.sendMessage(from, { text: textoFinal });

            console.log(`[Fluxo] ${lead.nome} finalizado -> pausado_humano.`);
            return;
        }

        // FLUXO A: RECEBENDO A NOTA DE 0 A 10
        if (lead.fase_bot === 'aguardando_nps') {
            // Tenta extrair um número da primeira mensagem ou de qualquer uma das mensagens enviadas
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
                // 👇 ALTERAÇÃO: Sorteia uma das 3 perguntas para detratores passadas pelo cliente
                const perguntaRuim = mensagemAleatoria(respostasNPS.detrator_pergunta);
                await sock.sendMessage(from, { text: perguntaRuim });
            } else {
                // 👇 ALTERAÇÃO: Manda o texto do cliente de nota alta com o link do Google tudo na mesma mensagem
                await sock.sendMessage(from, { text: respostasNPS.promotor_agradecimento });
            }
            
            console.log(`[Fluxo] ${lead.nome} deu nota ${nota}. Próxima fase: ${proximaFase}`);
        }
    } catch (error) {
        console.error(`[Fluxo] Erro ao processar bloco de ${lead.nome}:`, error);
    }
}

module.exports = { executar };