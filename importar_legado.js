const fs = require('fs');
const readline = require('readline');
const { query } = require('./DataBase/conection');

async function processarLegado() {
    const clienteAgenciaId = 1; // ID da Rissato Motors
    const hoje = new Date();
    
    // Mapa na memória: ID_CLIENTE -> { nome, celular }
    const mapaClientes = new Map();

    console.log("📂 Passo 1: Carregando a base de clientes para a memória...");
    
    const streamClientes = fs.createReadStream('clientes.csv');
    const rlClientes = readline.createInterface({ input: streamClientes, crlfDelay: Infinity });
    
    let primeiraLinhaClientes = true;
    for await (const linha of rlClientes) {
        if (primeiraLinhaClientes) { primeiraLinhaClientes = false; continue; }
        
        // Ponto-e-vírgula é o padrão do Excel brasileiro para CSV
        const colunas = linha.split(';'); 
        const idCliente = colunas.at(0)?.trim(); 
        const nome = colunas.at(1)?.trim();      
        const celularBruto = colunas.at(10)?.trim(); 

        if (idCliente && celularBruto) {
            const celularLimpo = celularBruto.replace(/\D/g, ''); 
            mapaClientes.set(idCliente, { nome, celular: celularLimpo });
        }
    }
    console.log(`✅ ${mapaClientes.size} clientes carregados na memória!`);

    console.log("\n🚀 Passo 2: Processando Ordens de Serviço e Cruzando Dados...");
    
    const streamOS = fs.createReadStream('os.csv');
    const rlOS = readline.createInterface({ input: streamOS, crlfDelay: Infinity });
    
    let primeiraLinhaOS = true;
    let importados = 0;
    let indexPlaca = 6; 

    for await (const linha of rlOS) {
        const colunas = linha.split(';');

        // 🧠 O CÉREBRO: Lê o cabeçalho e descobre o número exato da coluna da Placa
        if (primeiraLinhaOS) { 
            primeiraLinhaOS = false; 
            const posicaoEncontrada = colunas.findIndex(col => col.trim().toUpperCase() === 'PLACA');
            if (posicaoEncontrada !== -1) {
                indexPlaca = posicaoEncontrada;
                console.log(`🔍 [Inteligência] Coluna PLACA encontrada na posição: ${indexPlaca}`);
            } else {
                console.log(`⚠️ [Aviso] Coluna PLACA não encontrada no cabeçalho. Tentando posição 6.`);
            }
            continue; 
        }
        
        const clienteERP = colunas.at(1)?.trim(); 
        const veiculo = colunas.at(5)?.trim();
        const placa = colunas.at(indexPlaca)?.trim() || 'Não informada';    // 👈 Agora usa a posição automática!
        const dataSaidaStr = colunas.at(19)?.trim(); 

        if (!clienteERP || !dataSaidaStr) continue;
        // Pega só o número antes do traço
        const idClienteOS = clienteERP.split('-').at(0)?.trim();
        const dadosDoCliente = mapaClientes.get(idClienteOS);

        // Se não achou o cliente ou não tem celular, descarta
        if (!dadosDoCliente || !dadosDoCliente.celular) continue;

        // Formata data de Saída
        const partesData = dataSaidaStr.split('/');
        if (partesData.length !== 3) continue;
        const dataZero = new Date(`${partesData.at(2)}-${partesData.at(1)}-${partesData.at(0)}T12:00:00Z`);
        
        // Calcula data de Retorno (5 meses = aprox 150 dias)
        const data5Meses = new Date(dataZero);
        data5Meses.setDate(data5Meses.getDate() + 150);

        // Define status
        let status = 'historico_legado';
        if (data5Meses >= hoje) {
            status = 'pendente'; 
        }

        try {
            const parametrosDB = [
                clienteAgenciaId, 
                dadosDoCliente.nome, 
                dadosDoCliente.celular, 
                veiculo, 
                placa,
                dataZero, 
                'retorno_5meses', // MUDEI AQUI
                data5Meses,       //  MUDEI AQUI
                status
            ];
            
            await query(`
                INSERT INTO leads (cliente_id, nome, celular, veiculo, placa, data_saida, tipo_envio, data_agendada, status_envio)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (cliente_id, celular, tipo_envio, data_saida) DO NOTHING;
            `, parametrosDB);
            
            importados++;
        } catch (err) {
            console.error(`❌ Erro ao salvar OS do ID ${idClienteOS}:`, err.message);
        }
    }

    console.log(`\n🏁 Cruzamento Concluído! Total inserido no banco de dados: ${importados}`);
    process.exit(0);
}

processarLegado();