# 🤖 LeadsFlow — WhatsApp Automation Engine

LeadsFlow é um sistema completo de **CRM e automação de pós-venda via WhatsApp**, construído em Node.js. Ele conecta um bot do WhatsApp a um banco de dados PostgreSQL, Google Sheets e um ERP de oficina mecânica, com um painel web em tempo real para gerenciamento.

O sistema foi desenvolvido com arquitetura **modular e multi-tenant**, permitindo que múltiplos clientes (oficinas) sejam servidos pela mesma instância, cada um com seu próprio subdomínio, planilha e configurações.

---

## 🎯 Objetivo

Automatizar o processo de pós-venda de oficinas mecânicas:

1. **Capturar** leads que entram em contato pelo WhatsApp
2. **Sincronizar** os dados dos clientes com o ERP da oficina via RPA
3. **Agendar** mensagens automáticas de acompanhamento (24h e 6 meses após o serviço)
4. **Enviar** as mensagens de forma humanizada para evitar banimento
5. **Registrar** tudo em Google Sheets e PostgreSQL
6. **Visualizar** tudo em um painel web em tempo real

---

## 🏗️ Arquitetura do Projeto

```
bot-wpp-balleys/
│
├── index.js                  → Servidor principal (Express + Socket.IO + Bot)
│
├── Engine/                   → Infraestrutura core
│   ├── whatsapp.js           → Conexão Baileys, QR Code, roteamento de mensagens
│   ├── report.js             → Gerador de relatórios PDF
│   └── sheets.js             → Integração básica com Google Sheets
│
├── Chat/                     → Lógica de negócio por cliente
│   └── RissatoMotors/
│       ├── api.js            → Webhook para receber dados do ERP
│       ├── erpSync.js        → RPA com Puppeteer para extrair clientes
│       ├── fluxo.js          → Respostas automáticas (feedback pós-venda)
│       ├── mensagens.js      → Templates de mensagens com variações aleatórias
│       ├── scheduler.js      → Agendamento de filas com BullMQ + Redis
│       └── worker.js         → Consumidor da fila, envio humanizado
│
├── DataBase/
│   ├── conection.js          → Pool de conexão com PostgreSQL
│   └── init.sql              → Script de criação das tabelas
│
├── Functions/
│   └── googleSheets.js       → Leitura, escrita e campanhas no Google Sheets
│
├── utils/
│   ├── formatador.js         → Formatação de números e dados de leads
│   └── templates.js          → Templates fixos de mensagens
│
├── views/
│   ├── index.ejs             → Dashboard principal (tempo real)
│   └── login.ejs             → Tela de autenticação
│
├── public/
│   └── style.css             → Estilos globais do painel web
│
├── testes/                   → Suíte de testes Jest
│   ├── formatador.test.js
│   ├── infra.test.js
│   ├── sheets.test.js
│   ├── templates.test.js
│   └── whatsapp.test.js
│
├── dockerfile                → Imagem Docker da aplicação
├── docker-compose.yml        → Orquestração (Bot + PostgreSQL + Redis + Watchtower)
├── start.sh                  → Script de inicialização para Linux
└── Ligar_Sistema.bat         → Script de inicialização para Windows
```

---

## 🔄 Fluxo de Funcionamento

```
[ERP da Oficina]
       │
       │ POST /api/webhook/rissatomotors (token Bearer)
       ▼
[api.js] → [scheduler.js] → [Fila Redis BullMQ]
                                      │
                          ┌───────────┴───────────┐
                     job 24h               job 6 meses
                          │                       │
                     [worker.js] ← sorteia mensagem aleatória
                          │
                [enviarMensagemHumana]
                 (simula digitação)
                          │
                   [WhatsApp do cliente]

[Cron Job 18:00] → [erpSync.js / Puppeteer]
                          │
                   Login no ERP web
                          │
                   Exporta CSV de clientes
                          │
            ┌─────────────┴──────────────┐
     [Dados_ERP (bruto)]       [Clientes (formatado)]
            └─────────────┬──────────────┘
                   [Google Sheets]

[WhatsApp entra em contato]
          │
    [whatsapp.js] → identifica se é admin ou lead
          │
    [index.js] → salva no PostgreSQL + Google Sheets
          │         + emite log na Dashboard
          ▼
    [views/index.ejs] (tempo real via Socket.IO)
```

---

## 🚀 Como Iniciar

### Pré-requisitos
- Docker Desktop instalado e rodando
- Arquivo `.env` configurado na raiz (ver seção abaixo)
- Arquivo `credentials.json` da Service Account Google na raiz

### Windows
```
Duplo clique em Ligar_Sistema.bat
```

### Linux / VPS
```bash
bash start.sh
```

### Manual
```bash
npm install
docker compose up -d   # Sobe PostgreSQL e Redis
npm start              # Inicia o bot + painel
```

Acesse o painel em: **http://localhost:3000**

---

## 🔐 Variáveis de Ambiente (`.env`)

```env
# Banco de dados
DB_USER=postgres
DB_HOST=localhost
DB_NAME=leadsflow
DB_PASS=suasenha
DB_PORT=5432

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Google Sheets
SHEET_ID=id_da_planilha_aqui

# WhatsApp / Admin
ADMIN_NUMBER=5511999998888

# Painel Web
PANEL_USER=admin
PANEL_PASS=suasenha
SESSION_SECRET=chave_secreta_aqui

# Integração ERP Rissato
RISSATO_API_TOKEN=token_secreto_aqui
ERP_CHAVE=chave_erp
ERP_USER=usuario_erp
ERP_PASS=senha_erp

# Configurações do bot
TIPO_SERVICO=oficina
MODO_SIMULACAO=true
NOME_EMPRESA=Rissato Motors
NUMEROS_PERMITIDOS=5511999998888,5511888887777

# (Opcional) Delays para testes locais
DELAY_24H=60000
DELAY_6MESES=120000
```

---

## 🧪 Testes

```bash
npm test             # Roda todos os testes
npm run test:watch   # Modo watch para desenvolvimento
```

A suíte cobre formatação de dados, conectividade com PostgreSQL e Redis, autenticação com Google Sheets e o motor de envio de mensagens.

---

## 📋 Comandos disponíveis via WhatsApp (admin)

| Comando | Ação |
|---|---|
| `!disparar` | Executa a campanha de pós-venda para todos os clientes elegíveis |
| `/relatorio` | Gera e envia o relatório PDF de leads diretamente no WhatsApp |

---

## 🛠️ Stack Tecnológica

| Categoria | Tecnologia |
|---|---|
| Runtime | Node.js 20 |
| WhatsApp | @whiskeysockets/baileys |
| Servidor Web | Express 5 |
| Tempo Real | Socket.IO |
| Banco de Dados | PostgreSQL 15 |
| Filas | BullMQ + Redis 7 |
| RPA | Puppeteer |
| Google Sheets | googleapis |
| PDF | PDFKit |
| Templates | EJS |
| Testes | Jest |
| Deploy | Docker + Docker Compose |
| Auto-update | Watchtower |

---

## 📁 READMEs por pasta

Cada pasta do projeto possui seu próprio README com documentação detalhada de todos os arquivos e funções:

- [⚙️ Engine](./Engine/README.md)
- [💬 Chat](./Chat/README.md)
- [🗄️ DataBase](./DataBase/README.md)
- [⚙️ Functions](./Functions/README.md)
- [🛠️ utils](./utils/README.md)
- [🖥️ views](./views/README.md)
- [🎨 public](./public/README.md)
- [🧪 testes](./testes/README.md)
- [📂 Arquivos da Raiz](./arquivos-raiz.md)
