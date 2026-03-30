// jest.setup.js

// Carrega as variáveis de ambiente do .env.test (se existir)
// Certifique-se de ter um arquivo .env.test com as configurações para o ambiente de teste
require('dotenv').config({ path: '.env.test' });

// Mockar o módulo de conexão com o banco de dados globalmente para evitar conexões reais
// durante testes unitários que não dependem do DB. Para testes de integração de DB, você pode
// sobrescrever este mock no arquivo de teste específico.
jest.mock('./DataBase/conection', () => ({
  query: jest.fn(() => Promise.resolve({ rows: [] })), // Retorna um array vazio por padrão
}));

// Mockar o módulo whatsapp globalmente
jest.mock('./Engine/whatsapp', () => ({
  connectToWhatsApp: jest.fn(),
  getClientSocket: jest.fn(() => ({ sendMessage: jest.fn() })), // Retorna um mock de socket com sendMessage
}));

// Mockar o módulo googleSheets globalmente
jest.mock('./Functions/googleSheets', () => ({
  salvarNoSheets: jest.fn(),
  processarCampanhaPosVenda: jest.fn(),
}));

// Mockar o Puppeteer globalmente para evitar iniciar um navegador real em todos os testes
// Apenas para testes que realmente precisam do Puppeteer, você pode sobrescrever este mock
// ou usar `jest-puppeteer` com um setup específico.
jest.mock('puppeteer', () => ({
  launch: jest.fn().mockResolvedValue({
    newPage: jest.fn().mockResolvedValue({
      goto: jest.fn(),
      type: jest.fn(),
      click: jest.fn(),
      waitForNavigation: jest.fn(),
      $$eval: jest.fn(),
      close: jest.fn(),
    }),
    close: jest.fn(),
  }),
}));

// Configuração para o Jest-Puppeteer (se você estiver usando o preset no jest.config.js)
// global.jestPuppeteer = require('jest-puppeteer');

// Se você precisar de um Redis real para BullMQ, configure-o aqui ou em um setup de teste específico
// Exemplo com redis-memory-server (requer instalação: npm install --save-dev redis-memory-server)
// const { RedisMemoryServer } = require('redis-memory-server');
// let redisServer;

// beforeAll(async () => {
//   redisServer = new RedisMemoryServer();
//   const host = await redisServer.getHost();
//   const port = await redisServer.getPort();
//   process.env.REDIS_HOST = host;
//   process.env.REDIS_PORT = port.toString();
// });

// afterAll(async () => {
//   if (redisServer) {
//     await redisServer.stop();
//   }
// });

// Importante: Certifique-se de que seu `index.js` exporte o `app` Express
// para que `supertest` possa usá-lo.
// Exemplo de como seu index.js deve terminar:
// if (process.env.NODE_ENV !== 'test') {
//   server.listen(3000, () => {
//     console.log("🌐 Painel LeadsFlow: http://rissatomotors.localhost:3000" );
//     start();
//   });
// }
// module.exports = app;
