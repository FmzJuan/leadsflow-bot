const { sincronizarBasePosVenda } = require('./Functions/googleSheets'); // <-- Caminho corrigido aqui

async function executar() {
    const clienteAgenciaId = 1; // ID da Rissato
    console.log("🚀 A forçar sincronização do Banco para o Sheets...");
    await sincronizarBasePosVenda(clienteAgenciaId);
    console.log("🏁 Finalizado!");
    process.exit(0);
}

executar();