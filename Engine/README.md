# ⚙️ Engine

A pasta `Engine` é o **núcleo de infraestrutura** do bot. Ela contém os módulos responsáveis pela conexão com o WhatsApp, geração de relatórios em PDF e integração com o Google Sheets.

---

## 📁 Estrutura

```
Engine/
├── whatsapp.js   → Conexão e gerenciamento do bot no WhatsApp
├── report.js     → Geração de relatórios em PDF
└── sheets.js     → Integração com Google Planilhas
```

---

## 📄 `whatsapp.js`

Módulo principal de conexão com o WhatsApp via **Baileys**.

### Funções

#### `connectToWhatsApp(onMessage)`
Inicializa e gerencia toda a conexão do bot com o WhatsApp Web.

**O que ela faz, passo a passo:**

1. **Importa o Socket.IO** do `index.js` para comunicação em tempo real com a Dashboard.
2. **Busca a versão mais recente** do WhatsApp Web via `fetchLatestBaileysVersion()`.
3. **Carrega o estado de autenticação** salvo localmente na pasta `auth_info_baileys/`, evitando que o QR Code precise ser lido novamente a cada reinício.
4. **Cria a instância do bot** (`makeWASocket`) com as configurações de browser, logger silencioso e autenticação.
5. **Inicia o Worker** de conversas (`iniciarWorker(sock)`) passando o socket ativo.
6. **Monitora eventos de conexão** (`connection.update`):
   - Se um **QR Code** for gerado, emite o QR via Socket.IO para a Dashboard renderizá-lo.
   - Se a conexão **fechar**, tenta reconectar automaticamente após 5 segundos (exceto se o usuário tiver deslogado manualmente).
   - Se a conexão **abrir**, emite o status `conectado` para a Dashboard.
7. **Salva as credenciais** automaticamente sempre que forem atualizadas (`creds.update`).
8. **Escuta as mensagens recebidas** (`messages.upsert`):
   - Ignora mensagens sem conteúdo.
   - Ignora mensagens de **grupos** (`@g.us`).
   - Extrai o texto da mensagem para identificar comandos.
   - Aplica uma **trava anti-loop**: ignora mensagens enviadas pelo próprio bot, exceto os comandos `!disparar` e `/relatorio`.
   - Verifica se o remetente é o **admin** (via `ADMIN_NUMBER` no `.env` ou `msg.key.fromMe`).
   - Se for admin: chama `onMessage(sock, msg)` com acesso total.
   - Se for um lead: chama `onMessage(sock, msg, true)` apenas para salvar o contato.

**Retorna:** a instância ativa do socket (`sock`).

---

#### `getBotStatus()`
Retorna o status atual da conexão do bot.

- **Retorna:** `'conectado'` ou `'desconectado'` (string).
- Usado pelo `index.js` para consultar o estado do bot a qualquer momento e exibir na Dashboard.

---

## 📄 `report.js`

Módulo de geração de **relatórios PDF** com os dados dos leads.

### Funções

#### `gerarRelatorioPDF()`
Gera um arquivo PDF estilizado com todos os leads cadastrados no banco de dados.

**O que ela faz, passo a passo:**

1. **Busca todos os contatos** da tabela `contatos` no banco de dados, ordenados pela `ultima_interacao` mais recente.
2. **Cria o documento PDF** com `PDFDocument` (biblioteca `pdfkit`), formato A4 com margens de 50px.
3. **Define o nome e caminho do arquivo**: `Relatorio_Leads_{timestamp}.pdf`, salvo na raiz do projeto.
4. **Renderiza o cabeçalho visual:**
   - Retângulo de fundo na cor `#1e1b4b` (roxo escuro) no topo da página.
   - Nome "LeadsFlow" em branco e negrito.
   - Subtítulo "RELATÓRIO DE INTERAÇÕES CRM".
   - Data e hora de geração no canto direito.
5. **Renderiza o cabeçalho da tabela** com as colunas: `ID`, `NOME DO CLIENTE`, `WHATSAPP` e `ÚLTIMA INTERAÇÃO`.
6. **Itera sobre os leads** e renderiza cada linha da tabela:
   - Aplica **efeito zebra** (fundo `#f9fafb` nas linhas pares) para facilitar a leitura.
   - Exibe o número do WhatsApp sem o sufixo `@s.whatsapp.net`.
   - Formata a data no padrão `pt-BR`.
   - Se o espaço vertical da página acabar (`currentY > 750`), **adiciona uma nova página** automaticamente e reinicia a posição Y.
7. **Renderiza o rodapé** em todas as páginas com o texto: `"LeadsFlow - Gestão Inteligente de Leads | Página X de Y"`.
8. **Finaliza o documento** e aguarda o stream terminar de escrever no disco.

**Retorna:** um objeto `{ fileName, filePath }` com o nome e o caminho absoluto do arquivo gerado, para que o bot possa enviá-lo via WhatsApp.

---

## 📄 `sheets.js`

Módulo de integração com o **Google Planilhas** via Google Sheets API v4.

### Configuração

Autentica usando uma **Service Account** do Google Cloud. As credenciais devem estar no arquivo `credentials.json` na raiz do projeto. O ID da planilha alvo deve ser definido na variável de ambiente `SHEET_ID` no `.env`.

### Funções

#### `salvarNoSheets(dados)`
Insere uma nova linha de dados na planilha e aplica formatação visual automática.

**Parâmetros:**
- `dados` — Array com os valores a serem inseridos nas colunas A até F (ex: `[id, nome, numero, data, ...]`).

**O que ela faz, passo a passo:**

1. **Autentica** com a Google API usando o `credentials.json` e o escopo de leitura/escrita em Sheets.
2. **Insere os dados** na próxima linha disponível da aba `Página1`, colunas `A:F`, usando `spreadsheets.values.append` com `valueInputOption: 'RAW'`.
3. **Aplica formatação visual** via `batchUpdate` com duas requisições simultâneas:
   - **Cabeçalho (linha 1):** fundo preto (`rgb(0,0,0)`), texto branco e em negrito, alinhamento centralizado — para as colunas A até F.
   - **Bordas da tabela (linhas 1–100):** bordas externas sólidas e médias em preto, com separadores internos horizontais em cinza claro (`rgb(0.8, 0.8, 0.8)`) — criando o efeito visual de uma tabela delimitada.

**Observação:** a formatação é reaplicada a cada inserção, garantindo que o visual permaneça consistente mesmo se a planilha for editada manualmente.

---

## 🔗 Dependências

| Módulo | Arquivo | Finalidade |
|---|---|---|
| `@whiskeysockets/baileys` | `whatsapp.js` | Conexão com WhatsApp Web |
| `qrcode-terminal` | `whatsapp.js` | Exibir QR Code no terminal |
| `pino` | `whatsapp.js` | Logger (silenciado em produção) |
| `pdfkit` | `report.js` | Geração de arquivos PDF |
| `googleapis` | `sheets.js` | Google Sheets API |
| `dotenv` | `sheets.js` | Leitura de variáveis de ambiente |

---

## 🔐 Variáveis de Ambiente necessárias

```env
ADMIN_NUMBER=   # Número do admin sem formatação (ex: 5511999998888)
SHEET_ID=       # ID da planilha Google (da URL do Sheets)
```
