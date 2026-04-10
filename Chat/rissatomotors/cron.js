const cron = require('node-cron');
const { query } = require('../../DataBase/conection'); 
const { dispararMensagemImediata } = require('./scheduler');

function iniciarCronJobs() {
    console.log("⏰ Motor de Agendamentos Iniciado. Teste a cada 1 minuto.");

    cron.schedule('* * * * *', async () => {
        try {
            const result = await query(`
                SELECT id, cliente_id, nome, celular, veiculo, tipo_envio 
                FROM leads 
                WHERE data_agendada <= CURRENT_DATE 
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
    });
}

module.exports = { iniciarCronJobs };