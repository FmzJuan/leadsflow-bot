const { query } = require(\'../DataBase/conection\');
const { normalizarJid, normalizarNumero } = require(\'../utils/formatador\');
const { salvarNoSheets } = require('../Functions/googleSheets');

async function processarDadosERP(req, res) {
    const leadsDoRPA = req.body.leads;
    const clienteId = req.cliente.id; 

    try {
        for (const lead of leadsDoRPA) {
            const dataZero = new Date(lead.data_saida);
            
            const data24h = new Date(dataZero);
            data24h.setDate(data24h.getDate() + 1);

            const data6Meses = new Date(dataZero);
            data6Meses.setDate(data6Meses.getDate() + 180);

            // 1. Cancela retornos antigos no banco
            await query(`
                UPDATE leads SET status_envio = 'cancelado_retorno', atualizado_em = CURRENT_TIMESTAMP
                WHERE whatsapp_id = $1 AND cliente_id = $2 AND tipo_envio = \'retorno_6meses\' AND status_envio = \'pendente\'
            `, [normalizarJid(`${normalizarNumero(lead.celular)}@s.whatsapp.net`), clienteId]); // ✅ Parâmetros adicionados

            // 2. Insere 24h no banco
            await query(`
                INSERT INTO leads (cliente_id, nome, whatsapp_id, veiculo, data_saida, tipo_envio, data_agendada, status_envio)
                VALUES ($1, $2, $3, $4, $5, \'pos_venda_24h\', $6, \'pendente\')
                ON CONFLICT (cliente_id, whatsapp_id, tipo_envio, data_saida) DO NOTHING;
            `, [clienteId, lead.nome, normalizarJid(`${normalizarNumero(lead.celular)}@s.whatsapp.net`), lead.veiculo, lead.data_saida, data24h]); // ✅ Parâmetros adicionados

            // 3. Insere 6 Meses no banco
            await query(`
                INSERT INTO leads (cliente_id, nome, whatsapp_id, veiculo, data_saida, tipo_envio, data_agendada, status_envio)
                VALUES ($1, $2, $3, $4, $5, \'retorno_6meses\', $6, \'pendente\')
                ON CONFLICT (cliente_id, whatsapp_id, tipo_envio, data_saida) DO NOTHING;
            `, [clienteId, lead.nome, normalizarJid(`${normalizarNumero(lead.celular)}@s.whatsapp.net`), lead.veiculo, lead.data_saida, data6Meses]); // ✅ Parâmetros adicionados

            // 4. ESPELHO: ENVIANDO PARA O GOOGLE SHEETS
            
            // Monta a linha de 24h
            const linha24h = [
                data24h.toLocaleDateString('pt-BR'), // Coluna A: Data
                lead.nome,                           // Coluna B: Nome
                normalizarJid(`${normalizarNumero(lead.celular)}@s.whatsapp.net`),                        // Coluna C: WhatsApp
                'Pós-Venda 24h',                     // Coluna D: Serviço
                'Pendente'                           // Coluna E: Status
            ];

            // Monta a linha de 6 Meses ✅ Array estava vazio/faltando
            const linha6Meses = [
                data6Meses.toLocaleDateString('pt-BR'), // Coluna A: Data
                lead.nome,                              // Coluna B: Nome
                normalizarJid(`${normalizarNumero(lead.celular)}@s.whatsapp.net`),                           // Coluna C: WhatsApp
                'Retorno 6 Meses',                      // Coluna D: Serviço
                'Pendente'                              // Coluna E: Status
            ];

            // Chama a função passando os arrays
            await salvarNoSheets(linha24h, clienteId);
            await salvarNoSheets(linha6Meses, clienteId);
        }

        res.json({ success: true, message: "Fila criada no Banco e Espelhada na Planilha com sucesso!" });
    } catch (error) {
        console.error("Erro no processamento do ERP:", error);
        res.status(500).json({ error: "Erro interno no processamento de leads." });
    }
}

module.exports = { processarDadosERP };