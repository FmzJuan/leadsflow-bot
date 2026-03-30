// testes/multiTenant.test.js
const request = require("supertest");
const express = require("express");
const session = require("express-session");
const { query } = require("../DataBase/conection");

jest.mock("../DataBase/conection", () => ({
  query: jest.fn(),
}));

const createAppWithMiddleware = () => {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test_secret", resave: false, saveUninitialized: true }));

  // O middleware de cliente do seu index.js
  app.use(async (req, res, next) => {
    const host = req.headers.host;
    const subdominio = host.split(".")[0];

    if (subdominio && subdominio !== "localhost" && subdominio !== "www") {
      try {
        const result = await query(
          "SELECT * FROM clientes_config WHERE subdominio = $1",
          [subdominio]
        );

        if (result.rows.length > 0) {
          req.cliente = result.rows[0];
          res.locals.cliente = req.cliente;
        } else {
          return res.status(404).send("Oficina não encontrada no sistema.");
        }
      } catch (err) {
        console.error("Erro ao buscar cliente:", err);
        return res.status(500).send("Erro interno do servidor.");
      }
    }
    next();
  });

  // Uma rota de teste para verificar se o cliente foi anexado
  app.get("/test-client", (req, res) => {
    if (req.cliente) {
      return res.json({ cliente: req.cliente.nome_oficina });
    }
    res.status(400).send("Cliente não definido");
  });

  return app;
};

describe("Middleware Multi-tenant", () => {
  let app;

  beforeEach(() => {
    app = createAppWithMiddleware();
    query.mockClear();
  });

  test("Deve carregar as informações do cliente para um subdomínio válido", async () => {
    const mockClient = {
      id: 1,
      nome_oficina: "Rissato Motors",
      subdominio: "rissatomotors",
    };
    query.mockResolvedValueOnce({ rows: [mockClient] });

    const res = await request(app)
      .get("/test-client")
      .set("Host", "rissatomotors.localhost"); // Simular o subdomínio

    expect(res.statusCode).toEqual(200);
    expect(res.body.cliente).toEqual("Rissato Motors");
    expect(query).toHaveBeenCalledWith(
      "SELECT * FROM clientes_config WHERE subdominio = $1",
      ["rissatomotors"]
    );
  });

  test("Deve retornar 404 para um subdomínio não encontrado", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get("/test-client")
      .set("Host", "naoexiste.localhost");

    expect(res.statusCode).toEqual(404);
    expect(res.text).toContain("Oficina não encontrada");
  });

  test("Não deve definir cliente para localhost", async () => {
    const res = await request(app)
      .get("/test-client")
      .set("Host", "localhost");

    expect(res.statusCode).toEqual(400);
    expect(res.text).toContain("Cliente não definido");
  });
});
