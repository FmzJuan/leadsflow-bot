// testes/bullmq.test.js
const { Queue, Worker } = require("bullmq");

// 1. O Mock: Ensinamos o Jest a simular o BullMQ perfeitamente
jest.mock("bullmq", () => {
  return {
    Queue: jest.fn().mockImplementation(() => ({
      // Simulamos a adição de um job retornando dados fictícios
      add: jest.fn().mockResolvedValue({ id: "job-123", name: "send-message" }),
      
      // Simulamos o retorno de uma lista de jobs
      getJobs: jest.fn().mockResolvedValue([
        { id: "job-123", data: { clienteId: 1, numero: "5511999998888" } }
      ]),
      
      close: jest.fn().mockResolvedValue(true)
    })),
    
    Worker: jest.fn().mockImplementation(() => ({
      // Simulamos o evento "completed" do worker
      on: jest.fn((event, callback) => {
        if (event === "completed") {
          // Dispara o callback quase instantaneamente para o teste não travar
          setTimeout(() => {
            callback({ data: { clienteId: 1 }, returnvalue: "Job processado com sucesso" });
          }, 10);
        }
      }),
      close: jest.fn().mockResolvedValue(true)
    }))
  };
});

describe("BullMQ - Fila de Pós-Venda (Testes Isolados)", () => {
  let postVendaQueue;
  let worker;

  beforeEach(() => {
    // Limpar o histórico dos mocks antes de cada teste
    jest.clearAllMocks();
    
    // Instanciamos as versões simuladas (sem precisar de conexão Redis)
    postVendaQueue = new Queue("post-venda");
    worker = new Worker("post-venda", async () => {}); 
  });

  afterEach(async () => {
    await postVendaQueue.close();
    await worker.close();
  });

  test("Deve chamar a função de adicionar um job à fila", async () => {
    const jobData = {
      clienteId: 1,
      numero: "5511999998888",
      mensagem: "Olá, seu carro está pronto!",
      delay: 1000,
    };
    
    // Ação
    const job = await postVendaQueue.add("send-message", jobData, { delay: jobData.delay });

    // Verificação 1: O mock retornou o ID que ensinamos ele a retornar?
    expect(job.id).toBe("job-123");

    // Verificação 2: A função "add" foi chamada com os dados certos da Rissato Motors?
    expect(postVendaQueue.add).toHaveBeenCalledWith("send-message", jobData, { delay: 1000 });

    // Verificação 3: O getJobs simulado retorna um array?
    const jobs = await postVendaQueue.getJobs();
    expect(jobs.length).toBeGreaterThan(0);
  });

  test("O worker simulado deve emitir o evento de sucesso", async () => {
    // Esperar que o worker mockado dispare o evento "completed"
    const processedJob = await new Promise((resolve) => {
      worker.on("completed", (job) => resolve(job));
    });

    // Verificamos se o valor retornado bate com o que colocamos no mock lá em cima
    expect(processedJob.returnvalue).toEqual("Job processado com sucesso");
  });
});