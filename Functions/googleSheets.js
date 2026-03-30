const { google } = require('googleapis');
const path = require('path');
// 1. IMPORTAMOS O BANCO DE DADOS PARA BUSCAR O ID DA PLANILHA DO CLIENTE
const { query } = require('../DataBase/conection');

// 2. Configura a autenticação (Permanece igual, usa a mesma credencial global)
const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, '../credentials.json'), 
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

const MODO_SIMULACAO = process.env.MODO_SIMULACAO !== 'false'; 

/**
 * [NOVO] Função Auxiliar: Busca o ID da planilha do cliente no Banco de Dados
 */
async function getSheetId(clienteId) {
    try {
        const result = await query('SELECT google_sheets_id FROM clientes_config WHERE id = $1', [clienteId]);
        if (result.rows.length > 0 && result.rows[0].google_sheets_id) {
            return result.rows[0].google_sheets_id;
        }
    } catch (error) {
        console.error(`❌ Erro ao buscar planilha no banco para o cliente ${clienteId}:`, error);
    }
    
    // Fallback de segurança: Se o banco estiver vazio, tenta usar o do .env
    console.log(`⚠️ [Aviso] Cliente ${clienteId} sem planilha no banco. Usando SHEET_ID do .env...`);
    return process.env.SHEET_ID;
}

/**
 * Função Auxiliar para Log de Simulação
 */
function logSimulacao(cliente, mensagem) {
    console.log("-----------------------------------------");
    console.log(`[SIMULAÇÃO DE ENVIO]`);
    console.log(`PARA: ${cliente.nome} (${cliente.numeroJid})`);
    console.log(`DATA CADASTRO: ${cliente.dataCadastro}`);
    console.log(`MENSAGEM: "${mensagem}"`);
    console.log("-----------------------------------------");
}

/**
 * Executa a campanha de pós-venda (AGORA RECEBE clienteId)
 */
async function processarCampanhaPosVenda(sock, clienteId) { 
    // Passa o clienteId para saber qual planilha ler
    const clientes = await obterClientesPosVenda(clienteId);

    if (clientes.length === 0) {
        console.log(`⚠️ Nenhum cliente autorizado encontrado para disparo (Cliente ID: ${clienteId}).`);
        return;
    }
    
    for (const cliente of clientes) {
        const mensagem = `Olá ${cliente.nome}, tudo bem? Aqui é da oficina. Notamos que seu último serviço foi em ${cliente.dataCadastro}. Gostaria de agendar uma revisão?`;

        if (MODO_SIMULACAO) {
            logSimulacao(cliente, mensagem);
        } else {
            console.log(`🚀 [DISPARO REAL - Cliente ID: ${clienteId}] Enviando para: ${cliente.nome} (${cliente.numeroJid})`);
            
            await sock.sendMessage(cliente.numeroJid, { text: mensagem });
            
            // Delay anti-ban (30 segundos)
            await new Promise(resolve => setTimeout(resolve, 30000));
        }
    }
    
    if (MODO_SIMULACAO) {
        console.log(`\n✅ Simulação concluída! ${clientes.length} mensagens processadas.`);
    } else {
        console.log(`\n✅ Envio real concluído para ${clientes.length} clientes da oficina.`);
    }
}

/**
 * Limpa e formata o número para o padrão do Baileys
 */
function formatarNumero(celularBruto) {
    if (!celularBruto) return null;
    let numeroLimpo = celularBruto.toString().replace(/\D/g, ''); 
    
    if (numeroLimpo.length >= 12 && numeroLimpo.startsWith('55')) {
        return numeroLimpo;
    } else {
        return '55' + numeroLimpo;
    }
}

/**
 * Salva os dados do cliente na planilha (AGORA RECEBE clienteId)
 */
async function salvarNoSheets(dados, clienteId) {
    try {
        const spreadsheetId = await getSheetId(clienteId);
        
        if (!spreadsheetId) {
            console.error(`❌ ERRO: Nenhuma planilha configurada para o Cliente ${clienteId}`);
            return;
        }

        let values;
        if (Array.isArray(dados)) {
            values = [dados];
        } else {
            const { nome, telefone, servico = 'Oficina' } = dados;
            values = [[new Date().toLocaleString(), nome, telefone, servico, 'Pendente']];
        }

        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Leads_PreVenda!A2', 
            valueInputOption: 'RAW',
            resource: { values },
        });

        console.log(`✅ [Sheets] Lead salvo na planilha do Cliente ${clienteId}.`);
    } catch (error) {
        console.error(`❌ Erro ao salvar no Google Sheets (Cliente ${clienteId}):`, error.message);
    }
}

