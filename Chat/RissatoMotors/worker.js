// Chat/RissatoMotors/worker.js
const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const { mensagens24h, mensagens6meses } = require('./mensagens'); 
const { salvarNoSheets } = require('../../Functions/googleSheets');

// CONFIGURAÇÃO DE CONEXÃO (Ajustada para Docker/VPS)
const connection = new IORedis({
    host: process.env.REDIS_HOST || '127.0.0.1', // Na VPS o Coolify usará 'redis'
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASS || undefined,
    maxRetriesPerRequest: null 
});

/**
 * Simula a digitação humana antes de enviar a mensagem
 */
async function enviarMensagemHumana(sock, jid, texto) {
    try {
        // 1. Status "Digitando..."
        await sock.sendPresenceUpdate('composing', jid);
        
        // 2. Tempo de espera aleatório (3 a 5 segundos para teste)
        const tempoDigitando = Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000;
        console.log(`[Worker] Simulando digitação por ${tempoDigitando / 1000}s para ${jid}...`);
        await new Promise(resolve => setTimeout(resolve, tempoDigitando));

        // 3. Envia e pausa status
        await sock.sendMessage(jid, { text: texto });
        await sock.sendPresenceUpdate('paused', jid);
    } catch (error) {
        console.error(`[Worker] Erro ao enviar mensagem humana para ${jid}:`, error);
    }
}

/**
 * Inicia o processamento da fila de mensagens
 */
function iniciarWorker(sock) {
    // Criamos o Worker ouvindo a fila específica do cliente
    const worker = new Worker('pos-venda-rissato', async job => {
        const { telefone, nome, tipo } = job.data;
        const jid = `${telefone}@s.whatsapp.net`;
        
        // Lógica de sorteio de mensagem
        const arraySorteio = tipo === '24h' ? mensagens24h : mensagens6meses;
        const textoSorteado = arraySorteio[Math.floor(Math.random() * arraySorteio.length)];
        const textoFinal = textoSorteado.replace('{nome}', nome.split(' ')[0]);

        console.log(`[Worker] Processando disparo para: ${nome} (${tipo})`);
        
        // EXECUÇÃO 1: Enviar via WhatsApp
        await enviarMensagemHumana(sock, jid, textoFinal);

        // EXECUÇÃO 2: Registrar na planilha Leads_PreVenda
        const dadosParaPlanilha = [
            new Date().toLocaleString('pt-BR'), 
            nome, 
            telefone, 
            `Pós-Venda ${tipo}`, 
            'Mensagem Enviada'
        ];
        
        // Chamada assíncrona para o Google Sheets
        await salvarNoSheets(dadosParaPlanilha, 1); 

    }, { connection });

    // LOGS DE MONITORAMENTO
    worker.on('completed', job => {
        console.log(`✅ [Worker] Job ${job.id} (Envio para ${job.data.nome}) concluído!`);
    });

    worker.on('failed', (job, err) => {
        console.error(`❌ [Worker] Falha no job ${job.id}:`, err.message);
    });

    console.log(`👷 Worker BullMQ da Rissato Motors pronto para processar jobs.`);
}

module.exports = { iniciarWorker };