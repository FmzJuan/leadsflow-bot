# 🖥️ views

A pasta `views` contém os templates HTML renderizados pelo servidor usando a **engine EJS** (Embedded JavaScript). São as telas visíveis ao usuário no painel web do LeadsFlow.

---

## 📁 Estrutura

```
views/
├── index.ejs  → Dashboard principal do sistema
└── login.ejs  → Tela de autenticação
```

---

## 📄 `login.ejs` — Tela de Login

Página de autenticação do painel LeadsFlow. É a primeira tela exibida ao acessar o sistema sem uma sessão ativa.

### Visual
- Fundo escuro (`#09090b`) com gradiente radial roxo vindo do topo.
- Card centralizado com efeito **glassmorphism**: `backdrop-filter: blur(16px)` e borda sutil.
- Logotipo textual "Leads**Flow**" com gradiente linear na palavra "Flow" (roxo → lilás).
- Campos de input com estilo escuro, foco com borda roxa e sombra glow.
- Botão de submit com sombra colorida e animação de elevação no hover.

### Funcionalidade
- Renderiza um formulário HTML que envia `POST /login` com os campos `username` e `password`.
- Não possui lógica JavaScript no cliente — a autenticação é inteiramente processada no servidor (`index.js`).
- Rodapé com copyright `© 2026 LeadsFlow CRM & Automação`.

---

## 📄 `index.ejs` — Dashboard Principal

Painel de controle em tempo real do bot. Exibe o status da conexão, logs de atividade e ações disponíveis para o operador.

### Variáveis EJS injetadas pelo servidor

| Variável | Descrição |
|---|---|
| `<%= sheetLink %>` | URL direta para a planilha Google do cliente |
| `<%= nomeEmpresa %>` | Nome da empresa/cliente exibido no card de ações |

### Layout

Usa CSS Grid com `auto-fit` e `minmax(320px, 1fr)`, gerando até 3 colunas responsivas de cards. Cada card tem 420px de altura, fundo translúcido com blur e animação de elevação no hover.

### Cards da Dashboard

#### Card 1 — Conexão WhatsApp
- Exibe um `<canvas>` onde o QR Code é renderizado via a biblioteca `qrcode.js` quando necessário.
- Quando o bot conecta, o canvas é ocultado e um ícone de check verde (`fas fa-check-circle`) é exibido com animação `fadeIn`.
- Um badge no header (`status-badge`) muda entre `CONECTADO` (verde) e `OFFLINE` (vermelho) em tempo real.

#### Card 2 — Monitor de Atividade
- Container de logs com scroll, estilo terminal escuro.
- Exibe entradas de log em tempo real recebidas via Socket.IO, com timestamp e cor diferenciada para sucesso (verde).
- Limita automaticamente a 50 entradas para não sobrecarregar a memória do DOM.

#### Card 3 — Ações
- Botão **"Planilha CRM"**: abre a planilha Google em nova aba.
- Botão **"Baixar Relatório PDF"**: redireciona para `/api/relatorio/pdf` que gera e faz o download do PDF.
- Exibe o nome da empresa ativa (injetado via EJS).

### Eventos Socket.IO no cliente

| Evento | Ação |
|---|---|
| `qr` | Renderiza o QR Code no canvas e atualiza o badge para OFFLINE |
| `status` | Alterna entre a tela de QR Code e o ícone de conectado; atualiza o badge |
| `new-log` | Insere uma nova entrada no monitor de logs com timestamp atual |

---

## 📌 Observações

- O EJS é configurado no `index.js` com `app.set('view engine', 'ejs')`.
- As views são renderizadas com `res.render('nome-da-view', { variáveis })` — sem necessidade de extensão `.ejs`.
- O Socket.IO é carregado do servidor local (`/socket.io/socket.io.js`) e o QRCode da CDN do jsDelivr.
- O `style.css` global é carregado via `<link href="/style.css">` a partir da pasta `public/`.
