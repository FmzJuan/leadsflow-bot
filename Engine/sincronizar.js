// engine/sincronizar.js
const { query } = require('../DataBase/conection');
const { resolverLID, reprocessarLidPendente } = require('./utils_lid');

// Função utilitária para pausar a execução
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function rodarRotinaDeSincronizacao(sock, clienteId) {
    const pendentes = await query(`SELECT lid FROM lid_pendentes WHERE cliente_id = $1`, [clienteId]);

    for (const p of pendentes.rows) {
        // 1. Tenta resolver normal
        let jid = await resolverLID(p.lid, {}, sock);
        
        // 2. FORÇA BRUTA (Atenção: onWhatsApp não costuma funcionar com IDs de LID)
        if (!jid) {
            try {
                const numeroTratado = p.lid.replace('@lid', '');
                const resultado = await sock.onWhatsApp(numeroTratado); 
                
                if (resultado && resultado.length > 0) {
                    jid = resultado[0].jid;
                    console.log(`[Sincronizador] Força Bruta: ${p.lid} -> ${jid}`);
                } else {
                    console.log(`[Sincronizador] WhatsApp não retornou dados para o LID ${p.lid}`);
                    
                    // RECOMENDADO: Atualizar o banco marcando que este LID falhou
                    // ex: await query(`UPDATE lid_pendentes SET tentativas = tentativas + 1 WHERE lid = $1`, [p.lid]);
                }
            } catch (err) {
                console.log(`[Sincronizador] WhatsApp não liberou o JID para ${p.lid}`);
                
                // RECOMENDADO: Se o LID for permanentemente inválido, remova-o ou marque como erro
                // ex: await query(`UPDATE lid_pendentes SET status = 'erro' WHERE lid = $1`, [p.lid]);
            }
        }

        if (jid) {
            await reprocessarLidPendente(p.lid, jid, sock, clienteId);
            // IMPORTANTE: Garanta que dentro de 'reprocessarLidPendente' o registro
            // seja efetivamente DELETADO da tabela lid_pendentes para não ser lido novamente.
        }

        // 3. Pausa de 1,5 segundos entre as checagens para evitar bloqueios do WhatsApp
        await sleep(1500);
    }
}

function iniciarSincronizador(sock, clienteId) {
    // Roda a cada 10 minutos (10 * 60 * 1000)
    setInterval(() => rodarRotinaDeSincronizacao(sock, clienteId), 600000);
    
    // Roda uma vez logo ao iniciar
    rodarRotinaDeSincronizacao(sock, clienteId);
}

module.exports = { iniciarSincronizador };