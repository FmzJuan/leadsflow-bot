# 💬 Chat

A pasta `Chat` contém os módulos de lógica de conversa e automação específicos de cada cliente do sistema. Cada subpasta representa um cliente/projeto independente, com seu próprio fluxo, mensagens e integrações.

---

## 📁 Estrutura

```
Chat/
└── RissatoMotors/
    ├── api.js        → Endpoint que recebe dados do ERP via webhook
    ├── erpSync.js    → RPA com Puppeteer para extrair clientes do ERP
    ├── fluxo.js      → Lógica de resposta automática ao cliente
    ├── mensagens.js  → Templates de mensagens de pós-venda
    ├── scheduler.js  → Agendador de mensagens via fila Redis/BullMQ
    └── worker.js     → Consumidor da fila que dispara os envios
```

---

## 📁 RissatoMotors

Módulo completo de automação de pós-venda para a **Rissato Motors**, uma oficina mecânica. O fluxo: o ERP notifica o sistema quando um serviço é finalizado → o sistema agenda mensagens automáticas de acompanhamento para 24 horas e 6 meses depois → o worker processa os envios no momento certo, de forma humanizada.

---

### 📄 `api.js` — Endpoint de Webhook do ERP

Controlador HTTP que recebe os dados do cliente diretamente do ERP quando um serviço é finalizado.

#### `receberDadosERP(req, res)`
- Extrai `nome`, `telefone`, `veiculo` e `data_saida` do body da requisição.
- Valida se os campos obrigatórios (`nome` e `telefone`) foram enviados. Se não, retorna erro `400`.
- Chama `agendarMensagens()` do `scheduler.js` para inserir o cliente na fila de pós-venda.
- Responde com `200` e confirmação de sucesso para o ERP.
- Em caso de erro interno, responde com `500`.

---

### 📄 `erpSync.js` — RPA de Extração do ERP

Robô de automação que usa **Puppeteer** para fazer login no sistema ERP da oficina e baixar a lista de clientes automaticamente, sem necessidade de API oficial.

#### `extrairDadosDoERP()`
Inicia o navegador headless e executa o fluxo completo de extração:

1. Abre o browser (headless em produção, visível em desenvolvimento).
2. Configura a pasta de download local (`downloads/`).
3. Acessa a URL de login do ERP e preenche `chave`, `usuário` e `senha` via variáveis de ambiente.
4. Clica em "Logar" e aguarda a navegação.
5. Detecta e fecha o tutorial de boas-vindas se aparecer.
6. Navega até o menu "Clientes" → "Listar Clientes".
7. Clica no botão de exportar CSV e aguarda 15 segundos para o download concluir.
8. Chama `processarCSVBaixado()` para processar o arquivo.
9. Fecha o browser ao final, mesmo em caso de erro.

#### `processarCSVBaixado()`
Lê e processa o CSV baixado pelo RPA:

1. Busca o arquivo mais recente na pasta `downloads/`.
2. Faz o streaming da leitura do CSV com separador `;`.
3. Para cada linha: salva os dados brutos para a aba `Dados_ERP` e formata os dados para a aba `Clientes` via `formatarLeadParaSheets()`.
4. Ao finalizar, chama `salvarDadosBrutosERP()` e `atualizarAbaClientes()` no Google Sheets.
5. Deleta o arquivo CSV após o processamento.

Se executado diretamente (`node erpSync.js`), chama `extrairDadosDoERP()` imediatamente.

---

### 📄 `fluxo.js` — Fluxo de Resposta ao Cliente

Gerencia as respostas automáticas do bot quando o cliente responde às mensagens de pós-venda.

#### `executar(sock, msg)`
- Extrai o texto da mensagem e o número do cliente.
- Se o cliente responder `"1"` (satisfeito): envia mensagem de agradecimento e registra "Feedback Positivo" no Google Sheets.
- Se o cliente responder `"2"` (insatisfeito): envia mensagem de desculpas, informa que a equipe entrará em contato, e registra `"ALERTA: Problema relatado"` no Sheets.

---

### 📄 `mensagens.js` — Templates de Mensagens

Arquivo de configuração com os textos das mensagens automáticas. Exporta dois arrays:

- **`mensagens24h`**: 3 variações de mensagens enviadas 24 horas após a saída do veículo, com a tag `{nome}` para personalização.
- **`mensagens6meses`**: 3 variações de mensagens enviadas 6 meses depois, sugerindo revisão preventiva. Também com `{nome}`.

O `worker.js` sorteia aleatoriamente uma mensagem de cada array para evitar repetições.

---

### 📄 `scheduler.js` — Agendador de Filas

Cria e gerencia filas de jobs com **BullMQ + Redis** para envio temporizado de mensagens.

Cria a fila `pos-venda-rissato` conectada ao Redis (host e porta configuráveis via `.env`).

#### `agendarMensagens(cliente)`
Insere dois jobs na fila para um cliente:

- **Job `feedback_24h`**: agendado com delay de 24 horas (ou `DELAY_24H` do `.env` para testes). O `jobId` é único por telefone + data de saída para evitar duplicatas.
- **Job `revisao_6meses`**: agendado com delay de 180 dias (ou `DELAY_6MESES` do `.env`).

Ambos carregam os dados `{ telefone, nome, tipo }` para o worker processar no momento correto.

---

### 📄 `worker.js` — Consumidor da Fila

Processa os jobs da fila `pos-venda-rissato` e realiza os envios de forma humanizada para evitar banimento.

#### `enviarMensagemHumana(sock, jid, texto)`
Envia uma mensagem simulando comportamento humano:

1. Ativa o indicador `"digitando..."` no WhatsApp via `sendPresenceUpdate('composing')`.
2. Aguarda um tempo **aleatório entre 10 e 20 segundos**.
3. Envia a mensagem de texto.
4. Para o indicador de digitação com `sendPresenceUpdate('paused')`.

#### `iniciarWorker(sock)`
Inicia o worker que fica escutando a fila continuamente:

1. Recebe o socket ativo do Baileys como parâmetro.
2. Para cada job: identifica o tipo (`24h` ou `6meses`), sorteia uma mensagem aleatória do array correspondente, substitui `{nome}` pelo primeiro nome do cliente e chama `enviarMensagemHumana()`.
3. Registra `completed` ou `failed` no console para monitoramento.

---

## 🔐 Variáveis de Ambiente necessárias

```env
ERP_CHAVE=       # Chave de acesso ao ERP da oficina
ERP_USER=        # Usuário do ERP
ERP_PASS=        # Senha do ERP
REDIS_HOST=      # Host do Redis (default: localhost)
REDIS_PORT=      # Porta do Redis (default: 6379)
DELAY_24H=       # (Opcional) Delay em ms para testes (padrão: 86400000)
DELAY_6MESES=    # (Opcional) Delay em ms para testes (padrão: 15552000000)
```
