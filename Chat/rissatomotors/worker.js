const { Worker } = require(\'bullmq\');
const connection = require(\'../../DataBase/redis\'); 
const { mensagens24h, mensagens5meses } = require(\'./mensagens\'); 
const { salvarNoSheets } = require(\'../../Functions/googleSheets\');
const { query } = require(\'../../DataBase/conection\');
const { getClientSocket } = require(\'../../Engine/whatsapp\');
const { normalizarJid } = require(\'../../utils/formatador\');

async function enviarMensagemHumana(sock, jid, texto, job) {
    if (process.env.DRY_RUN === \'true\') {
        console.log(`\x1b[33m[DRY-RUN] Simulação ativada. Mensagem que seria enviada para ${jid}: \x1b[0m\n\"${texto}\"\n`);
        return; 
    }

    if (!sock) {
        throw new Error(`Socket inexistente para ${jid}. WhatsApp não conectado.`);
    }

    try {
        await sock.sendPresenceUpdate(\'composing\', jid);
        const tempoDigitando = Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000;
        console.log(`[Worker] Simulando digitação por ${tempoDigitando / 1000}s para ${jid}...`);
        await new Promise(resolve => setTimeout(resolve, tempoDigitando));
        
        const msgEnviada = await sock.sendMessage(jid, { text: texto });

        const lidRetornado = msgEnviada?.key?.remoteJid;
        if (lidRetornado && lidRetornado.endsWith(\'@lid\')) {
            await connection.set(`lid:${lidRetornado}`, jid);
            console.log(`[Worker] LID mapeado no envio: ${lidRetornado} -> ${jid}`);
            if (job?.data?.idBanco) {
                // Atualiza o LID na tabela leads, se ainda for necessário
                await query(\'UPDATE leads SET lid = $1 WHERE id = $2\', [lidRetornado, job.data.idBanco]);
            }
        } else {
            const contato = sock.store?.contacts?.[jid];
            if (contato?.lid) {
                await connection.set(`lid:${contato.lid}`, jid);
                if (job?.data?.idBanco) {
                    // Atualiza o LID na tabela leads, se ainda for necessário
                    await query(\'UPDATE leads SET lid = $1 WHERE id = $2\', [contato.lid, job.data.idBanco]);
                }
            }
        }

        await sock.sendPresenceUpdate(\'paused\', jid);
    } catch (error) {
        console.error(`[Worker] Erro ao enviar mensagem humana para ${jid}:`, error);
        throw error; 
    }
}

function iniciarWorker(clienteId) {
    const worker = new Worker(\'pos-venda-rissato\', async job => {
        
        const sock = getClientSocket(clienteId);

        if (!sock) {
            throw new Error(`WhatsApp desconectado. Job será retentado automaticamente.`);
        }

        const { telefone, nome, tipo, idBanco, veiculo, placa } = job.data; 
        const primeiroNome = nome.split(\' \')[0];
        
        // Normaliza o JID antes de usar
        const jidNormalizado = normalizarJid(`${telefone.replace(/\\D/g, \'\')}@s.whatsapp.net`);

        const envLista = process.env.NUMEROS_PERMITIDOS || \"\";
        const numerosPermitidos = envLista.split(\'%2C\').map(n => n.trim().replace(/\\D/g, \'\')).filter(n => n.length > 0);

        if (numerosPermitidos.length > 0) {
            const numeroClienteLimpo = jidNormalizado.split(\'@\')[0].replace(/\\D/g, \'\');
            const numeroAutorizado = numerosPermitidos.some(numeroEnv => 
                numeroClienteLimpo.includes(numeroEnv) || numeroEnv.includes(numeroClienteLimpo)
            );
            if (!numeroAutorizado) {
                console.log(`[TESTE] Bloqueado: ${telefone} não bate com a lista do .env.`);
                return; 
            }
        }

        console.log(`[Worker] Processando disparo liberado para: ${nome} (${tipo}) JID: ${jidNormalizado}`);

        if (tipo === \'24h\' || tipo === \'pos_venda_24h\') {
            const arraySorteio = mensagens24h; 
            const textoSorteado = arraySorteio[Math.floor(Math.random() * arraySorteio.length)];
            const textoFinal = textoSorteado
                .replace(\'{nome}\' , primeiroNome)
                .replace(\'{model_car}\' , veiculo || \'seu veículo\') 
                .replace(\'{car_plate}\' , placa || \'não informada\');

            await enviarMensagemHumana(sock, jidNormalizado, textoFinal, job);

            const dadosParaPlanilha = [
                new Date().toLocaleString(\'pt-BR\'), nome, telefone, `Pós-Venda ${tipo}`, \'Aguardando Avaliação\'
            ];
            await salvarNoSheets(dadosParaPlanilha, 1);

            // Atualiza a tabela 'clientes' com o status 'pos_vendas_enviado'
            await query(
                "INSERT INTO clientes (whatsapp_id, status) VALUES ($1, \'pos_vendas_enviado\') ON CONFLICT (whatsapp_id) DO UPDATE SET status = \'pos_vendas_enviado\', atualizado_em = CURRENT_TIMESTAMP", 
                [jidNormalizado]
            );
            console.log(`[Worker] Cliente ${jidNormalizado} marcado como \'pos_vendas_enviado\'.`);

        } else {
            const arraySorteio = mensagens5meses; 
            const textoSorteado = arraySorteio[Math.floor(Math.random() * arraySorteio.length)];
            const textoFinal = textoSorteado
                .replace(\'{nome}\' , primeiroNome)
                .replace(\'{model_car}\' , veiculo || \'seu veículo\') 
                .replace(\'{car_plate}\' , placa || \'não informada\');

            await enviarMensagemHumana(sock, jidNormalizado, textoFinal, job);

            const dadosParaPlanilha = [
                new Date().toLocaleString(\'pt-BR\'), nome, telefone, `Pós-Venda ${tipo}`, \'Mensagem Enviada\'
            ];
            await salvarNoSheets(dadosParaPlanilha, 1);

            // Atualiza a tabela 'clientes' com o status 'enviado' (ou outro status apropriado para este tipo de disparo)
            await query(
                "INSERT INTO clientes (whatsapp_id, status) VALUES ($1, \'enviado\') ON CONFLICT (whatsapp_id) DO UPDATE SET status = \'enviado\', atualizado_em = CURRENT_TIMESTAMP", 
                [jidNormalizado]
            );
            console.log(`[Worker] Cliente ${jidNormalizado} marcado como \'enviado\'.`);
        }

    }, { 
        connection,
        concurrency: 1
    });

    worker.on(\'completed\', job => {
        console.log(`✅ [Worker] Job ${job.id} concluído com sucesso!`);
    });

    worker.on(\'failed\', (job, err) => {
        console.error(`❌ [Worker] Falha no job ${job.id} (tentativa ${job.attemptsMade}/${job.opts.attempts}):`, err.message);
    });

    console.log(`👷 Worker BullMQ da Rissato Motors pronto para processar jobs.`);
}

module.exports = { iniciarWorker };
