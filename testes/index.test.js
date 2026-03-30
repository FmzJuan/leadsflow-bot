// testes/auth.test.js
const request = require("supertest");
const express = require("express");
const session = require("express-session");
const { query } = require("../DataBase/conection"); // Mockaremos isso

// Mockar o módulo de conexão com o banco de dados
jest.mock("../DataBase/conection", () => ({
  query: jest.fn(),
}));

// Criar uma instância mínima do app Express para testes
const createApp = () => {
  const app = express();
  app.set("view engine", "ejs");
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: "test_secret", // Usar um segredo de teste
      resave: false,
      saveUninitialized: true,
    })
  );

  // Mockar o middleware de cliente (para simular subdomínios)
  app.use(async (req, res, next) => {
    req.cliente = {
      id: 1,
      nome_oficina: "Rissato Motors",
      subdominio: "rissatomotors",
      email_contato: "admin@rissato.com",
      senha_dashboard: "123456",
      google_sheets_id: "mock_sheet_id",
    };
    res.locals.cliente = req.cliente;
    next();
  });

  // Importar e usar as rotas do seu index.js
  // ATENÇÃO: Você precisará refatorar seu index.js para exportar o app Express
  // Ex: module.exports = app; no final do index.js
  const mainApp = require("../index"); // Assumindo que index.js exporta o app
  app.use(mainApp); // Montar o app principal

  return app;
};

describe("Rotas de Autenticação", () => {
  let app;

  beforeEach(() => {
    app = createApp();
    // Limpar mocks antes de cada teste
    query.mockClear();
  });

  test("Deve renderizar a página de login", async () => {
    const res = await request(app).get("/login");
    expect(res.statusCode).toEqual(200);
    expect(res.text).toContain("login.ejs"); // Ou algum texto específico da sua página de login
  });

  test("Deve logar com sucesso com credenciais do cliente", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, email_contato: "admin@rissato.com", senha_dashboard: "123456" }] });

    const res = await request(app)
      .post("/login")
      .send({ username: "admin@rissato.com", password: "123456" });

    expect(res.statusCode).toEqual(302); // Redirecionamento após login
    expect(res.headers.location).toEqual("/");
  });

  test("Não deve logar com credenciais inválidas do cliente", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // Simula cliente não encontrado ou senha errada

    const res = await request(app)
      .post("/login")
      .send({ username: "admin@rissato.com", password: "senha_errada" });

    expect(res.statusCode).toEqual(200); // Permanece na página de login ou exibe alerta
    expect(res.text).toContain("Usuário ou senha inválidos");
  });
});
