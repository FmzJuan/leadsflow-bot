# 🛠️ utils

A pasta `utils` contém funções e constantes utilitárias reutilizáveis em todo o projeto — formatação de dados e templates de mensagens.

---

## 📁 Estrutura

```
utils/
├── formatador.js  → Funções de formatação de números e dados de leads
└── templates.js   → Templates fixos de mensagens para o WhatsApp
```

---

## 📄 `formatador.js` — Formatação de Dados

Contém as funções responsáveis por normalizar e transformar dados brutos (do ERP ou do WhatsApp) nos formatos exigidos pelo Baileys e pelo Google Sheets.

### `formatarNumeroBaileys(celularBruto)`
Transforma qualquer string de telefone no **JID completo** exigido pelo Baileys para envio de mensagens.

- Remove todos os caracteres não numéricos (parênteses, traços, espaços).
- Se o número não começar com `55` e tiver 10+ dígitos, adiciona o DDI `55`.
- Se já começar com `55`, mantém como está.
- Adiciona o sufixo `@s.whatsapp.net` ao final.
- **Retorna**: string no formato `5511972743124@s.whatsapp.net` ou `null` se inválido/vazio.

**Exemplos:**
```
"(11) 97274-3124" → "5511972743124@s.whatsapp.net"
"11999998888"     → "5511999998888@s.whatsapp.net"
"5511988887777"   → "5511988887777@s.whatsapp.net"
```

---

### `formatarLeadParaSheets(linhaCSV)`
Transforma uma linha bruta do CSV do ERP em um array ordenado, pronto para ser inserido como linha no Google Sheets.

**Parâmetro:** objeto com as chaves da linha do CSV (ex: `{ nome, celular, datacadastro, id_cliente }`).

**O que ela faz:**
1. Extrai os campos `id_cliente`, `nome`, `celular` e `datacadastro` da linha.
2. Valida se `nome` e `celular` existem — se não, retorna `null` (linha ignorada).
3. Chama `formatarNumeroBaileys()` para gerar o JID limpo. Se inválido, retorna `null`.
4. Retorna um array de 8 posições seguindo a estrutura das colunas da planilha:

| Posição | Coluna | Conteúdo |
|---|---|---|
| 0 | A | `id_cliente` |
| 1 | B | `nome` (sem espaços extras) |
| 2 | C | `celular` original |
| 3 | D | `datacadastro` |
| 4 | E | JID formatado (`5511...@s.whatsapp.net`) |
| 5 | F | `"pendente"` (status inicial) |
| 6 | G | `"aguardando"` (gatilho 24h) |
| 7 | H | `"aguardando"` (gatilho 6 meses) |

---

## 📄 `templates.js` — Templates de Mensagens

Objeto com os textos prontos das mensagens automáticas do bot. Cada template é uma função que recebe parâmetros e retorna a mensagem personalizada.

### Templates disponíveis

#### `SAUDACAO_24H(nome)`
Mensagem enviada 24 horas após o serviço:
> *"Olá {nome}! Tudo bem? Gostamos muito de ter você aqui na Rissato Motors ontem. Como foi sua experiência com o serviço?"*

#### `REVISAO_6M(nome, veiculo)`
Mensagem enviada 6 meses após o último serviço:
> *"Oi {nome}, aqui é da Rissato Motors! Notamos que faz 6 meses que você revisou seu {veiculo}. Que tal agendar uma nova inspeção?"*

#### `ERRO_SISTEMA`
String estática usada em caso de falha interna:
> *"⚠️ Ops! Tivemos um problema ao processar seu pedido. Mas já estamos verificando!"*

---

## 📌 Diferença entre `templates.js` e `mensagens.js`

| | `utils/templates.js` | `Chat/RissatoMotors/mensagens.js` |
|---|---|---|
| **Formato** | Funções com parâmetros nomeados | Arrays de strings com `{nome}` |
| **Uso** | Chamado diretamente com `templates.SAUDACAO_24H(nome)` | Sorteio aleatório pelo `worker.js` |
| **Propósito** | Templates formais e reutilizáveis | Variações para evitar repetição |
