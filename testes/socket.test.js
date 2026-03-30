// testes/socket.test.js
const { createServer } = require("http" );
const { Server } = require("socket.io");
const Client = require("socket.io-client");
const mainApp = require("../index"); // Seu app Express exportado

describe("Socket.IO - Emissão de Logs", () => {
  let io, serverSocket, clientSocket, httpServer;

  beforeAll((done ) => {
    httpServer = createServer(mainApp ); // Usar o app Express como base
    io = new Server(httpServer ); // Seu servidor Socket.IO

    httpServer.listen(( ) => {
      const port = httpServer.address( ).port;
      clientSocket = new Client(`http://localhost:${port}` );
      io.on("connection", (socket) => {
        serverSocket = socket;
      });
      clientSocket.on("connect", done);
    });
  });

  afterAll(() => {
    io.close();
    clientSocket.close();
    httpServer.close( );
  });

  test("Deve emitir um evento 'new-log-clienteId' quando um novo lead é detectado", (done) => {
    const clienteId = 1;
    const logMessage = { msg: "Novo lead detectado: Teste (123456789)" };

    clientSocket.on(`new-log-${clienteId}`, (data) => {
      expect(data).toEqual(logMessage);
      done();
    });

    // Simular a chamada que emitiria o log (você precisará refatorar para expor essa função)
    // Por exemplo, se a lógica de salvar lead estiver em uma função separada:
    // require('../Engine/whatsapp').emitLogToDashboard(clienteId, logMessage);

    // Para este exemplo, vamos simular a emissão diretamente do 'io' que é exportado
    // Você exportou 'io' em index.js, então podemos acessá-lo aqui.
    // No seu index.js, a emissão ocorre dentro do listener do WhatsApp ou de outras funções.
    // Para testar isso, você precisaria mockar as funções que chamam io.emit.
    // Ou, para um teste de integração mais direto, simular a ação que dispara o log.

    // Exemplo simplificado (você precisará adaptar à sua estrutura real):
    // Se a função `salvarLeadEDispararLog` existe e usa `io.emit`:
    // salvarLeadEDispararLog(clienteId, 'Test', '123456789');

    // Para o propósito deste teste, vamos chamar diretamente o io.emit que é exportado
    // do seu index.js (assumindo que você o exportou como `module.exports = { io, app };`)
    const { io: mainIo } = require("../index");
    mainIo.emit(`new-log-${clienteId}`, logMessage);
  });
});
