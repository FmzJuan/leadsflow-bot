// Arquivo: Chat/RissatoMotors/testeRPA.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') }); // Carrega o .env para o teste

const { extrairDadosDoERP } = require('./erpSync');

// 1. Simulamos os dados que o index.js buscaria no PostgreSQL
const mockClienteId = 1; 
const mockCredenciais = {
    chave: process.env.ERP_CHAVE, // Como já carregamos o .env, podemos usar aqui para o teste!
    usuario: process.env.ERP_USER,
    senha: process.env.ERP_PASS
};

console.log(`🧪 Iniciando ambiente de teste isolado para o Tenant ID: ${mockClienteId}...`);

// 2. Injetamos as dependências na nossa função blindada
extrairDadosDoERP(mockClienteId, mockCredenciais)
    .then(() => {
        console.log('✅ Teste do RPA concluído com sucesso! Os dados foram processados e o Banco conectou.');
    })
    .catch((erro) => {
        console.error('❌ Falha durante o teste:', erro);
    });