# 🧪 testes

A pasta `testes` contém a suíte de testes automatizados do projeto, escrita com **Jest**. Os testes cobrem desde funções utilitárias até a conectividade com a infraestrutura (banco e fila).

Para rodar todos os testes:
```bash
npm test
```

---

## 📁 Estrutura

```
testes/
├── formatador.test.js  → Testa as funções de formatação de leads
├── infra.test.js       → Testa a conectividade com PostgreSQL e Redis
├── sheets.test.js      → Testa a autenticação com o Google Sheets
├── templates.test.js   → Testa a geração dos textos de mensagens
└── whatsapp.test.js    → Testa o motor de envio de mensagens (mock)
```

---

## 📄 `formatador.test.js` — Testes de Formatação

Testa as duas funções exportadas por `utils/formatador.js`.

**Teste 1 — `formatarNumeroBaileys`:**
- Passa o número `"(11) 97274-3124"` (com máscara) e verifica se a saída é o JID formatado `'5511972743124@s.whatsapp.net'`.
- Valida que a função remove formatação, adiciona o DDI `55` e o sufixo correto.

**Teste 2 — `formatarLeadParaSheets`:**
- Cria uma linha simulada de CSV com `nome`, `celular`, `datacadastro` e `veiculo`.
- Verifica que o array retornado tem exatamente **8 posições** (colunas A a H).
- Valida os valores nas posições críticas: nome (B), celular original (C), JID limpo (E) e status inicial `'pendente'` (F).

---

## 📄 `infra.test.js` — Testes de Infraestrutura

Testa se os serviços de infraestrutura estão acessíveis. Projetado para funcionar tanto localmente quanto em CI/CD (GitHub Actions).

**Teste 1 — PostgreSQL:**
- Cria um Pool de conexão usando `DATABASE_URL` do ambiente ou uma string de fallback.
- Executa a query `SELECT NOW()` e verifica que retorna pelo menos 1 linha.
- Se o banco local estiver desligado, o teste não quebra o CI — apenas loga um aviso e valida que o erro foi definido.

**Teste 2 — Redis:**
- Conecta ao Redis usando `REDIS_URL` do ambiente ou `redis://localhost:6379`.
- Envia o comando `PING` e verifica se a resposta é `'PONG'`.
- Mesmo comportamento tolerante ao ambiente local.

---

## 📄 `sheets.test.js` — Testes de Integração com Google Sheets

Verifica se as credenciais do Google estão presentes e válidas.

**Teste 1 — Localização das credenciais:**
- Verifica se o arquivo `credentials.json` existe na raiz do projeto.
- Se estiver no ambiente de CI (GitHub Actions) e o arquivo não existir, encerra o teste com sucesso (as credenciais chegam via Secret no CI).
- Se estiver localmente, exige que o arquivo exista e que seja possível instanciar um cliente autenticado com ele.

---

## 📄 `templates.test.js` — Testes de Templates de Mensagem

Testa a geração dos textos por `utils/templates.js`.

**Teste 1 — Template de revisão de 6 meses:**
- Chama `templates.REVISAO_6M('Juan', 'Honda Civic')`.
- Verifica que o texto gerado contém o nome `'Juan'`, o veículo `'Honda Civic'` e a expressão `'6 meses'`.
- Garante que a função de template injeta corretamente as variáveis na mensagem.

---

## 📄 `whatsapp.test.js` — Testes do Motor de Envio (Mock)

Testa a lógica de envio de mensagens usando um **mock** do Baileys (sem conexão real com o WhatsApp).

**Teste 1 — Mensagem pronta para envio:**
- Chama o mock com um JID válido (`5511972743124@s.whatsapp.net`) e um texto.
- Verifica que `success: true` é retornado e que a função foi chamada com os parâmetros corretos.

**Teste 2 — Número inválido:**
- Chama o mock com um número sem o sufixo `@s.whatsapp.net`.
- Verifica que `success: false` é retornado, garantindo que a validação do JID funciona.

---

## 📌 Observações

- O `package.json` está configurado com `--detectOpenHandles --forceExit` para garantir que o Jest encerre mesmo com conexões abertas.
- Os testes de infraestrutura são **tolerantes a falhas locais** — não impedem o desenvolvimento se os serviços estiverem desligados.
