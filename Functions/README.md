# ⚙️ Functions

A pasta `Functions` contém funções de integração reutilizáveis que podem ser chamadas de qualquer parte do projeto. Atualmente concentra toda a lógica de comunicação com o **Google Sheets**.

---

## 📁 Estrutura

```
Functions/
└── googleSheets.js  → Integração completa com a API do Google Sheets v4
```

---

## 📄 `googleSheets.js` — Integração com Google Sheets

Módulo central que gerencia todas as leituras e escritas na planilha Google do cliente, autenticando via Service Account.

Ao carregar, instancia o cliente `sheets` da Google API v4 usando o arquivo `credentials.json` da raiz do projeto. Também lê a variável `MODO_SIMULACAO` do `.env` — quando `true` (padrão), os envios são apenas logados no console sem disparar mensagens reais.

---

### Funções

#### `logSimulacao(cliente, mensagem)`
Função auxiliar interna para exibir no console os detalhes de um envio simulado. Exibe nome, JID, data de cadastro e a mensagem que seria enviada. Chamada apenas quando `MODO_SIMULACAO = true`.

---

#### `processarCampanhaPosVenda(sock)`
Orquestra a campanha completa de pós-venda, disparando mensagens para todos os clientes elegíveis.

1. Chama `obterClientesPosVenda()` para buscar os clientes da planilha.
2. Para cada cliente, monta uma mensagem personalizada com nome e data do último serviço.
3. Se `MODO_SIMULACAO = true`: apenas loga a mensagem no console.
4. Se `MODO_SIMULACAO = false`: envia via Baileys e aguarda **30 segundos** entre cada envio (anti-ban).
5. Exibe o total de mensagens processadas ao final.

---

#### `formatarNumero(celularBruto)`
Normaliza um número de telefone para o formato exigido pelo Baileys.

- Remove todos os caracteres não numéricos.
- Se o número já começa com `55` e tem 12+ dígitos, retorna como está.
- Caso contrário, adiciona o prefixo `55`.
- **Retorna**: string do número limpo com DDI, sem o sufixo `@s.whatsapp.net`.

---

#### `salvarNoSheets(dados)`
Insere uma nova linha de dados na aba `Página1` da planilha do cliente.

- Aceita tanto um **array direto** de valores quanto um **objeto** `{ nome, telefone, servico }`.
- Usa `spreadsheets.values.append` para inserir na próxima linha disponível a partir de `A2`.
- Se `SHEET_ID` não estiver no `.env`, loga erro e encerra.

---

#### `obterClientesPosVenda()`
Lê a aba `Clientes` da planilha e retorna os clientes aptos para disparo.

1. Busca as linhas da range `Clientes!A2:D`.
2. Para cada linha, extrai nome (B), celular (C) e data de cadastro (D).
3. Formata o número com `formatarNumero()` e monta o JID completo.
4. Aplica o sistema de **whitelist**: se `NUMEROS_PERMITIDOS` estiver definido no `.env`, apenas os números dessa lista são retornados — útil para restringir disparos em ambiente de teste.
5. **Retorna**: array de objetos `{ nome, numeroJid, dataCadastro }`.

---

#### `salvarDadosBrutosERP(cabecalho, linhas)`
Substitui completamente os dados da aba `Dados_ERP` com o conteúdo bruto do CSV baixado pelo RPA.

1. Limpa toda a aba `Dados_ERP` com `values.clear`.
2. Reconstrói a tabela: coloca o cabeçalho na linha 1, seguido de todas as linhas de dados.
3. Insere tudo de uma vez com `values.append` na range `Dados_ERP!A1`.

---

#### `atualizarAbaClientes(dadosLimpos)`
Adiciona os dados já formatados e filtrados à aba `Clientes` da planilha.

- Recebe um array de arrays (cada sub-array é uma linha pronta, formatada pelo `formatarLeadParaSheets()`).
- Insere na próxima linha disponível a partir de `Clientes!A2`.

---

## 🔐 Variáveis de Ambiente necessárias

```env
SHEET_ID=              # ID da planilha Google (da URL do Sheets)
MODO_SIMULACAO=        # true = apenas loga | false = dispara de verdade
NUMEROS_PERMITIDOS=    # Whitelist separada por vírgula (ex: 5511999998888,5511888887777)
```

> O arquivo `credentials.json` com as credenciais da Service Account deve estar na **raiz do projeto** (não versionado — está no `.gitignore`).
