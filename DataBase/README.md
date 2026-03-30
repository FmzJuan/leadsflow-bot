# 🗄️ DataBase

A pasta `DataBase` centraliza tudo relacionado à persistência de dados do sistema: a conexão com o banco PostgreSQL e o script de inicialização das tabelas.

---

## 📁 Estrutura

```
DataBase/
├── conection.js  → Pool de conexão com o PostgreSQL
└── init.sql      → Script de criação das tabelas e dados iniciais
```

---

## 📄 `conection.js` — Conexão com o PostgreSQL

Cria e exporta um pool de conexões reutilizáveis com o banco de dados PostgreSQL usando a biblioteca `pg`.

### Como funciona

- Instancia um `Pool` com as configurações lidas das variáveis de ambiente (`.env`). Todos os campos têm fallbacks para desenvolvimento local:
  - `DB_USER` → `postgres`
  - `DB_HOST` → `localhost`
  - `DB_NAME` → `leadsflow`
  - `DB_PASS` → `suasenha`
  - `DB_PORT` → `5432`
- Ao iniciar, testa a conexão imediatamente: se falhar, loga o erro; se conectar, exibe confirmação no console e libera o cliente.

### `query(text, params)`
Função assíncrona que executa qualquer query SQL no pool.

- **`text`**: string SQL com placeholders `$1`, `$2`, etc.
- **`params`**: array com os valores para os placeholders (proteção contra SQL Injection).
- **Retorna**: o resultado da query do PostgreSQL (`rows`, `rowCount`, etc.).

É a única função usada em todo o projeto para interagir com o banco — centraliza e padroniza todo acesso ao PostgreSQL.

---

## 📄 `init.sql` — Script de Inicialização do Banco

Script SQL executado automaticamente pelo Docker na primeira vez que o container do PostgreSQL é criado (via `docker-entrypoint-initdb.d`).

### Tabelas criadas

#### `clientes_config`
Tabela principal do modelo SaaS — armazena os dados de cada oficina cadastrada no sistema.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | SERIAL PK | Identificador único |
| `nome_oficina` | VARCHAR(255) | Nome da empresa |
| `subdominio` | VARCHAR(50) UNIQUE | Subdomínio único (ex: `rissato`) |
| `google_sheets_id` | VARCHAR(255) | ID da planilha Google do cliente |
| `email_contato` | VARCHAR(255) | E-mail de login no painel |
| `senha_dashboard` | VARCHAR(255) | Senha de acesso ao painel |
| `status_assinatura` | VARCHAR(20) | `ativo` ou `inativo` |
| `criado_at` | TIMESTAMP | Data de criação |

#### `leads`
Tabela de leads/contatos, vinculada a um cliente da tabela acima.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | SERIAL PK | Identificador único |
| `cliente_id` | FK → clientes_config | Vincula o lead à oficina |
| `nome` | VARCHAR(255) | Nome do cliente |
| `celular` | VARCHAR(50) | Número de telefone |
| `veiculo` | VARCHAR(100) | Veículo do cliente |
| `data_cadastro` | DATE | Data de entrada |
| `status_envio` | VARCHAR(50) | `pendente`, `enviado` ou `erro` |
| `ultima_interacao` | TIMESTAMP | Última vez que o bot interagiu |

### Dados iniciais

Insere automaticamente o registro da **Rissato Motors** como cliente padrão para testes locais, usando `ON CONFLICT DO NOTHING` para não duplicar em re-execuções.

---

## 🔐 Variáveis de Ambiente necessárias

```env
DB_USER=      # Usuário do PostgreSQL
DB_HOST=      # Host do banco (ex: localhost ou db para Docker)
DB_NAME=      # Nome do banco (ex: leadsflow)
DB_PASS=      # Senha do banco
DB_PORT=      # Porta (padrão: 5432)
```
