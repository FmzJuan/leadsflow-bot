const { Worker } = require('bullmq');
const connection = require('../../DataBase/redis'); 
const { mensagens24h, mensagens5meses } = require('./mensagens'); 
const { salvarNoSheets } = require('../../Functions/googleSheets');
const { query } = require('../../DataBase/conection');
const { getClientSocket } = require('../../Engine/whatsapp');
const { normalizarJid } = require('../../utils/formatador');

async function enviarMensagemHumana(sock, jid, texto, job) {
    if (process.env.DRY_RUN === 'true') {
        console.log(`\x1b[33m[DRY-RUN] Simulação ativada. Mensagem que seria enviada para ${jid}: \x1b[0m\n"${texto}"\n`);
        return; 
    }

    if (!sock) {
        throw new Error(`Socket inexistente para ${jid}. WhatsApp não conectado.`);
    }

    try {
        await sock.sendPresenceUpdate('composing', jid);
        const tempoDigitando = Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000;
        console.log(`[Worker] Simulando digitação por ${tempoDigitando / 1000}s para ${jid}...`);
        await new Promise(resolve => setTimeout(resolve, tempoDigitando));
        
        // Envia a mensagem ativa
        const msgEnviada = await sock.sendMessage(jid, { text: texto });

        // Correção do Erro 2 e 3: Como sock.store não existe, tentamos buscar no banco o LID gerado se houver
        // No envio ativo para novos contatos, o WhatsApp pode vincular o LID internamente.
        // Se o job trouxe o idBanco (ID da tabela leads), garantimos a atualização dela.
        if (job?.data?.idBanco) {
            await query(
                `UPDATE leads SET status_envio = 'enviado', fase_bot = 'aguardando_nps', atualizado_em = CURRENT_TIMESTAMP WHERE id = $1`, 
                [job.data.idBanco]
            );
            console.log(`[Worker] Tabela 'leads' atualizada para o Lead ID: ${job.data.idBanco} (status_envio='enviado')`);
        }

        await sock.sendPresenceUpdate('paused', jid);
    } catch (error) {
        console.error(`[Worker] Erro ao enviar mensagem humana para ${jid}:`, error);
        throw error; 
    }
}

function iniciarWorker(clienteId) {
    const worker = new Worker('pos-venda-rissato', async job => {
        
        const sock = getClientSocket(clienteId);

        if (!sock) {
            throw new Error(`WhatsApp desconectado. Job será retentado automaticamente.`);
        }

        const { telefone, nome, tipo, idBanco, veiculo, placa } = job.data; 
        const primeiroNome = nome.split(' ')[0];
        
        // Normaliza o JID antes de usar
        const jidNormalizado = normalizarJid(`${telefone.replace(/\D/g, '')}@s.whatsapp.net`);

        // Correção do Erro 1: Alterado split('%2C') para split(',')
        const envLista = process.env.NUMEROS_PERMITIDOS || "";
        const numerosPermitidos = envLista.split(',').map(n => n.trim().replace(/\D/g, '')).filter(n => n.length > 0);

        if (numerosPermitidos.length > 0) {
            const numeroClienteLimpo = jidNormalizado.split('@')[0].replace(/\D/g, '');
            const numeroAutorizado = numerosPermitidos.some(numeroEnv => 
                numeroClienteLimpo.includes(numeroEnv) || numeroEnv.includes(numeroClienteLimpo)
            );
            if (!numeroAutorizado) {
                console.log(`[TESTE] Bloqueado: ${telefone} não bate com a lista do .env.`);
                return; 
            }
        }

        console.log(`[Worker] Processando disparo liberado para: ${nome} (${tipo}) JID: ${jidNormalizado}`);

        if (tipo === '24h' || tipo === 'pos_venda_24h') {
            const arraySorteio = mensagens24h; 
            const textoSorteado = arraySorteio[Math.floor(Math.random() * arraySorteio.length)];
            const textoFinal = textoSorteado
                .replace('{nome}', primeiroNome)
                .replace('{model_car}', veiculo || 'seu veículo') 
                .replace('{car_plate}', placa || 'não informada');

            // Dispara a mensagem humana e atualiza a tabela 'leads' internamente
            await enviarMensagemHumana(sock, jidNormalizado, textoFinal, job);

            const dadosParaPlanilha = [
                new Date().toLocaleString('pt-BR'), nome, telefone, `Pós-Venda ${tipo}`, 'Aguardando Avaliação'
            ];
            await salvarNoSheets(dadosParaPlanilha, 1);

            // Correção do Erro 4: Mantém a tabela 'clientes' atualizada com o status que o fluxo.js espera ('pos_vendas_enviado')
            await query(
                "INSERT INTO clientes (whatsapp_id, status) VALUES ($1, 'pos_vendas_enviado') ON CONFLICT (whatsapp_id) DO UPDATE SET status = 'pos_vendas_enviado', atualizado_em = CURRENT_TIMESTAMP", 
                [jidNormalizado]
            );
            console.log(`[Worker] Cliente ${jidNormalizado} marcado como 'pos_vendas_enviado' na tabela clientes.`);

        } else {
            const arraySorteio = mensagens5meses; 
            const textoSorteado = arraySorteio[Math.floor(Math.random() * arraySorteio.length)];
            const textoFinal = textoSorteado
                .replace('{nome}', primeiroNome)
                .replace('{model_car}', veiculo || 'seu veículo') 
                .replace('{car_plate}', placa || 'não informada');

            await enviarMensagemHumana(sock, jidNormalizado, textoFinal, job);

            const dadosParaPlanilha = [
                new Date().toLocaleString('pt-BR'), nome, telefone, `Pós-Venda ${tipo}`, 'Mensagem Enviada'
            ];
            await salvarNoSheets(dadosParaPlanilha, 1);

            // Mantém sincronia para o disparo de 5 meses
            await query(
                "INSERT INTO clientes (whatsapp_id, status) VALUES ($1, 'enviado') ON CONFLICT (whatsapp_id) DO UPDATE SET status = 'enviado', atualizado_em = CURRENT_TIMESTAMP", 
                [jidNormalizado]
            );
            console.log(`[Worker] Cliente ${jidNormalizado} marcado como 'enviado'.`);
        }

    }, { 
        connection,
        concurrency: 1
    });

    worker.on('completed', job => {
        console.log(`✅ [Worker] Job ${job.id} concluído com sucesso!`);
    });

    worker.on('failed', (job, err) => {
        console.error(`❌ [Worker] Falha no job ${job.id} (tentativa ${job.attemptsMade}/${job.opts.attempts}):`, err.message);
    });

    console.log(`👷 Worker BullMQ da Rissato Motors pronto para processar jobs.`);
}

module.exports = { iniciarWorker };