const { Pool } = require('pg');

// Puxa as variáveis do .env (Padronizado)
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'leadsflow',
    password: process.env.DB_PASS || 'suasenha', // <-- Aqui estava o erro apontado pelo Manus
    port: process.env.DB_PORT || 5432,
});

// Testa a conexão ao iniciar
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Erro ao conectar no PostgreSQL:', err.stack);
    } else {
        console.log('✅ Conectado ao PostgreSQL com sucesso!');
        release();
    }
});

async function query(text, params) {
    return pool.query(text, params);
}

module.exports = { query, pool };