const { Queue } = require('bullmq');
const IORedis = require('ioredis');

// Conexão com o Redis (usando a variável do seu .env)
const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null,
});

// Criamos a fila chamada "pos-venda-rissato"
const posVendaQueue = new Queue('pos-venda-rissato', { connection });

/**
 * Agenda as mensagens de 1 dia e 6 meses
 */
// Chat/RissatoMotors/scheduler.js (Apenas a função agendarMensagens)

async function agendarMensagens(cliente) {
  const { telefone, nome, dataSaida } = cliente;

  // Usa variáveis de ambiente para facilitar testes futuros. Se não existir, usa o tempo real.
  // 1 dia = 24 * 60 * 60 * 1000 = 86400000 ms
  const delay24h = process.env.DELAY_24H ? parseInt(process.env.DELAY_24H) : 86400000; 
  
  await posVendaQueue.add(
    'feedback_24h',
    { telefone, nome, tipo: '24h' },
    { delay: delay24h, jobId: `24h-${telefone}-${dataSaida}` } 
  );

  // 6 meses = 180 dias * 24 * 60 * 60 * 1000 = 15552000000 ms
  const delay6meses = process.env.DELAY_6MESES ? parseInt(process.env.DELAY_6MESES) : 15552000000;
  
  await posVendaQueue.add(
    'revisao_6meses',
    { telefone, nome, tipo: '6meses' },
    { delay: delay6meses, jobId: `6meses-${telefone}-${dataSaida}` }
  );

  console.log(`[Scheduler] Pós-venda agendado para ${nome}: 24h e 6 meses.`);
}

module.exports = { agendarMensagens, posVendaQueue };