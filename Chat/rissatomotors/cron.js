const cron = require('node-cron');
const { query } = require('../../DataBase/conection'); 
const { dispararMensagemImediata } = require('./scheduler');

function iniciarCronJobs() {
    console.log("⏰ Motor de Agendamentos Iniciado. Varredura programada para as 08:00 AM.");

    // ✅ Roda todos os dias às 08:00 no fuso de São Paulo
    cron.schedule('0 8 * * *', async () => {
        try {
            // ✅ Ajuste cirúrgico do Fuso Horário na Query
            const result = await query(`
                SELECT id, cliente_id, nome, celular, veiculo, tipo_envio 
                FROM leads 
                WHERE data_agendada <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date 
                AND status_envio = 'pendente'
            `);

            const leadsDoDia = result.rows;

            if (leadsDoDia.length === 0) return; 

            console.log(`\n🔍 CRONJOB ACHOU ${leadsDoDia.length} LEADS PENDENTES!`);

            for (const lead of leadsDoDia) {
                await dispararMensagemImediata({
                    telefone: lead.celular,
                    nome: lead.nome,
                    tipo_envio: lead.tipo_envio,
                    id_banco: lead.id
                });

                await query(`
                    UPDATE leads 
                    SET status_envio = 'processando', atualizado_em = CURRENT_TIMESTAMP 
                    WHERE id = $1
                `, [lead.id]);
            }

        } catch (error) {
            console.error("❌ Erro ao rodar o CronJob diário:", error);
        }
    }, { timezone: "America/Sao_Paulo" }); // Garante que o Node obedeça o horário BR
}

module.exports = { iniciarCronJobs };