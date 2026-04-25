# Documentação Técnica: LeadsFlow SaaS - Automação WhatsApp

Este documento descreve detalhadamente o funcionamento do sistema **LeadsFlow**, um motor de automação de WhatsApp multi-tenant projetado para oficinas mecânicas (ex: Rissato Motors). O sistema integra extração de dados de ERP (via RPA), gestão de filas (BullMQ/Redis), banco de dados relacional (PostgreSQL) e comunicação via WhatsApp (Baileys).

---

## 1. Estrutura de Pastas (Pasta por Pasta)

| Pasta | Descrição |
| :--- | :--- |
| `Chat/` | Contém a lógica específica de cada cliente (tenant). Cada subpasta (ex: `rissatomotors/`) possui seu próprio fluxo de mensagens, workers e sincronização. |
| `config/` | Configurações globais do sistema, como a gestão de sessões Express. |
| `Controllers/` | Lógica de negócio intermediária, como o processamento de webhooks vindos de sistemas externos. |
| `DataBase/` | Scripts de conexão com o banco de dados PostgreSQL (`conection.js`) e Redis (`redis.js`). |
| `Engine/` | O "coração" do WhatsApp. Gerencia a conexão, autenticação (QR Code) e eventos de mensagens usando a biblioteca Baileys. |
| `Functions/` | Funções utilitárias compartilhadas, como integração com Google Sheets e geração de relatórios PDF. |
| `middlewares/` | Filtros de requisição, como o `tenant.js` que identifica qual cliente está acessando o sistema. |
| `queues/` | Definição das filas de processamento em segundo plano (BullMQ). |
| `routes/` | Definição dos endpoints da API (Auth, Dashboard, API de Webhooks). |
| `sessions/` | Armazena os arquivos de autenticação do WhatsApp de cada cliente (tokens de sessão). |
| `workers/` | Processadores de tarefas em segundo plano que executam os jobs das filas. |

---

## 2. Fluxo de Funcionamento (Etapa por Etapa)

### Etapa A: Inicialização (`index.js`)
1. O servidor Express inicia e carrega as variáveis de ambiente.
2. O sistema busca no banco de dados todos os clientes com assinatura **ativa**.
3. Para cada cliente ativo:
   - Inicia o motor do WhatsApp (`Engine/whatsapp.js`).
   - Ativa os agendamentos automáticos (`cron.js` do cliente).
   - Inicia o processador de mensagens em segundo plano (`worker.js` do cliente).

### Etapa B: Conexão WhatsApp (`Engine/whatsapp.js`)
1. O sistema verifica se existe uma sessão salva em `sessions/`.
2. Se não houver, gera um **QR Code** e o envia via Socket.io para o Dashboard.
3. Após a conexão, o "Socket" do WhatsApp é mantido em memória para enviar/receber mensagens.

### Etapa C: Sincronização de Dados (RPA)
1. Um **Cron Job** global ou uma chamada manual via API dispara a sincronização.
2. O job é adicionado à fila `rpa-sync` (`queues/rpaqueue.js`).
3. O `workers/rpaworker.js` processa o job chamando o `erpSync.js` do cliente.
4. O robô extrai dados (clientes e ordens de serviço), cruza as informações e:
   - Salva no histórico do PostgreSQL.
   - Agenda novos **Leads** na tabela `leads` para disparos futuros (24h ou 6 meses).
   - Espelha os dados no Google Sheets.

### Etapa D: Disparo Automático (`cron.js` & `worker.js`)
1. Todos os dias às 08:00, o `cron.js` varre a tabela `leads` em busca de mensagens agendadas para o dia.
2. Os leads encontrados são enviados para a fila do Redis (`scheduler.js`).
3. O `worker.js` do cliente retira o lead da fila e:
   - Simula digitação humana (delay aleatório).
   - Envia a mensagem personalizada via WhatsApp.
   - Atualiza o status no banco de dados para "enviado".
   - Registra o envio no Google Sheets.

### Etapa E: Interação com o Cliente (`fluxo.js`)
1. Quando o cliente responde ao WhatsApp, o evento `messages.upsert` é disparado.
2. O `fluxo.js` do cliente analisa o texto (ex: "1" para OK, "2" para Problema).
3. O bot responde automaticamente e registra o feedback no Google Sheets.

---

## 3. Funções Principais (Função por Função)

### `index.js`
- `start()`: Função mestre que orquestra a inicialização de todos os clientes ativos.

### `Engine/whatsapp.js`
- `connectToWhatsApp(clienteId, ...)`: Cria a instância do Baileys, gerencia reconexão e eventos de QR Code.
- `sock.ev.on('messages.upsert')`: Escuta novas mensagens e as repassa para o fluxo do cliente.

### `Chat/rissatomotors/erpSync.js`
- `extrairDadosDoERP(clienteId, ...)`: Coordena a leitura de arquivos CSV e o cruzamento de dados Cliente x OS.
- `salvarNoPostgres(dados, ...)`: Lógica inteligente que decide se um lead deve receber mensagem em 24h ou 6 meses.

### `Chat/rissatomotors/worker.js`
- `enviarMensagemHumana(sock, jid, texto)`: Função de envio com "delay de digitação" para evitar banimento.
- `iniciarWorker(sock)`: Processador da fila BullMQ que executa o disparo efetivo.

### `Controllers/webhookController.js`
- `processarDadosERP(req, res)`: Recebe dados de leads via API externa, calcula datas de retorno e salva no banco/planilha.

---

## 4. Resumo para o Fluxograma

Para desenhar seu fluxograma, considere estes 4 grandes blocos:
1. **Entrada de Dados:** Webhook API ou Sincronização RPA (CSV).
2. **Processamento/Inteligência:** `erpSync.js` decidindo datas de agendamento e salvando no PostgreSQL.
3. **Agendamento:** `cron.js` diário movendo leads do Banco para a Fila Redis.
4. **Execução:** `worker.js` enviando mensagens via WhatsApp e coletando respostas via `fluxo.js`.
