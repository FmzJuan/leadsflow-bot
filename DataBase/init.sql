-- 1. Tabela de Configuração dos Clientes (Onde o SaaS vive)
CREATE TABLE IF NOT EXISTS clientes_config (
    id SERIAL PRIMARY KEY,
    nome_oficina VARCHAR(255) NOT NULL,
    subdominio VARCHAR(50) UNIQUE NOT NULL, -- Ex: 'rissato'
    google_sheets_id VARCHAR(255) NOT NULL, -- O ID da planilha da Julia
    email_contato VARCHAR(255),
    senha_dashboard VARCHAR(255) NOT NULL, 
    status_assinatura VARCHAR(20) DEFAULT 'ativo',
    criado_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabela de Leads (Vinculada ao cliente)
CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER REFERENCES clientes_config(id), -- Liga o lead à Rissato
    nome VARCHAR(255),
    celular VARCHAR(50),
    veiculo VARCHAR(100),
    data_cadastro DATE,
    status_envio VARCHAR(50) DEFAULT 'pendente', -- pendente, enviado, erro
    ultima_interacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Inserindo a Rissato Motors para o seu teste local
INSERT INTO clientes_config (nome_oficina, subdominio, google_sheets_id, email_contato, senha_dashboard)
VALUES (
    'Rissato Motors', 
    'rissato', 
    'COLOQUE_AQUI_O_ID_DA_PLANILHA_DELA', 
    'contato@rissatomotors.com.br', 
    'mudar123'
) ON CONFLICT (subdominio) DO NOTHING;