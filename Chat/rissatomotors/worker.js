// Chat/RissatoMotors/worker.js
const { Worker } = require('bullmq');
const connection = require('../../DataBase/redis'); // ✅ conexão centralizada
const { mensagens24h, mensagens6meses } = require('./mensagens'); 
const { salvarNoSheets } = require('../../Functions/googleSheets');

/**
 * Simula a digitação humana antes de enviar a mensagem
 */
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

/**
 * Inicia o processamento da fila de mensagens
 */
function iniciarWorker(sock) {
    const worker = new Worker('pos-venda-rissato', async job => {
        const { telefone, nome, tipo } = job.data;
        const jid = `${telefone}@s.whatsapp.net`;
        
        const arraySorteio = tipo === '24h' ? mensagens24h : mensagens6meses;
        const textoSorteado = arraySorteio[Math.floor(Math.random() * arraySorteio.length)];
        const textoFinal = textoSorteado.replace('{nome}', nome.split(' ')[0]);

        console.log(`[Worker] Processando disparo para: ${nome} (${tipo})`);
        
        await enviarMensagemHumana(sock, jid, textoFinal);

        const dadosParaPlanilha = [
            new Date().toLocaleString('pt-BR'), 
            nome, 
            telefone, 
            `Pós-Venda ${tipo}`, 
            'Mensagem Enviada'
        ];
        
        await salvarNoSheets(dadosParaPlanilha, 1); 

    }, { connection });

    worker.on('completed', job => {
        console.log(`✅ [Worker] Job ${job.id} (Envio para ${job.data.nome}) concluído!`);
    });

    worker.on('failed', (job, err) => {
        console.error(`❌ [Worker] Falha no job ${job.id}:`, err.message);
    });

    console.log(`👷 Worker BullMQ da Rissato Motors pronto para processar jobs.`);
}

module.exports = { iniciarWorker };