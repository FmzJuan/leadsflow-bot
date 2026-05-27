// Chat/RissatoMotors/cron.js

const cron = require('node-cron');
const { query } = require('../../DataBase/conection'); 
const { dispararMensagemImediata } = require('./scheduler');

function iniciarCronJobs() {
    console.log("⏰ Motor de Agendamentos Iniciado. Varredura a cada minuto.");

    cron.schedule('* * * * *', async () => {
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
                    // ✅ Marca como 'processando' ANTES de enfileirar
                    // Isso evita que o cron pegue o mesmo lead no próximo minuto
                    await query(`
                        UPDATE leads 
                        SET status_envio = 'processando', atualizado_em = CURRENT_TIMESTAMP 
                        WHERE id = $1 AND status_envio = 'pendente'
                    `, [lead.id]);

                    // ✅ Só enfileira depois de travar o status
                    await dispararMensagemImediata({
                        telefone: lead.celular,
                        nome: lead.nome,
                        tipo_envio: lead.tipo_envio,
                        id_banco: lead.id,
                        veiculo: lead.veiculo,
                        placa: lead.placa
                    });

                } catch (errLead) {
                    // ✅ Se falhar ao enfileirar, volta para 'pendente' para o cron tentar de novo
                    console.error(`❌ [CronJob] Falha ao enfileirar lead ${lead.nome} (id: ${lead.id}):`, errLead.message);
                    await query(`
                        UPDATE leads SET status_envio = 'pendente' WHERE id = $1
                    `, [lead.id]).catch(() => {});
                }
            }

        } catch (error) {
            console.error("❌ Erro ao rodar o CronJob diário:", error);
        }
    }, { timezone: "America/Sao_Paulo" });
}

module.exports = { iniciarCronJobs };