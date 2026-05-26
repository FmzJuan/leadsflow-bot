const cron = require('node-cron');
const { query } = require('../../DataBase/conection'); 
const { dispararMensagemImediata } = require('./scheduler');

function iniciarCronJobs() {
    console.log("⏰ Motor de Agendamentos Iniciado. Varredura programada para as 08:00 AM.");

    cron.schedule('* * * * *', async() => {
        try {
            const result = await query(`
                SELECT id, cliente_id, nome, celular, veiculo, placa, tipo_envio 
                FROM leads 
                WHERE data_agendada <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date 
                AND status_envio = 'pendente'
            `);

            const leadsDoDia = result.rows;
            if (leadsDoDia.length === 0) return; 

            console.log(`\n🔍 CRONJOB ACHOU ${leadsDoDia.length} LEADS PENDENTES!`);

            for (const lead of leadsDoDia) {
                try {
                    // ✅ Tenta enfileirar o job
                    await dispararMensagemImediata({
                        telefone: lead.celular,
                        nome: lead.nome,
                        tipo_envio: lead.tipo_envio,
                        id_banco: lead.id,
                        veiculo: lead.veiculo,
                        placa: lead.placa
                    });

                    // ✅ Só muda o status se entrou na fila com sucesso
                    await query(`
                        UPDATE leads 
                        SET status_envio = 'processando', atualizado_em = CURRENT_TIMESTAMP 
                        WHERE id = $1
                    `, [lead.id]);

                } catch (errLead) {
                    // ✅ Se falhar, NÃO atualiza o status — cron pega de novo no próximo minuto
                    console.error(`❌ [CronJob] Falha ao enfileirar lead ${lead.nome} (id: ${lead.id}):`, errLead.message);
                }
            }

        } catch (error) {
            console.error("❌ Erro ao rodar o CronJob diário:", error);
        }
    }, { timezone: "America/Sao_Paulo" });
}

module.exports = { iniciarCronJobs };