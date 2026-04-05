// Chat/RissatoMotors/worker.js
const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const { mensagens24h, mensagens6meses } = require('./mensagens'); 
const { salvarNoSheets } = require('../../Functions/googleSheets');

// Use este padrão de conexão (igual ao seu DataBase/redis.js)
const connection = new IORedis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASS || undefined,
    maxRetriesPerRequest: null 
});

async function enviarMensagemHumana(sock, jid, texto) {
    try {
        await sock.sendPresenceUpdate('composing', jid);
        const tempoDigitando = Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000;
        console.log(`[Worker] Simulando digitação por ${tempoDigitando / 1000}s para ${jid}...`);
        await new Promise(resolve => setTimeout(resolve, tempoDigitando));

        await sock.sendMessage(jid, { text: texto });
        await sock.sendPresenceUpdate('paused', jid);
    } catch (error) {
        console.error(`[Worker] Erro ao enviar mensagem humana para ${jid}:`, error);
    }
}

function iniciarWorker(sock) {
    const worker = new Worker('pos-venda-rissato', async job => {
        const { telefone, nome, tipo } = job.data;
        const jid = `${telefone}@s.whatsapp.net`;
        
        const arraySorteio = tipo === '24h' ? mensagens24h : mensagens6meses;
        const textoSorteado = arraySorteio[Math.floor(Math.random() * arraySorteio.length)];
        const textoFinal = textoSorteado.replace('{nome}', nome.split(' ')[0]);

        console.log(`[Worker] Preparando disparo para ${nome} (${tipo})`);
        
        // 1. Envia a mensagem
        await enviarMensagemHumana(sock, jid, textoFinal);

        // 2. SALVA NA PLANILHA (DENTRO do processamento do job)
        const dadosParaPlanilha = [
            new Date().toLocaleString('pt-BR'), 
            nome, 
            telefone, 
            `Pós-Venda ${tipo}`, 
            'Mensagem Enviada'
        ];
        await salvarNoSheets(dadosParaPlanilha, 1); 

    }, { connection });

    worker.on('completed', job => console.log(`✅ [Worker] Job ${job.id} concluído com sucesso!`));
    worker.on('failed', (job, err) => console.error(`❌ [Worker] Falha no job ${job.id}:`, err));
}

module.exports = { iniciarWorker };