// Arquivo: Workers/rpaWorker.js
const { Worker } = require('bullmq');
const redisConnection = require('../DataBase/redis');
const { extrairDadosDoERP } = require('../Chat/rissatomotors/erpSync');

// O Worker fica "vigiando" a fila 'rpa-sync'
const rpaWorker = new Worker('rpa-sync', async (job) => {
    const { clienteId, credenciais } = job.data;
    
    console.log(`👷 [Worker] Iniciando processamento para o Cliente ${clienteId}...`);
    
    // Aqui chamamos o motor RPA que já blindamos e testamos!
    await extrairDadosDoERP(clienteId, credenciais);

    console.log(`✅ [Worker] Sincronização concluída para o Cliente ${clienteId}`);
}, {
    connection: redisConnection,
    concurrency: 2 // Permite rodar até 2 robôs simultâneos (ajuste conforme sua RAM na VPS)
});

rpaWorker.on('failed', (job, err) => {
    console.error(`❌ [Worker] Falha no Job ${job.id}: ${err.message}`);
});

module.exports = rpaWorker;