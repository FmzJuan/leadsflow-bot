// Chat/RissatoMotors/fluxo.js
const { salvarNoSheets } = require('../../Functions/googleSheets');
async function executar(sock, msg) {
    const textoMensagem = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
    const numeroCliente = msg.key.remoteJid;
    
    if (!textoMensagem) return;

    // Lógica simples de resposta aos agendamentos
    if (textoMensagem === '1') {
        await sock.sendMessage(numeroCliente, { text: "Ficamos muito felizes que está tudo certo! Qualquer coisa, conte com a Rissato Motors. 🚗💨" });
        await salvarNoSheets([numeroCliente, "Feedback Positivo", new Date().toLocaleString()]);
    } else if (textoMensagem === '2') {
        await sock.sendMessage(numeroCliente, { text: "Poxa, sentimos muito por isso. Já avisei nossa equipe técnica e um consultor entrará em contato com você em breve para resolvermos!" });
        await salvarNoSheets([numeroCliente, "ALERTA: Problema relatado", new Date().toLocaleString()]);
    }
}

module.exports = { executar };