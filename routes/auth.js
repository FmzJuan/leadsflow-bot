// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');

router.get('/login', (req, res) => res.render('login'));

router.post('/login', async (req, res) => {
    console.log('NODE_ENV:', process.env.NODE_ENV);

    const username = (req.body?.username || req.body?.email || '').toLowerCase().trim();
    const password = (req.body?.password || req.body?.senha || '').trim();

    // ✅ MODO DESENVOLVIMENTO — bypass total de autenticação
    if (process.env.NODE_ENV === 'development') {
        console.log(`🛠️ [DEV] Login automático para: ${username || 'dev'}`);
        req.session.logged = true;
        req.session.clienteId = process.env.DEV_CLIENT_ID || null;
        return req.session.save((err) => {
            if (err) return res.status(500).send("Erro ao salvar sessão.");
            return res.redirect('/');
        });
    }

    try {
        let usuarioValido = false;

        if (req.cliente) {
            const emailBanco = (req.cliente.email_contato || '').toLowerCase().trim();
            console.log(`🔑 Tentativa de login para cliente: ${req.cliente.nome_oficina}`);
            
            if (username === emailBanco) {
                const match = await bcrypt.compare(password, req.cliente.senha_dashboard);
                if (match) {
                    req.session.logged = true;
                    req.session.clienteId = req.cliente.id;
                    usuarioValido = true;
                }
            }
        }

        if (!usuarioValido && username === process.env.PANEL_USER && password === process.env.PANEL_PASS) {
            req.session.logged = true;
            usuarioValido = true;
        }

        if (usuarioValido) {
            return req.session.save((err) => {
                if (err) {
                    console.error("❌ Erro ao salvar sessão no Redis:", err);
                    return res.status(500).send("Erro ao processar login.");
                }
                return res.redirect('/');
            });
        }

        res.send('<script>alert("Usuário ou senha inválidos!"); window.location="/login";</script>');

    } catch (error) {
        console.error("🚨 Erro na autenticação:", error);
        res.status(500).send("Erro interno no servidor.");
    }
});

module.exports = router;