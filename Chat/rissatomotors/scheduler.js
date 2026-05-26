const { Queue } = require('bullmq');
const connection = require('../../DataBase/redis');

const posVendaQueue = new Queue('pos-venda-rissato', { connection });

// Sua função antiga (mantida para segurança/testes)
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

  console.log(`[Scheduler] Pós-venda agendado com delay para ${nome}.`);
}

//  NOVA FUNÇÃO PARA O CRONJOB (SEM DELAY)
async function dispararMensagemImediata(lead) {
    const { telefone, nome, tipo_envio, id_banco, veiculo, placa } = lead; 
    
    await posVendaQueue.add(
        tipo_envio, 
        { 
            telefone, 
            nome, 
            tipo: tipo_envio, 
            idBanco: id_banco,
            veiculo: veiculo, 
            placa: placa
        },
        { 
            removeOnComplete: true,
            attempts: 5,          // ✅ Retenta até 5 vezes
            backoff: {
                type: 'fixed',
                delay: 15000      // ✅ Espera 15s entre cada tentativa
            }
        } 
    );

    console.log(`[Fila Redis] Lead ${nome} adicionado para disparo IMEDIATO (${tipo_envio}).`);
}

// Atualize a exportação para incluir a nova função
module.exports = { agendarMensagens, dispararMensagemImediata, posVendaQueue };