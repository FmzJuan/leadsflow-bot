// engine/utils_lid.js
const { query } = require('../DataBase/conection');
const redis = require('../DataBase/redis');

// Exporte as funções que você já tem no whatsapp.js
async function resolverLID(lid, msg, sock, sessionStores) {
    // [COLE AQUI A LÓGICA DO SEU resolverLID ATUAL]
    // OBS: Você precisará passar o sessionStores como parâmetro ou importá-lo aqui
}

async function reprocessarLidPendente(lid, jidResolvido, sock, clienteId, onMessageHandlers) {
    // [COLE AQUI A LÓGICA DO SEU reprocessarLidPendente ATUAL]
}

module.exports = { resolverLID, reprocessarLidPendente };