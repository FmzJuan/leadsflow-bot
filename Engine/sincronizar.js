// engine/sincronizar.js
const { query } = require('../DataBase/conection');
const { resolverLID, reprocessarLidPendente } = require('./utils_lid');

async function rodarRotinaDeSincronizacao(sock, clienteId) {
    const pendentes = await query(`SELECT lid FROM lid_pendentes WHERE cliente_id = $1`, [clienteId]);

    for (const p of pendentes.rows) {
        // 1. Tenta resolver normal
        let jid = await resolverLID(p.lid, {}, sock);
        
        // 2. FORÇA BRUTA: Se não achou, pede para o WhatsApp traduzir o LID agora
        if (!jid) {
            try {
                // A magia acontece aqui: Essa função força o WhatsApp a procurar esse usuário na rede
                const resultado = await sock.onWhatsApp(p.lid.replace('@lid', '')); 
                if (resultado && resultado.length > 0) {
                    jid = resultado[0].jid;
                    console.log(`[Sincronizador] Força Bruta: ${p.lid} -> ${jid}`);
                }
            } catch (err) {
                console.log(`[Sincronizador] WhatsApp não liberou o JID para ${p.lid}`);
            }
        }

        if (jid) {
            await reprocessarLidPendente(p.lid, jid, sock, clienteId);
        }
    }
}
function iniciarSincronizador(sock, clienteId) {
    // Roda a cada 10 minutos (10 * 60 * 1000)
    setInterval(() => rodarRotinaDeSincronizacao(sock, clienteId), 600000);
    
    // Roda uma vez logo ao iniciar
    rodarRotinaDeSincronizacao(sock, clienteId);
}

module.exports = { iniciarSincronizador };