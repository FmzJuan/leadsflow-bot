# 🎨 public

A pasta `public` contém os arquivos estáticos servidos diretamente pelo Express para o navegador. Por convenção do framework, tudo aqui é acessível publicamente via URL sem autenticação.

---

## 📁 Estrutura

```
public/
└── style.css  → Estilos globais da Dashboard LeadsFlow
```

---

## 📄 `style.css` — Estilos Globais da Dashboard

Arquivo de estilos CSS que define a identidade visual da interface web do LeadsFlow. É carregado em todas as views EJS via `<link rel="stylesheet" href="/style.css">`.

### O que ele estiliza

**Reset e base:** normaliza margens, paddings e box-sizing. Define a fonte global como `Inter` e o fundo da página como preto profundo (`#09090b`) com um gradiente radial roxo sutil no topo.

**Variáveis CSS (`:root`):** centraliza as cores e métricas do sistema:
- `--primary-color: #6366f1` — azul/roxo tecnológico
- `--primary-hover: #4f46e5` — variação escura para hover
- `--bg-color: #09090b` — fundo quase preto
- `--card-bg: rgba(24,24,27,0.7)` — fundo dos cards com transparência
- `--border-color: rgba(255,255,255,0.08)` — bordas sutis
- `--text-main: #f4f4f5` — texto principal claro
- `--text-muted: #a1a1aa` — texto secundário acinzentado

**Header:** barra superior com logo "LeadsFlow" e espaçamento lateral de 40px.

**`.brand-title`:** estiliza o logotipo textual. A palavra "Flow" recebe um gradiente linear de roxo a lilás via `-webkit-background-clip: text`.

**Cards (`.card`):** elementos com efeito **glassmorphism** — fundo semitransparente, `backdrop-filter: blur(12px)`, borda sutil e `border-radius: 16px`. Possuem transição suave de `translateY` no hover para efeito de elevação.

**Botões (`.btn-primary`, `.btn-secondary`):** largura total, bordas arredondadas e sombra colorida. `.btn-primary` usa a cor primária com sombra roxa; `.btn-secondary` usa fundo transparente com borda.

**Scrollbar personalizada:** estiliza a barra de rolagem dos containers de log para manter a estética escura — trilho semitransparente e polegar na cor primária roxa.

**Responsividade:** o layout principal usa CSS Grid com `auto-fit` e `minmax(320px, 1fr)`, adaptando automaticamente de 1 a 3 colunas conforme a largura da tela.

---

## 📌 Observações

- Servido pelo Express automaticamente via `app.use(express.static('public'))` no `index.js`.
- Estilos específicos de cada página (animações da dashboard, por exemplo) são declarados diretamente nos arquivos `.ejs` via `<style>` inline, por questões de escopo.
