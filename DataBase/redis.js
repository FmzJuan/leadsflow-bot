const { Redis } = require('ioredis');

// Instancia a conexão com o Redis (rodando no seu Docker)
const redisConnection = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASS || undefined,
    // Essa configuração maxRetriesPerRequest: null é OBRIGATÓRIA para o BullMQ funcionar
    maxRetriesPerRequest: null 
});

// Testa a conexão ao iniciar (Mesmo padrão do seu Postgres)
redisConnection.on('connect', () => {
    console.log('📦 [Redis] Conectado com sucesso. Motor de filas pronto!');
});

redisConnection.on('error', (err) => {
    console.error('❌ [Redis] Falha na conexão:', err.message);
});

module.exports = redisConnection;