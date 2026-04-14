const { sincronizarBasePosVenda } = require('./googleSheets'); // Ajuste o caminho se necessário

async function executar() {
    const clienteAgenciaId = 1; // ID da Rissato
    console.log("🚀 Forçando sincronização do Banco para o Sheets...");
    await sincronizarBasePosVenda(clienteAgenciaId);
    console.log("🏁 Finalizado!");
    process.exit(0);
}

executar();