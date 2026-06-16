const { query } = require('../DataBase/conection');
const { normalizarJid, normalizarNumero } = require('../utils/formatador');
const { salvarNoSheets } = require('../Functions/googleSheets');

async function processarDadosERP(req, res) {
    const leadsDoRPA = req.body.leads;
    const clienteId = req.cliente.id; 

    try {
        for (const lead of leadsDoRPA) {
            const dataZero = new Date(lead.data_saida);
            
            const data24h = new Date(dataZero);
            data24h.setDate(data24h.getDate() + 1);

            // 🛠️ MUDANÇA 1: Altera de 180 para 150 dias (5 meses)
            const data5Meses = new Date(dataZero);
            data5Meses.setDate(data5Meses.getDate() + 150);

            // 1. Cancela retornos antigos no banco
            await query(`
                UPDATE leads SET status_envio = 'cancelado_retorno', atualizado_em = CURRENT_TIMESTAMP
                WHERE whatsapp_id = $1 AND cliente_id = $2 AND tipo_envio = 'retorno_6meses' AND status_envio = 'pendente'
            `, [normalizarJid(`${normalizarNumero(lead.celular)}@s.whatsapp.net`), clienteId]);

            // 2. Insere 24h no banco (mantido igual)
            await query(`
                INSERT INTO leads (cliente_id, nome, whatsapp_id, veiculo, data_saida, tipo_envio, data_agendada, status_envio)
                VALUES ($1, $2, $3, $4, $5, 'pos_venda_24h', $6, 'pendente')
                ON CONFLICT (cliente_id, whatsapp_id, tipo_envio, data_saida) DO NOTHING;
            `, [clienteId, lead.nome, normalizarJid(`${normalizarNumero(lead.celular)}@s.whatsapp.net`), lead.veiculo, lead.data_saida, data24h]);

            // 🛠️ MUDANÇA 2: Insere 5 Meses no banco usando a variável de data corrigida (Mantém tipo_envio 'retorno_6meses' por enquanto para compatibilidade)
            await query(`
                INSERT INTO leads (cliente_id, nome, whatsapp_id, veiculo, data_saida, tipo_envio, data_agendada, status_envio)
                VALUES ($1, $2, $3, $4, $5, 'retorno_6meses', $6, 'pendente')
                ON CONFLICT (cliente_id, whatsapp_id, tipo_envio, data_saida) DO NOTHING;
            `, [clienteId, lead.nome, normalizarJid(`${normalizarNumero(lead.celular)}@s.whatsapp.net`), lead.veiculo, lead.data_saida, data5Meses]); // <--- Aqui passamos data5Meses

            // 4. ESPELHO: ENVIANDO PARA O GOOGLE SHEETS
            
            const linha24h = [
                data24h.toLocaleDateString('pt-BR'),
                lead.nome,
                normalizarJid(`${normalizarNumero(lead.celular)}@s.whatsapp.net`),
                'Pós-Venda 24h',
                'Pendente'
            ];

            // 🛠️ MUDANÇA 3: Atualiza o espelho para a nova data e o texto visual da planilha
            const linha5Meses = [
                data5Meses.toLocaleDateString('pt-BR'), // Coluna A: Data (agora com 150 dias)
                lead.nome,                              // Coluna B: Nome
                normalizarJid(`${normalizarNumero(lead.celular)}@s.whatsapp.net`),           // Coluna C: WhatsApp
                'Retorno 5 Meses',                      // Coluna D: Serviço (Texto atualizado para a planilha)
                'Pendente'                              // Coluna E: Status
            ];

            await salvarNoSheets(linha24h, clienteId);
            await salvarNoSheets(linha5Meses, clienteId);
        }

        res.json({ success: true, message: "Fila criada no Banco e Espelhada na Planilha com sucesso!" });
    } catch (error) {
        console.error("Erro no processamento do ERP:", error);
        res.status(500).json({ error: "Erro interno no processamento de leads." });
    }
}

module.exports = { processarDadosERP };