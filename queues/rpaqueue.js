// Arquivo: Queues/rpaQueue.js
const { Queue } = require('bullmq');
const redisConnection = require('../DataBase/redis');

// Criamos a fila chamada 'rpa-sync'
const rpaQueue = new Queue('rpa-sync', {
    connection: redisConnection
});

/**
 * Adiciona um novo trabalho de sincronização na fila
 */
async function adicionarAoFluxoRPA(clienteId, credenciais) {
    await rpaQueue.add(`sync-tenant-${clienteId}`, {
        clienteId,
        credenciais
    }, {
        attempts: 3, // Se falhar, tenta mais 2 vezes
        backoff: {
            type: 'exponential',
            delay: 60000 // Espera 1 minuto antes de tentar de novo
        },
        removeOnComplete: true, // Limpa o Redis após concluir
        removeOnFail: false    // Mantém o log se falhar para podermos debugar
    });

    console.log(`[Queue] Job de sincronização agendado para o Cliente ${clienteId}`);
}

module.exports = { adicionarAoFluxoRPA };