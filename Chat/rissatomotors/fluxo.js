// Chat/RissatoMotors/fluxo.js

const { query } = require('../../DataBase/conection');
const { respostasNPS } = require('./mensagens');

async function executar(sock, msg) {
    const from = msg.key.remoteJid;
    const texto = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || "").trim();

    if (!texto) return;

    // 1. Limpa o número recebido
    let numeroLimpo = from.replace(/\D/g, '');

    // 🛡️ TRADUTOR DE LID (Resolve o problema do número de teste da Amanda)
    if (numeroLimpo === '67319736848503') {
        numeroLimpo = '5511976378041'; 
    }

    try {
        // 2. Busca o cliente no banco 
        const result = await query(`
            SELECT id, nome, fase_bot 
            FROM leads 
            WHERE celular LIKE $1 OR celular = $2
            LIMIT 1
        `, [`%${numeroLimpo}%`, from.split('@')[0]]);

        const lead = result.rows[0];

        // Se não achou ou não está em uma fase interativa, ignora a mensagem
        if (!lead || (lead.fase_bot !== 'aguardando_nps' && lead.fase_bot !== 'aguardando_feedback_ruim')) {
            return; 
        }

        console.log(`[Fluxo] Processando resposta de ${lead.nome}. Fase: ${lead.fase_bot} | Texto recebido: "${texto}"`);

        // =================================================================
        // FLUXO B: RECEBENDO O MOTIVO DA NOTA BAIXA (Resposta à nota 0 a 6)
        // =================================================================
        if (lead.fase_bot === 'aguardando_feedback_ruim') {
            await sock.sendPresenceUpdate('composing', from);
            await new Promise(resolve => setTimeout(resolve, 3000)); // Tempo digitando

            
            await sock.sendMessage(from, { text: respostasNPS.detrator_agradecimento });

            // Encerra o fluxo e deixa livre para um humano ler se quiser
            await query("UPDATE leads SET fase_bot = 'pausado_humano', atualizado_em = CURRENT_TIMESTAMP WHERE id = $1", [lead.id]);
            console.log(`[Fluxo] ${lead.nome} enviou o motivo da nota baixa. Bot finalizado (pausado_humano).`);
            return; // Para a execução aqui
        }

        // =================================================================
        // FLUXO A: RECEBENDO A NOTA DE 0 A 10
        // =================================================================
        if (lead.fase_bot === 'aguardando_nps') {
            
            // 3. TRY/CATCH DA NOTA
            if (!/^\d+$/.test(texto)) {
                await sock.sendMessage(from, { text: "Por favor, responda apenas com um numero de 0 a 10 para avaliarmos nosso servico!" });
                return; 
            }

            const nota = parseInt(texto, 10);

            if (nota < 0 || nota > 10) {
                await sock.sendMessage(from, { text: "A nota precisa ser um numero entre 0 e 10. Como foi sua experiencia?" });
                return;
            }

            await sock.sendPresenceUpdate('composing', from);
            await new Promise(resolve => setTimeout(resolve, 2000)); 

            // 🔥 4. A MÁGICA DO IF/ELSE 🔥
            if (nota >= 0 && nota <= 6) {
                // DETRATOR
                
                await sock.sendMessage(from, { text: respostasNPS.detrator_pergunta });

                // MUDA A FASE PARA ESPERAR O TEXTO DE RECLAMAÇÃO (Cai no Fluxo B na próxima mensagem)
                await query("UPDATE leads SET fase_bot = 'aguardando_feedback_ruim', atualizado_em = CURRENT_TIMESTAMP WHERE id = $1", [lead.id]);
                console.log(`[Fluxo] ${lead.nome} deu nota ${nota}. Aguardando feedback escrito...`);

            } else if (nota >= 7 && nota <= 10) {
                // PROMOTOR
                
                // 🛑 SOLUÇÃO DO ERRO DO "OK": ATUALIZA O BANCO IMEDIATAMENTE
                // Assim o bot já ignora qualquer "ok" ou "blz" digitado durante os 15 segundos
                await query("UPDATE leads SET fase_bot = 'inativo', atualizado_em = CURRENT_TIMESTAMP WHERE id = $1", [lead.id]);

                const msgBoa = "Muito obrigado pela sua avaliacao, isso ajuda muito a melhorar o nosso trabalho! Voce poderia nos avaliar no Google para que todos saibam da qualidade do nosso servico? Sua avaliacao e muito importante para a gente!";
                await sock.sendMessage(from, { text: respostasNPS.promotor_agradecimento });

                // DELAY DE 15 SEGUNDOS REAIS
                console.log(`[Fluxo] Aguardando 15s para enviar o link do Google para ${lead.nome}...`);
                await sock.sendPresenceUpdate('paused', from); 
                await new Promise(resolve => setTimeout(resolve, 15000)); 

                // ENVIA O LINK DO GOOGLE APÓS OS 15 SEGUNDOS
                await sock.sendPresenceUpdate('composing', from);
                await new Promise(resolve => setTimeout(resolve, 2000));
                const msgLink = "Segue o link: https://g.page/r/Cf9Mnbdd6dKmEBM/review";
                await sock.sendMessage(from, { text: respostasNPS.promotor_link });

                console.log(`[Fluxo] ${lead.nome} deu nota ${nota}. Link enviado com sucesso.`);
            }
        }

    } catch (error) {
        console.error(`[Fluxo] Erro ao processar mensagem de ${from}:`, error);
    }
}

module.exports = { executar };