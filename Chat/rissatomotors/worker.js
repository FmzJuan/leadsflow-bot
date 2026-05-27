// Chat/RissatoMotors/worker.js

const { Worker } = require('bullmq');
const connection = require('../../DataBase/redis'); 
const { mensagens24h, mensagens5meses } = require('./mensagens'); 
const { salvarNoSheets } = require('../../Functions/googleSheets');
const { query } = require('../../DataBase/conection');
const { getClientSocket } = require('../../Engine/whatsapp');

async function enviarMensagemHumana(sock, jid, texto, job) {
    if (process.env.DRY_RUN === 'true') {
        console.log(`\x1b[33m[DRY-RUN] Simulação ativada. Mensagem que seria enviada para ${jid}: \x1b[0m\n"${texto}"\n`);
        return; 
    }

    // ✅ Verifica só se o sock existe — não checa readyState (instável no Baileys)
    if (!sock) {
        throw new Error(`Socket inexistente para ${jid}. WhatsApp não conectado.`);
    }

    try {
        await sock.sendPresenceUpdate('composing', jid);
        const tempoDigitando = Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000;
        console.log(`[Worker] Simulando digitação por ${tempoDigitando / 1000}s para ${jid}...`);
        await new Promise(resolve => setTimeout(resolve, tempoDigitando));
        
        await sock.sendMessage(jid, { text: texto });

        const contato = sock.store?.contacts?.[jid];
        if (contato?.lid) {
            await connection.set(`lid:${contato.lid}`, jid);
            if (job?.data?.idBanco) {
                await query('UPDATE leads SET lid = $1 WHERE id = $2', [contato.lid, job.data.idBanco]);
            }
        }

        await sock.sendPresenceUpdate('paused', jid);
    } catch (error) {
        console.error(`[Worker] Erro ao enviar mensagem humana para ${jid}:`, error);
        throw error; 
    }
}

function iniciarWorker(clienteId) {
    const worker = new Worker('pos-venda-rissato', async job => {
        
        // ✅ Busca o sock ATUALIZADO a cada job
        const sock = getClientSocket(clienteId);

        // ✅ Sem checagem de readyState — o Baileys gerencia internamente
        if (!sock) {
            throw new Error(`WhatsApp desconectado. Job será retentado automaticamente.`);
        }

        const { telefone, nome, tipo, idBanco, veiculo, placa } = job.data; 
        const primeiroNome = nome.split(' ')[0];
        const numeroClienteLimpo = telefone.replace(/\D/g, ''); 

        let jid = telefone;
        if (!jid.includes('@')) {
            jid = `${numeroClienteLimpo}@s.whatsapp.net`;
        }

        const envLista = process.env.NUMEROS_PERMITIDOS || "";
        const numerosPermitidos = envLista.split(',').map(n => n.trim().replace(/\D/g, '')).filter(n => n.length > 0);

        if (numerosPermitidos.length > 0) {
            const numeroAutorizado = numerosPermitidos.some(numeroEnv => 
                numeroClienteLimpo.includes(numeroEnv) || numeroEnv.includes(numeroClienteLimpo)
            );
            if (!numeroAutorizado) {
                console.log(`[TESTE] Bloqueado: ${telefone} não bate com a lista do .env.`);
                return; 
            }
        }

        console.log(`[Worker] Processando disparo liberado para: ${nome} (${tipo}) JID: ${jid}`);

        if (tipo === '24h' || tipo === 'pos_venda_24h') {
            const arraySorteio = mensagens24h; 
            const textoSorteado = arraySorteio[Math.floor(Math.random() * arraySorteio.length)];
            const textoFinal = textoSorteado
                .replace('{nome}', primeiroNome)
                .replace('{model_car}', veiculo || 'seu veículo') 
                .replace('{car_plate}', placa || 'não informada');

            await enviarMensagemHumana(sock, jid, textoFinal, job);

            const dadosParaPlanilha = [
                new Date().toLocaleString('pt-BR'), nome, telefone, `Pós-Venda ${tipo}`, 'Aguardando Avaliação'
            ];
            await salvarNoSheets(dadosParaPlanilha, 1);

            if (idBanco) {
                try {
                    await query(
                        "UPDATE leads SET status_envio = 'enviado', fase_bot = 'aguardando_nps', atualizado_em = CURRENT_TIMESTAMP WHERE id = $1",
                        [idBanco]
                    );
                    console.log(`[Worker] Lead ${idBanco} marcado como 'aguardando_nps'.`);
                } catch (dbErr) {
                    console.error(`[Worker] Erro ao atualizar NPS no banco para lead ${idBanco}:`, dbErr);
                }
            }

        } else {
            const arraySorteio = mensagens5meses; 
            const textoSorteado = arraySorteio[Math.floor(Math.random() * arraySorteio.length)];
            const textoFinal = textoSorteado
                .replace('{nome}', primeiroNome)
                .replace('{model_car}', veiculo || 'seu veículo') 
                .replace('{car_plate}', placa || 'não informada');

            await enviarMensagemHumana(sock, jid, textoFinal, job);

            const dadosParaPlanilha = [
                new Date().toLocaleString('pt-BR'), nome, telefone, `Pós-Venda ${tipo}`, 'Mensagem Enviada'
            ];
            await salvarNoSheets(dadosParaPlanilha, 1);

            if (idBanco) {
                try {
                    await query(
                        "UPDATE leads SET status_envio = 'enviado', atualizado_em = CURRENT_TIMESTAMP WHERE id = $1",
                        [idBanco]
                    );
                } catch (dbErr) {
                    console.error(`[Worker] Erro ao atualizar Retorno no banco para lead ${idBanco}:`, dbErr);
                }
            }
        }

    }, { 
        connection,
        concurrency: 1
        // ✅ REMOVIDO: settings.backoffStrategy não funciona no BullMQ v4+
        // O backoff é configurado por job no scheduler.js (attempts + backoff.fixed)
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