/**
 * Lê a planilha para a campanha de pós-venda (AGORA RECEBE clienteId)
 */
async function obterClientesPosVenda(clienteId) {
    try {
        const spreadsheetId = await getSheetId(clienteId);
        if (!spreadsheetId) return [];
        
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Base_PosVenda!A2:D', 
        });

        const linhas = response.data.values;
        if (!linhas || linhas.length === 0) {
            console.log(`⚠️ Aba 'Base_PosVenda' está vazia na planilha do Cliente ${clienteId}.`);
            return [];
        }

        let clientesParaDisparo = [];
        const numerosPermitidosString = process.env.NUMEROS_PERMITIDOS || '';
        const numerosPermitidos = numerosPermitidosString
            .split(',')
            .map(num => num.trim())
            .filter(num => num.length > 0); 

        const travaAtiva = numerosPermitidos.length > 0;

        linhas.forEach(linha => {
            const nome = linha[1] || 'Cliente';
            const celularBruto = linha[2];
            const dataCadastro = linha[3] || 'recentemente';

            if (celularBruto) {
                let numeroPronto = formatarNumero(celularBruto);
                
                if (!travaAtiva || numerosPermitidos.includes(numeroPronto)) {
                    clientesParaDisparo.push({
                        nome: nome,
                        numeroJid: numeroPronto + '@s.whatsapp.net',
                        dataCadastro: dataCadastro
                    });
                } else {
                    console.log(`[Segurança] Bloqueado: ${nome} (${numeroPronto}) não está na whitelist.`);
                }
            }
        });

        const statusModo = MODO_SIMULACAO ? 'SIMULAÇÃO' : 'DISPARO REAL';
        console.log(`✅ [Sheets] ${clientesParaDisparo.length} alvos carregados do Cliente ${clienteId}. MODO: ${statusModo}.`);
        
        return clientesParaDisparo;
    } catch (error) {
        console.error(`❌ Erro ao ler aba Clientes (Cliente ${clienteId}):`, error.message);
        return [];
    }
}

/**EXPORTAR_CSV (1)
 * Salva o CSV inteiro e bruto na aba "Dados_ERP" (AGORA RECEBE clienteId)
 */
async function salvarDadosBrutosERP(cabecalho, linhas, clienteId) {
    try {
        const spreadsheetId = await getSheetId(clienteId);
        if (!spreadsheetId) return;
        
        await sheets.spreadsheets.values.clear({ 
            spreadsheetId, 
            range: 'ERP_Clientes!A:ZZ' 
        });

        const values = [cabecalho, ...linhas];

        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'ERP_Clientes!A1',
            valueInputOption: 'USER_ENTERED',
            resource: { values },
        });

        console.log(`✅ [Sheets] Dados brutos (${linhas.length} linhas) atualizados para o Cliente ${clienteId}.`);
    } catch (error) {
        console.error(`❌ Erro ao salvar dados ERP no Sheets (Cliente ${clienteId}):`, error.message);
    }
}

/**
 * Envia os dados filtrados para a aba "Clientes" (AGORA RECEBE clienteId)
 */
async function atualizarAbaClientes(dadosLimpos, clienteId) {
    try {
        const spreadsheetId = await getSheetId(clienteId);
        if (!spreadsheetId) return;
        
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Base_PosVenda!A2', 
            valueInputOption: 'USER_ENTERED',
            resource: { values: dadosLimpos },
        });

        console.log(`✅ [Sheets] ${dadosLimpos.length} clientes adicionados à aba Clientes (Cliente ${clienteId}).`);
    } catch (error) {
        console.error(`❌ Erro ao salvar clientes ERP no Sheets (Cliente ${clienteId}):`, error.message);
    }
}

module.exports = { 
    salvarNoSheets, 
    obterClientesPosVenda, 
    processarCampanhaPosVenda,
    salvarDadosBrutosERP, 
    atualizarAbaClientes  
};