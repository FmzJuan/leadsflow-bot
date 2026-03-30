# 📂 Arquivos da Raiz do Projeto

Este documento descreve os arquivos que ficam diretamente na raiz de `bot-wpp-balleys/`, fora de qualquer subpasta. São os arquivos de configuração, entrada e infraestrutura do sistema.

---

## 📄 `index.js` — Ponto de Entrada da Aplicação

Arquivo principal do sistema. Inicializa o servidor Express, o Socket.IO, a conexão com o WhatsApp e orquestra toda a comunicação entre os módulos.

### Responsabilidades

**Configuração do servidor:**
- Cria o servidor HTTP com Express + Socket.IO na porta `3000`.
- Configura a engine de views EJS, arquivos estáticos da pasta `public/`, parser de JSON/Form, e sessões com `express-session`.
- Exporta o objeto `io` globalmente para que o `Engine/whatsapp.js` possa emitir eventos em tempo real para o painel.

**Middleware de multi-tenancy:**
- Em cada requisição, extrai o subdomínio do host (ex: `rissato.seudominio.com` → `rissato`).
- Busca o cliente correspondente na tabela `clientes_config` do banco e anexa ao `req.cliente`.
- Se o subdomínio não for encontrado, retorna `404`.

**Cron Job (sincronização diária):**
- Agenda `extrairDadosDoERP()` para rodar todo dia às **18:00** no fuso `America/Sao_Paulo`.
- Mantém a planilha do cliente sempre atualizada com os dados mais recentes do ERP.

**Socket.IO:**
- Ao conectar um novo cliente no painel, consulta `getBotStatus()` e emite o status atual imediatamente, garantindo que a dashboard sempre mostre o estado real.

**Rotas de autenticação:**
- `GET /login` → Renderiza a tela de login.
- `POST /login` → Verifica credenciais contra o banco (cliente do subdomínio) ou contra as variáveis `PANEL_USER`/`PANEL_PASS` do `.env` (usuário mestre). Cria sessão e redireciona ao painel.

**Rotas do painel:**
- `GET /` → Renderiza o dashboard (`views/index.ejs`) com o link da planilha e nome da empresa. Protegido por sessão.
- `GET /api/relatorio/pdf` → Gera o PDF via `gerarRelatorioPDF()`, faz o download para o navegador e deleta o arquivo temporário. Protegido por sessão.

**Webhooks e APIs de integração:**
- `POST /api/webhook/rissatomotors` → Recebe dados do ERP da Rissato. Valida o token Bearer (`RISSATO_API_TOKEN`) e repassa para `receberDadosERP()`.
- `POST /api/finalizar-servico` → Permite agendar manualmente um pós-venda pelo painel, chamando `agendarMensagens()` do scheduler.

**Função `start()`:**
Chama `connectToWhatsApp()` passando um callback com toda a lógica de negócio:
1. Ativa o fluxo da oficina (`fluxoOficina.executar()`) se `TIPO_SERVICO === 'oficina'`.
2. Processa o comando `!disparar` → executa a campanha de pós-venda.
3. Processa o comando `/relatorio` → gera e envia o PDF via WhatsApp.
4. Para qualquer outro contato: salva no banco, sincroniza com o Google Sheets e emite logs na dashboard.

---

## 📄 `package.json` — Configuração do Projeto Node.js

Descreve as dependências, scripts e metadados do projeto.

### Scripts

| Script | Comando | Descrição |
|---|---|---|
| `start` | `node index.js` | Inicia o sistema em produção |
| `test` | `jest --detectOpenHandles --forceExit` | Roda todos os testes |
| `test:watch` | `jest --watchAll` | Roda os testes em modo watch |

### Principais dependências

| Pacote | Finalidade |
|---|---|
| `@whiskeysockets/baileys` | Conexão com WhatsApp Web |
| `express` | Servidor HTTP e roteamento |
| `socket.io` | Comunicação em tempo real (Dashboard) |
| `ejs` | Engine de templates HTML |
| `pg` | Cliente PostgreSQL |
| `bullmq` + `ioredis` | Filas de jobs com Redis |
| `googleapis` | Google Sheets API |
| `puppeteer` | Automação de browser (RPA) |
| `pdfkit` | Geração de PDFs |
| `node-cron` | Agendamento de tarefas |
| `express-session` | Gerenciamento de sessões |
| `dotenv` | Variáveis de ambiente |

