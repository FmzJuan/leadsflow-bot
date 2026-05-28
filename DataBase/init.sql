-- 1. Tabela de Configuração das Oficinas (Onde o SaaS vive)
CREATE TABLE IF NOT EXISTS clientes_config (
    id SERIAL PRIMARY KEY,
    nome_oficina VARCHAR(255) NOT NULL,
    subdominio VARCHAR(50) UNIQUE NOT NULL, -- Ex: 'rissatomotors'
    google_sheets_id VARCHAR(255) NOT NULL,
    email_contato VARCHAR(255),
    senha_dashboard VARCHAR(255) NOT NULL, 
    status_assinatura VARCHAR(20) DEFAULT 'ativo',
    criado_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabela de Controle de Estados do Fluxo (Isolada por Oficina)
CREATE TABLE IF NOT EXISTS clientes (
    cliente_id INTEGER REFERENCES clientes_config(id) ON DELETE CASCADE,
    whatsapp_id VARCHAR(100) NOT NULL, -- JID do cliente do WhatsApp
    status VARCHAR(50) NOT NULL DEFAULT 'inicio', -- estados do bot
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cliente_id, whatsapp_id) -- Impede que oficinas diferentes colidam dados do mesmo número
);

-- 3. Tabela de Leads (Vinculada à oficina)
CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER REFERENCES clientes_config(id) ON DELETE CASCADE,
    nome VARCHAR(255),
    celular VARCHAR(50),
    veiculo VARCHAR(100),
    data_cadastro DATE,
    status_envio VARCHAR(50) DEFAULT 'pendente',
    ultima_interacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Inserindo a Rissato Motors para teste local
INSERT INTO clientes_config (nome_oficina, subdominio, google_sheets_id, email_contato, senha_dashboard)
VALUES (
    'Rissato Motors', 
    'rissatomotors', 
    '12tKq9rxFSe-7i4vnLxGIF694ytdhRd_Is5P50CXi9G0', 
    'contato@rissatomotors.com.br', 
    'RM#120690'
) ON CONFLICT (subdominio) DO NOTHING;