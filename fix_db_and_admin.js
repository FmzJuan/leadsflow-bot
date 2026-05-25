const { query, pool } = require('./DataBase/conection');
const bcrypt = require('bcrypt');

async function fix() {
    try {
        console.log("🚀 Iniciando correções no banco de dados...");

        // 1. Adicionar coluna 'placa' se não existir
        console.log("Checking for 'placa' column in 'leads' table...");
        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='placa') THEN
                    ALTER TABLE leads ADD COLUMN placa VARCHAR(20);
                    RAISE NOTICE 'Coluna placa adicionada com sucesso.';
                ELSE
                    RAISE NOTICE 'Coluna placa já existe.';
                END IF;
            END $$;
        `);

        // 2. Adicionar colunas extras que parecem faltar baseando-se no importar_legado.js
        console.log("Checking for other missing columns...");
        await query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='data_saida') THEN
                    ALTER TABLE leads ADD COLUMN data_saida DATE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='tipo_envio') THEN
                    ALTER TABLE leads ADD COLUMN tipo_envio VARCHAR(50);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='data_agendada') THEN
                    ALTER TABLE leads ADD COLUMN data_agendada DATE;
                END IF;
            END $$;
        `);

        // 3. Criar usuário admin para testes
        console.log("Configurando usuário admin para testes...");
        const adminEmail = 'admin@teste.com';
        const adminPass = 'admin123';
        const hashedPass = await bcrypt.hash(adminPass, 10);

        // Verifica se a Rissato Motors existe, se não, cria uma para o admin
        const clienteResult = await query("SELECT id FROM clientes_config WHERE subdominio = 'rissatomotors' LIMIT 1");
        
        if (clienteResult.rows.length > 0) {
            const clienteId = clienteResult.rows[0].id;
            await query(`
                UPDATE clientes_config 
                SET email_contato = $1, senha_dashboard = $2 
                WHERE id = $3
            `, [adminEmail, hashedPass, clienteId]);
            console.log(`✅ Usuário admin atualizado para o cliente Rissato Motors (ID: ${clienteId})`);
        } else {
            await query(`
                INSERT INTO clientes_config (nome_oficina, subdominio, google_sheets_id, email_contato, senha_dashboard)
                VALUES ('Oficina de Teste', 'teste', 'planilha_id', $1, $2)
            `, [adminEmail, hashedPass]);
            console.log("✅ Novo cliente de teste criado com usuário admin.");
        }

        console.log("\n--- CREDENCIAIS DE TESTE ---");
        console.log(`Email: ${adminEmail}`);
        console.log(`Senha: ${adminPass}`);
        console.log("---------------------------\n");

        console.log("🎉 Todas as correções foram aplicadas!");
    } catch (err) {
        console.error("❌ Erro ao aplicar correções:", err);
    } finally {
        await pool.end();
    }
}

fix();
