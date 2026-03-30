// Chat/RissatoMotors/worker.js
const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const { mensagens24h, mensagens6meses } = require('./mensagens'); // Importa os arrays

const connection = new IORedis({ host: process.env.REDIS_HOST || 'localhost', maxRetriesPerRequest: null });

// 🤖 Função de Envio Humanizado (Anti-Ban)
async function enviarMensagemHumana(sock, jid, texto) {
    try {
        // 1. Avisa o WhatsApp que está "digitando..."
        await sock.sendPresenceUpdate('composing', jid);
        
        // 2. Aguarda um tempo aleatório entre 10 e 20 segundos
        const tempoDigitando = Math.floor(Math.random() * (20000 - 10000 + 1)) + 10000;
        console.log(`[Worker] Simulando digitação por ${tempoDigitando / 1000}s para ${jid}...`);
        await new Promise(resolve => setTimeout(resolve, tempoDigitando));

        // 3. Envia a mensagem e para de "digitar"
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
        
        // Escolhe qual array usar
        const arraySorteio = tipo === '24h' ? mensagens24h : mensagens6meses;
        
        // Sorteia 1 frase aleatória do array
        const textoSorteado = arraySorteio[Math.floor(Math.random() * arraySorteio.length)];
        
        // Troca a tag {nome} pelo nome real do cliente
        const textoFinal = textoSorteado.replace('{nome}', nome.split(' ')[0]); // Pega só o primeiro nome

        console.log(`[Worker] Preparando disparo para ${nome} (${tipo})`);
        
        // Dispara usando a função humanizada
        await enviarMensagemHumana(sock, jid, textoFinal);

    }, { connection });

    worker.on('completed', job => console.log(`✅ [Worker] Job ${job.id} concluído com sucesso!`));
    worker.on('failed', (job, err) => console.error(`❌ [Worker] Falha no job ${job.id}:`, err));
}

module.exports = { iniciarWorker };