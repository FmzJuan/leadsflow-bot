const { default: makeWASocket, useMultiFileAuthState, jidNormalizedUser } = require('@whiskeysockets/baileys');
const readline = require('readline');

// Configuração do leitor de terminal
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function iniciarTeste() {
    // IMPORTANTE: Use a mesma pasta onde sua sessão ativa/conectada está salva
    const { state } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false // Desativado para não poluir o teste
    });

    // Aguarda o Baileys carregar as chaves internas da sessão
    setTimeout(async () => {
        console.log("\n==================================================");
        console.log("   TESTE DE CONVERSÃO: LID -> NÚMERO REAL");
        console.log("==================================================\n");

        rl.question('Cole o LID aqui (Ex: 123456789012345@lid): ', async (inputLid) => {
            let lid = inputLid.trim();

            // Adiciona o sufixo padrão caso o usuário não digite
            if (!lid.endsWith('@lid')) {
                lid = `${lid}@lid`;
            }

            try {
                console.log(`\nBuscando mapeamento para: ${lid}...`);
                
                // Consulta direta ao repositório de criptografia de sinais do Baileys
                const numeroRealJid = await sock.signalRepository.lidMapping.getPNForLID(lid);

                if (numeroRealJid) {
                    const numeroLimpo = jidNormalizedUser(numeroRealJid);
                    console.log(`\n✅ SUCESSO!`);
                    console.log(`[LID]: ${lid}`);
                    console.log(`[Número Real]: ${numeroLimpo}`);
                } else {
                    console.log(`\n❌ Mapeamento não encontrado no cache local.`);
                    console.log(`Motivo: Esse LID nunca enviou mensagem direta para esta conta ou a sessão ainda não sincronizou o histórico.`);
                }
            } catch (error) {
                console.error("\n🔺 Erro ao processar a conversão:", error.message);
            }

            rl.close();
            process.exit(0);
        });

    }, 3000); // Aguarda 3 segundos para garantir a leitura dos arquivos de sessão
}

iniciarTeste();