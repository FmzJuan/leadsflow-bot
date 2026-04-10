const { query } = require('../DataBase/conection');

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

            // 1. Cancela retornos antigos
            await query(`
                UPDATE leads SET status_envio = 'cancelado_retorno', atualizado_em = CURRENT_TIMESTAMP
                WHERE celular = $1 AND cliente_id = $2 AND tipo_envio = 'retorno_6meses' AND status_envio = 'pendente'
            `, [lead.celular, clienteId]);

            // 2. Insere 24h
            await query(`
                INSERT INTO leads (cliente_id, nome, celular, veiculo, data_saida, tipo_envio, data_agendada, status_envio)
                VALUES ($1, $2, $3, $4, $5, 'pos_venda_24h', $6, 'pendente')
                ON CONFLICT (cliente_id, celular, tipo_envio, data_saida) DO NOTHING;
            `, [clienteId, lead.nome, lead.celular, lead.veiculo, lead.data_saida, data24h]);

            // 3. Insere 6 Meses
            await query(`
                INSERT INTO leads (cliente_id, nome, celular, veiculo, data_saida, tipo_envio, data_agendada, status_envio)
                VALUES ($1, $2, $3, $4, $5, 'retorno_6meses', $6, 'pendente')
                ON CONFLICT (cliente_id, celular, tipo_envio, data_saida) DO NOTHING;
            `, [clienteId, lead.nome, lead.celular, lead.veiculo, lead.data_saida, data6Meses]);
        }

        res.json({ success: true, message: "Fila de agendamentos criada e atualizada com sucesso!" });
    } catch (error) {
        console.error("Erro no processamento do ERP:", error);
        res.status(500).json({ error: "Erro interno no processamento de leads." });
    }
}

module.exports = { processarDadosERP };