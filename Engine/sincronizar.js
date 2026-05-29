// engine/sincronizar.js
const { query } = require('../DataBase/conection');
const { resolverLID, reprocessarLidPendente } = require('./utils_lid');

async function rodarRotinaDeSincronizacao(sock, clienteId) {
    console.log(`[Sincronizador] Verificando LIDs pendentes para cliente ${clienteId}...`);
    
    try {
        const res = await query(`
            SELECT lid, texto 
            FROM lid_pendentes 
            WHERE cliente_id = $1 
            AND criado_em < NOW() - INTERVAL '2 minutes'
        `, [clienteId]);

        for (const pendente of res.rows) {
            // O segredo aqui: o sock já contém a sessão carregada da auth_info_1
            // Se o Baileys souber quem é o LID, o resolverLID vai achar na memória (store)
            let jidResolvido = await resolverLID(pendente.lid, {}, sock);

            if (jidResolvido) {
                console.log(`[Sincronizador] Bingo! LID ${pendente.lid} resolvido para ${jidResolvido}`);
                await reprocessarLidPendente(pendente.lid, jidResolvido, sock, clienteId);
            }
        }
    } catch (error) {
        console.error(`[Sincronizador] Erro:`, error.message);
    }
}
function iniciarSincronizador(sock, clienteId) {
    // Roda a cada 10 minutos (10 * 60 * 1000)
    setInterval(() => rodarRotinaDeSincronizacao(sock, clienteId), 600000);
    
    // Roda uma vez logo ao iniciar
    rodarRotinaDeSincronizacao(sock, clienteId);
}

module.exports = { iniciarSincronizador };