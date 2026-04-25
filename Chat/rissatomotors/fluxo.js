// Chat/RissatoMotors/fluxo.js

const { query } = require('../../DataBase/conection');
const { respostasNPS } = require('./mensagens');

// ✅ Trava em memória: evita processar o mesmo lead em paralelo
const leadsEmProcessamento = new Set();

async function executar(sock, msg) {
    // O remoteJid já vem resolvido pelo whatsapp.js (LID -> JID)
    const from = msg.key.remoteJid;
    const texto = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || "").trim();

    if (!texto) return;

    const numeroLimpo = from.replace(/\D/g, '');

    try {
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

        // ✅ Se esse lead já está sendo processado, ignora a mensagem
        if (leadsEmProcessamento.has(lead.id)) {
            console.log(`[Fluxo] ⚠️ Lead ${lead.nome} já em processamento. Mensagem ignorada.`);
            return;
        }

        // ✅ Trava o lead antes de qualquer await
        leadsEmProcessamento.add(lead.id);

        console.log(`[Fluxo] Processando resposta de ${lead.nome}. Fase: ${lead.fase_bot} | Texto recebido: "${texto}"`);

        try {
            // =================================================================
            // FLUXO B: RECEBENDO O MOTIVO DA NOTA BAIXA (Resposta à nota 0 a 6)
            // =================================================================
            if (lead.fase_bot === 'aguardando_feedback_ruim') {
                await sock.sendPresenceUpdate('composing', from);
                await new Promise(resolve => setTimeout(resolve, 3000));

                await sock.sendMessage(from, { text: respostasNPS.detrator_agradecimento });

                await query("UPDATE leads SET fase_bot = 'pausado_humano', atualizado_em = CURRENT_TIMESTAMP WHERE id = $1", [lead.id]);
                console.log(`[Fluxo] ${lead.nome} enviou o motivo da nota baixa. Bot finalizado (pausado_humano).`);
                return;
            }

            // =================================================================
            // FLUXO A: RECEBENDO A NOTA DE 0 A 10
            // =================================================================
            if (lead.fase_bot === 'aguardando_nps') {

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

                if (nota >= 0 && nota <= 6) {
                    // DETRATOR
                    await sock.sendMessage(from, { text: respostasNPS.detrator_pergunta });
                    await query("UPDATE leads SET fase_bot = 'aguardando_feedback_ruim', atualizado_em = CURRENT_TIMESTAMP WHERE id = $1", [lead.id]);
                    console.log(`[Fluxo] ${lead.nome} deu nota ${nota}. Aguardando feedback escrito...`);

                } else if (nota >= 7 && nota <= 10) {
                    // PROMOTOR — atualiza ANTES de qualquer delay para bloquear novas mensagens
                    await query("UPDATE leads SET fase_bot = 'inativo', atualizado_em = CURRENT_TIMESTAMP WHERE id = $1", [lead.id]);

                    await sock.sendMessage(from, { text: respostasNPS.promotor_agradecimento });

                    console.log(`[Fluxo] Aguardando 15s para enviar link do Google para ${lead.nome}...`);
                    await sock.sendPresenceUpdate('paused', from); 
                    await new Promise(resolve => setTimeout(resolve, 15000)); 

                    await sock.sendPresenceUpdate('composing', from);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await sock.sendMessage(from, { text: respostasNPS.promotor_link });

                    console.log(`[Fluxo] ${lead.nome} deu nota ${nota}. Link enviado com sucesso.`);
                }
            }

        } finally {
            // ✅ Sempre libera a trava, mesmo se der erro
            leadsEmProcessamento.delete(lead.id);
        }

    } catch (error) {
        console.error(`[Fluxo] Erro ao processar mensagem de ${from}:`, error);
        leadsEmProcessamento.delete(lead.id); // segurança extra
    }
}

module.exports = { executar };