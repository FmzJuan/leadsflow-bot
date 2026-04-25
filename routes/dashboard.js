const express = require('express');
const router = express.Router();
const { getClientSocket } = require('../Engine/whatsapp');
const { query } = require('../DataBase/conection');

router.get('/', async (req, res) => {
    if (!req.session.logged) return res.redirect('/login');

    let cliente = req.cliente;

    // ✅ FALLBACK DEV: busca o cliente pelo DEV_CLIENT_ID se não veio pelo subdomínio
    if (!cliente && process.env.NODE_ENV === 'development' && req.session.clienteId) {
        const result = await query('SELECT * FROM clientes_config WHERE id = $1', [req.session.clienteId]);
        cliente = result.rows[0] || null;
    }

    if (!cliente) {
        return res.send('<h2>Painel Admin Global</h2><p>Identifique-se via subdomínio de cliente para acessar a dashboard.</p>');
    }

    const statusBot = getClientSocket(cliente.id) ? 'conectado' : 'desconectado';

    res.render('index', {
        sheetLink: `https://docs.google.com/spreadsheets/d/${cliente.google_sheets_id || process.env.SHEET_ID}`,
        nomeCliente: cliente.nome_oficina,
        nomeEmpresa: cliente.nome_oficina,
        clienteId: cliente.id,
        statusAtual: statusBot
    });
});

module.exports = router;