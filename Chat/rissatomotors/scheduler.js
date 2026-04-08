const { Queue } = require('bullmq');
const connection = require('../../DataBase/redis');

const posVendaQueue = new Queue('pos-venda-rissato', { connection });

async function agendarMensagens(cliente) {
  const { telefone, nome, dataSaida } = cliente;
  const saida = dataSaida || Date.now().toString();

  const delay24h = Number(process.env.DELAY_24H) || 86400000;
  await posVendaQueue.add(
    'feedback_24h',
    { telefone, nome, tipo: '24h' },
    { delay: delay24h, jobId: `24h-${telefone}-${saida}` }
  );

  const delay6meses = Number(process.env.DELAY_6MESES) || 15552000000;
  await posVendaQueue.add(
    'revisao_6meses',
    { telefone, nome, tipo: '6meses' },
    { delay: delay6meses, jobId: `6meses-${telefone}-${saida}` }
  );

  console.log(`[Scheduler] Pós-venda agendado para ${nome}: 24h e 6 meses.`);
}

module.exports = { agendarMensagens, posVendaQueue };