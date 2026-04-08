const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { query } = require('../DataBase/conection');
const { adicionarAoFluxoRPA } = require('../queues/rpaqueue');
const { gerarRelatorioPDF } = require('../Functions/report.js');
const { getClientSocket } = require('../Engine/whatsapp');

// Teste para envio de mensagens
router.get('/teste-post-venda', async (req, res) => {
    try {
        const { agendarMensagens } = require('../Chat/RissatoMotors/scheduler');
        
        const clienteTeste = {
            nome: "amanda teste",
            telefone: "5511976378041",
            dataSaida: new Date().getTime().toString()
        };

        await agendarMensagens(clienteTeste);
        res.send("✅ Agendamento de teste enviado para a fila! Em 10 segundos o bot vai começar a 'digitar' para você.");
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// Webhook Genérico
router.post('/webhook/:subdominio', async (req, res) => {
    const subdominio = req.params.subdominio;
    const token = req.headers['authorization'];

    try {
        const result = await query('SELECT api_token FROM clientes_config WHERE subdominio = $1', [subdominio]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Cliente não encontrado." });
        
        const tokenCliente = result.rows[0].api_token;
        
        if (token !== `Bearer ${tokenCliente}`) {
            console.log(`⚠️ [Segurança] Tentativa de acesso bloqueada no webhook do cliente ${subdominio}.`);
            return res.status(403).json({ error: "Acesso Negado. Token inválido." });
        }

        const apiPath = path.join(__dirname, '..', 'Chat', subdominio, 'api.js');
        if (fs.existsSync(apiPath)) {
            const clienteApi = require(apiPath);
            clienteApi.receberDadosERP(req, res);
        } else {
            res.status(501).json({ error: "API não configurada para este cliente." });
        }
    } catch (err) {
        console.error(`Erro no webhook do cliente ${subdominio}:`, err);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// Sincronização ERP
router.post('/sync-erp', async (req, res) => {
    try {
        if (!req.cliente) return res.status(400).json({ error: "Cliente não identificado." });
        const clienteId = req.cliente.id; 
        const credenciais = {
            chave: process.env.ERP_CHAVE,
            usuario: process.env.ERP_USER,
            senha: process.env.ERP_PASS
        };
        await adicionarAoFluxoRPA(clienteId, credenciais);
        res.json({ success: true, message: "Sincronização iniciada em segundo plano!" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Relatório PDF
router.get('/relatorio/pdf', async (req, res) => {
    if (!req.session.logged) return res.status(401).send("Não autorizado");
    try {
        const { filePath } = await gerarRelatorioPDF(req.cliente.id);
        res.download(filePath, 'Relatorio_LeadsFlow.pdf', (err) => {
            if (!err) {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath); 
            }
        });
    } catch (error) {
        console.error("Erro ao gerar PDF via Web:", error);
        res.status(500).send("Erro ao gerar relatório.");
    }
});

// Resetar Sessão
router.post('/resetar-sessao', async (req, res) => {
    if (!req.session.logged) return res.status(401).json({ error: "Não autorizado" });
    const clienteId = req.cliente.id;
    try {
        const sock = getClientSocket(clienteId);
        if (sock) {
            sock.logout();
        } else {
            const authPath = path.resolve(__dirname, '..', 'sessions', `auth_info_${clienteId}`);
            if (fs.existsSync(authPath)) {
                fs.rmSync(authPath, { recursive: true, force: true });
            }
        }
        res.json({ success: true, message: "Sessão limpa. Escaneie o QR Code novamente." });
    } catch (error) {
        console.error("❌ Erro ao resetar sessão:", error);
        res.status(500).json({ success: false, error: "Erro interno ao resetar." });
    }
});

module.exports = router;
