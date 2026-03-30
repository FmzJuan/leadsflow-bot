// testes/bullmq.test.js
const { Queue, Worker } = require("bullmq");
const Redis = require("ioredis");

// Mockar o Redis para que os testes não dependam de uma instância real
jest.mock("ioredis", () => {
  const RedisMock = require("ioredis-mock");
  return jest.fn(() => new RedisMock());
});

// Mockar o módulo whatsapp para evitar chamadas reais
jest.mock("../Engine/whatsapp", () => ({
  getClientSocket: jest.fn(() => ({ sendMessage: jest.fn() })),
}));

// Assumindo que você tem um arquivo scheduler.js que adiciona jobs
// Ex: const { addPostVendaJob } = require('../Chat/RissatoMotors/scheduler');
// E um arquivo worker.js que processa os jobs
// Ex: const { iniciarWorker } = require('../Chat/RissatoMotors/worker');

describe("BullMQ - Fila de Pós-Venda", () => {
  let postVendaQueue;
  let worker;

  beforeEach(() => {
    // Resetar mocks e criar novas instâncias de fila/worker para cada teste
    Redis.mockClear();
    postVendaQueue = new Queue("post-venda", { connection: new Redis() });
    // O worker precisa ser instanciado com a lógica real de processamento
    // Você precisará refatorar seu worker.js para exportar a função de processamento
    // Ex: module.exports = { iniciarWorker, processJob };
    // const { processJob } = require('../Chat/RissatoMotors/worker');
    // worker = new Worker('post-venda', processJob, { connection: new Redis() });

    // Para este exemplo, vamos mockar o processamento do worker
    worker = new Worker("post-venda", async (job) => {
      // Simular a lógica do worker
      console.log(`Processando job ${job.id}: ${job.data.mensagem}`);
      return "Job processado com sucesso";
    }, { connection: new Redis() });
  });

  afterEach(async () => {
    await postVendaQueue.close();
    await worker.close();
  });

  test("Deve adicionar um job à fila de pós-venda", async () => {
    const jobData = {
      clienteId: 1,
      numero: "5511999998888",
      mensagem: "Olá, seu carro está pronto!",
      delay: 1000,
    };
    const job = await postVendaQueue.add("send-message", jobData, { delay: jobData.delay });

    expect(job.id).toBeDefined();
    expect(job.data).toEqual(jobData);

    // Verificar se o job foi adicionado e pode ser recuperado
    const jobs = await postVendaQueue.getJobs();
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    expect(jobs[0].data).toEqual(jobData);
  });

  test("O worker deve processar um job da fila", async () => {
    const jobData = {
      clienteId: 1,
      numero: "5511999998888",
      mensagem: "Olá, seu carro está pronto!",
      delay: 1000,
    };
    await postVendaQueue.add("send-message", jobData);

    // Esperar que o worker processe o job
    const processedJob = await new Promise((resolve) => {
      worker.on("completed", (job) => resolve(job));
    });

    expect(processedJob.data).toEqual(jobData);
    expect(processedJob.returnvalue).toEqual("Job processado com sucesso");
  });
});
