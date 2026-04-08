const express = require('express');
const router = express.Router();
const { getClientSocket } = require('../Engine/whatsapp');

router.get('/', (req, res) => {
    if (!req.session.logged) return res.redirect('/login');
    
    if (!req.cliente) {
        return res.send('<h2>Painel Admin Global</h2><p>Identifique-se via subdomínio de cliente para acessar a dashboard.</p>');
    }

    const statusBot = getClientSocket(req.cliente.id) ? 'conectado' : 'desconectado';

    res.render('index', { 
        sheetLink: `https://docs.google.com/spreadsheets/d/${req.cliente.google_sheets_id || process.env.SHEET_ID}`,
        nomeCliente: req.cliente.nome_oficina,
        nomeEmpresa: req.cliente.nome_oficina,
        clienteId: req.cliente.id,       
        statusAtual: statusBot           
    });
});

module.exports = router;
