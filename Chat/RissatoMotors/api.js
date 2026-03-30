// Arquivo: Chat/RissatoMotors/api.js
const { agendarMensagens } = require('./scheduler');

async function receberDadosERP(req, res) {
    try {
        // O ERP vai enviar os dados no "body" da requisição HTTP
        const { nome, telefone, veiculo, data_saida } = req.body;

        // Validação de segurança
        if (!nome || !telefone) {
            return res.status(400).json({ error: "Nome e telefone são obrigatórios." });
        }

        console.log(`📥 [API Rissato] Dados recebidos do ERP: ${nome} - ${telefone}`);

        // Envia para a fila do Redis (Pós-venda de 24h e 6 meses)
        await agendarMensagens({
            nome: nome,
            telefone: telefone,
            dataSaida: data_saida || new Date().toLocaleDateString('pt-BR')
        });

        // Responde ao ERP que deu tudo certo
        return res.status(200).json({ 
            success: true, 
            message: "Cliente inserido na fila de Pós-Venda automátio." 
        });

    } catch (error) {
        console.error("❌ [API Rissato] Erro ao processar webhook do ERP:", error);
        return res.status(500).json({ error: "Erro interno no servidor LeadsFlow." });
    }
}

module.exports = { receberDadosERP };