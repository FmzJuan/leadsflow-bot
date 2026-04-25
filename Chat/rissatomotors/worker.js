// Chat/RissatoMotors/worker.js

const { Worker } = require('bullmq');
const connection = require('../../DataBase/redis'); 
const { mensagens24h, mensagens5meses } = require('./mensagens'); 
const { salvarNoSheets } = require('../../Functions/googleSheets');
const { query } = require('../../DataBase/conection'); 

async function enviarMensagemHumana(sock, jid, texto) {
    if (process.env.DRY_RUN === 'true') {
        console.log(`\x1b[33m[DRY-RUN] Simulação ativada. Mensagem que seria enviada para ${jid}: \x1b[0m\n"${texto}"\n`);
        return; 
    }

    try {
        await sock.sendPresenceUpdate('composing', jid);
        const tempoDigitando = Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000;
        console.log(`[Worker] Simulando digitação por ${tempoDigitando / 1000}s para ${jid}...`);
        await new Promise(resolve => setTimeout(resolve, tempoDigitando));
        
        await sock.sendMessage(jid, { text: texto });
        await sock.sendPresenceUpdate('paused', jid);
    } catch (error) {
        console.error(`[Worker] Erro ao enviar mensagem humana para ${jid}:`, error);
        throw error; 
    }
}

function iniciarWorker(sock) {
    const worker = new Worker('pos-venda-rissato', async job => {
        // ✅ Extrai veículo e placa do job.data
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
            
            // ✅ AQUI ESTÁ A CORREÇÃO: Substitui o carro e a placa
            const textoFinal = textoSorteado
                .replace('{nome}', primeiroNome)
                .replace('{model_car}', veiculo || 'seu veículo') 
                .replace('{car_plate}', placa || 'não informada');

            await enviarMensagemHumana(sock, jid, textoFinal);

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
                    console.log(`[Worker] Banco de dados: Lead ${idBanco} marcado como 'aguardando_nps'.`);
                } catch (dbErr) {
                    console.error(`[Worker] Erro ao atualizar NPS no banco para lead ${idBanco}:`, dbErr);
                }
            }

        } else {
            
            const arraySorteio = mensagens5meses; 
            const textoSorteado = arraySorteio[Math.floor(Math.random() * arraySorteio.length)];
            
            // ✅ AQUI TAMBÉM: Substitui o carro e a placa para o fluxo de 5 meses
            const textoFinal = textoSorteado
                .replace('{nome}', primeiroNome)
                .replace('{model_car}', veiculo || 'seu veículo') 
                .replace('{car_plate}', placa || 'não informada');

            await enviarMensagemHumana(sock, jid, textoFinal);

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
                    console.log(`[Worker] Banco de dados: Lead ${idBanco} de retorno marcado como enviado.`);
                } catch (dbErr) {
                    console.error(`[Worker] Erro ao atualizar Retorno no banco para lead ${idBanco}:`, dbErr);
                }
            }
        }

    }, { connection });

    worker.on('completed', job => {
        console.log(`✅ [Worker] Job ${job.id} concluído com sucesso!`);
    });

    worker.on('failed', (job, err) => {
        console.error(`❌ [Worker] Falha no job ${job.id}:`, err.message);
    });

    console.log(`👷 Worker BullMQ da Rissato Motors pronto para processar jobs.`);
}

module.exports = { iniciarWorker };