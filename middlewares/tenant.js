const { query } = require('../DataBase/conection');

const tenantMiddleware = async (req, res, next) => {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const partes = host.split('.');
    
    let subdominio = null;
    
    if (partes.length >= 3) {
        subdominio = partes[0];
    } 
    else if (host.includes('195.200.6.54')) {
        subdominio = '195.200.6.54';
    }

    if (subdominio && subdominio !== 'www') {
        try {
            const result = await query(
                'SELECT * FROM clientes_config WHERE subdominio = $1', 
                [subdominio]
            );

            if (result.rows.length > 0) {
                req.cliente = result.rows[0]; 
                res.locals.cliente = req.cliente; 
            }
        } catch (err) {
            console.error('❌ Erro ao buscar cliente no banco:', err);
        }
    }
    next();
};

module.exports = tenantMiddleware;