---

## 📄 `dockerfile` — Imagem Docker da Aplicação

Define como construir a imagem Docker do bot em dois estágios para otimizar o tamanho final.

**Estágio 1 (builder):** usa `node:20-slim`, copia o `package.json` e roda `npm install`.

**Estágio 2 (produção):**
- Parte de uma nova imagem `node:20-slim` limpa.
- Instala via `apt-get` as dependências do sistema necessárias para Puppeteer e Baileys: `chromium`, `ffmpeg`, `libnss3`, `libatk-bridge2.0-0` e outras bibliotecas gráficas.
- Define `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` para que o Puppeteer use o Chromium do sistema.
- Copia as `node_modules` do estágio anterior e o código-fonte.
- Expõe a porta `3000` e define `CMD ["node", "index.js"]`.

---

## 📄 `docker-compose.yml` — Orquestração de Containers

Define e conecta todos os serviços necessários para o sistema rodar em produção ou localmente.

### Serviços

| Serviço | Imagem | Finalidade |
|---|---|---|
| `db` | `postgres:15` | Banco de dados principal |
| `redis` | `redis:7-alpine` | Fila de jobs (BullMQ) |
| `app` | `ghcr.io/FmzJuan/charlie-bot:latest` | O bot em si |
| `watchtower` | `containrrr/watchtower` | Auto-atualização do container |

**Detalhes importantes:**
- O serviço `db` monta `DataBase/init.sql` em `docker-entrypoint-initdb.d/` para criar as tabelas automaticamente na primeira inicialização.
- O serviço `app` monta `./auth_info_baileys` como volume para persistir a sessão do WhatsApp entre restarts.
- O `watchtower` verifica a imagem do bot a cada **300 segundos** e atualiza automaticamente se houver nova versão no registry.
- Redis é configurado com persistência: salva snapshot a cada 60s se houver pelo menos 1 mudança.

---

## 📄 `start.sh` — Script de Inicialização (Linux/VPS)

Script Bash para iniciar o sistema em ambientes Linux com uma interface amigável no terminal.

1. Verifica se o Docker está instalado. Se não estiver, exibe erro em vermelho e encerra.
2. Executa `docker compose up -d` para subir todos os containers em background.
3. Exibe mensagem de sucesso em verde com a URL de acesso `http://localhost:3000`.

Uso: `bash start.sh` ou `./start.sh` (após `chmod +x start.sh`).

---

## 📄 `Ligar_Sistema.bat` — Script de Inicialização (Windows)

Equivalente Windows do `start.sh`, para máquinas de desenvolvimento ou clientes com Windows.

1. Verifica se o Docker está disponível com `docker --version`. Se não estiver rodando, exibe erro e pausa.
2. Executa `docker compose up -d`.
3. Exibe mensagem de sucesso e aguarda input com `pause` para não fechar o terminal.

Uso: duplo clique no arquivo ou executar no Prompt de Comando.

---

## 📄 `.gitignore` — Arquivos Ignorados pelo Git

Lista os arquivos e pastas que não devem ser versionados:

- `node_modules/` — dependências instaladas localmente
- `.env` — variáveis de ambiente com credenciais
- `credentials.json` — chave da Service Account do Google
- `auth_info_baileys/` — sessão autenticada do WhatsApp
- Arquivos de relatório PDF gerados temporariamente
- Pasta `downloads/` usada pelo RPA do Puppeteer

---

## 📄 `legado.js` — Código de Versão Anterior

Contém a versão anterior monolítica do bot, antes da refatoração para a arquitetura modular atual. Mantido no repositório para referência histórica e consulta durante a migração.

> ⚠️ **Este arquivo não é importado em nenhum lugar do sistema ativo.** Serve apenas como documentação do código legado.

---

## 📄 `LeadFlow_ WhatsApp Automation Engine.md` — Documento de Especificação

Documento em Markdown que descreve a arquitetura, objetivos e decisões técnicas do projeto LeadsFlow. Serve como documentação de alto nível do sistema, registrando a visão do produto e o raciocínio por trás das escolhas de tecnologia e estrutura.
