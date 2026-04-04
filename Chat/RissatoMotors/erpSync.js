const path = require('path');
const puppeteer = require('puppeteer');
const fs = require('fs');
const csv = require('csv-parser');

const { formatarLeadParaSheets } = require('../../utils/formatador');

const { 
    salvarDadosBrutosERP, 
    atualizarAbaClientes, 
    salvarDadosBrutosOS, 
    atualizarAbaHistorico // <-- Adicione esta
} = require('../../Functions/googleSheets');
const { query } = require('../../DataBase/conection');
// --- FUNÇÕES UTILITÁRIAS ---

/**
 * Retorna as datas de início e fim do mês atual no formato DD/M/YYYY
 */
function obterDatasMesAtual() {
    const hoje = new Date();
    const mes = hoje.getMonth() + 1; // getMonth é zero-based
    const ano = hoje.getFullYear();
    
    const primeiroDia = `01/${mes}/${ano}`;
    const ultimoDiaMes = new Date(ano, mes, 0).getDate();
    const ultimoDia = `${ultimoDiaMes}/${mes}/${ano}`;
    
    return { primeiroDia, ultimoDia };
}

/**
 * Aguarda o download do arquivo na pasta especificada.
 */
async function aguardarDownload(downloadPath, timeoutSegundos = 45) {
    for (let i = 0; i < timeoutSegundos; i++) {
        const arquivos = fs.readdirSync(downloadPath);
        const arquivo = arquivos.find(f => f.endsWith('.csv') || f.endsWith('.xls'));
        
        if (arquivo && !arquivo.endsWith('.crdownload')) {
            return path.join(downloadPath, arquivo);
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error(`Timeout de ${timeoutSegundos}s aguardando download.`);
}

// --- FUNÇÕES DE EXTRAÇÃO (BLOCOS LÓGICOS) ---

async function extrairPlanilhaClientes(page, downloadPath, clienteId) {
    console.log(`[Tenant ${clienteId}] 🖱️ Acessando lista de Clientes...`);
    await page.goto('https://sistema.oficinaintegrada.com.br/P_LISTAR_CLIENTES.ASP', { waitUntil: 'networkidle2' });

    await page.waitForSelector('.btn.yellow.dropdown-toggle', { visible: true });
    await page.click('.btn.yellow.dropdown-toggle');
    await new Promise(r => setTimeout(r, 2000));
    
    try {
        await page.waitForSelector('a[onclick="exportarCSV();"]', { visible: true, timeout: 5000 });
    } catch (e) {
        await page.evaluate(() => {
            const btn = document.querySelector('.btn.yellow.dropdown-toggle');
            if (btn) btn.click();
        });
        await new Promise(r => setTimeout(r, 2000));
    }

    const clicou = await page.evaluate(() => {
        const link = document.querySelector('a[onclick="exportarCSV();"]');
        if (link) { link.click(); return true; }
        return false;
    });

    if (!clicou) throw new Error("Botão 'exportarCSV' não encontrado na tela de Clientes.");

    console.log(`[Tenant ${clienteId}] ⏳ Aguardando download de Clientes...`);
    const caminhoArquivo = await aguardarDownload(downloadPath);
    
    await processarCSVClientes(caminhoArquivo, clienteId);
    
    // Limpa a pasta para a próxima extração não pegar o arquivo errado
    fs.unlinkSync(caminhoArquivo); 
}

async function extrairPlanilhaOS(page, downloadPath, clienteId) {
    const { primeiroDia, ultimoDia } = obterDatasMesAtual();
    console.log(`[Tenant ${clienteId}] 🖱️ Acessando OS Entregues (${primeiroDia} a ${ultimoDia})...`);
    
    const urlOS = `https://sistema.oficinaintegrada.com.br/P_LISTAR_OS.ASP?POR=STATUSOS&DATA_TIPO=2&DATA_INICIAL=${primeiroDia}&DATA_FINAL=${ultimoDia}&BUSCA=4`;
    await page.goto(urlOS, { waitUntil: 'networkidle2' });

    console.log(`[Tenant ${clienteId}] ⬇️ Procurando botão de exportação de OS...`);
    
    try {
        // 1. Tenta ver se existe um botão de menu (dropdown) e clica nele por garantia
        const menuAcoes = await page.$('.btn.yellow.dropdown-toggle');
        if (menuAcoes) {
            console.log(`[Tenant ${clienteId}] ⚠️ Menu de ações encontrado. Abrindo...`);
            await page.evaluate(el => el.click(), menuAcoes);
            await new Promise(r => setTimeout(r, 1500)); // Espera a animação do menu
        }

        // 2. Dispara o clique no botão usando evaluate (ignora se ele parece "invisível" pro navegador)
        const clicou = await page.evaluate(() => {
            // Procura pelo ID ou por qualquer link que tenha o exportarCSV no onclick
            const link = document.querySelector('#exportcsv') || document.querySelector('a[onclick*="exportarCSV"]');
            if (link) { 
                link.click(); 
                return true; 
            }
            return false;
        });

        if (!clicou) {
            throw new Error("Botão não foi encontrado no HTML da página.");
        }

        console.log(`[Tenant ${clienteId}] ⏳ Aguardando download de OS...`);
        const caminhoArquivo = await aguardarDownload(downloadPath);
        
        await processarCSV_OS(caminhoArquivo, clienteId);
        fs.unlinkSync(caminhoArquivo);

    } catch (error) {
        // 🔥 JOGADA DE SÊNIOR: Tira um print da tela para vermos o que deu errado!
        const screenshotPath = path.resolve(__dirname, `ERRO_OS_tenant_${clienteId}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        throw new Error(`Falha na tela de OS. Um print da tela foi salvo em: ${screenshotPath} | Detalhe: ${error.message}`);
    }
}

// --- MOTOR PRINCIPAL ---

/**
 * Extrai dados do ERP Oficina Integrada e sincroniza com o Google Sheets.
 */
async function extrairDadosDoERP(clienteId, credenciaisERP) {
    if (!clienteId || !credenciaisERP || !credenciaisERP.chave || !credenciaisERP.usuario || !credenciaisERP.senha) {
        throw new Error(`[RPA Tenant ${clienteId}] Falha de Segurança: Contexto ou credenciais ausentes.`);
    }

    const timestamp = Date.now();
    const downloadPath = path.resolve(__dirname, `downloads/tenant_${clienteId}_${timestamp}`);
    
    if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath, { recursive: true });

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized', '--disable-dev-shm-usage'],
        defaultViewport: null
    });

    try {
        const page = await browser.newPage();
        
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log(`[Tenant ${clienteId}] 🔑 Realizando Login...`);
        await page.goto('https://sistema.oficinaintegrada.com.br/login.asp', { waitUntil: 'networkidle2' });
        await page.type('#chave', credenciaisERP.chave); 
        await page.type('#usuario', credenciaisERP.usuario);       
        await page.type('#senha', credenciaisERP.senha);         
        await Promise.all([
            page.click('#btnLogar'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }) 
        ]);

        // === ORQUESTRAÇÃO DE EXTRAÇÕES ===
        await extrairPlanilhaClientes(page, downloadPath, clienteId);
        
        await extrairPlanilhaOS(page, downloadPath, clienteId);
        // =================================

    } catch (error) {
        throw new Error(`[RPA Tenant ${clienteId}] Erro durante execução: ${error.message}`);
    } finally {
        await browser.close();
        if (fs.existsSync(downloadPath)) fs.rmSync(downloadPath, { recursive: true, force: true });
    }
}

// --- PROCESSADORES DE DADOS ---

async function processarCSVClientes(caminhoArquivo, clienteId) {
    let cabecalho = [];
    const dadosQuentes = []; // Últimos 6 meses (Para Pós-Venda)
    const dadosFrios = [];   // Histórico completo tratado

    const limiteData = new Date();
    limiteData.setMonth(limiteData.getMonth() - 6); // Define a régua de 6 meses atrás

    return new Promise((resolve, reject) => {
        fs.createReadStream(caminhoArquivo)
            .pipe(csv({ separator: ';' })) 
            .on('headers', (headers) => cabecalho = headers)
            .on('data', (linha) => {
                // 1. Tratamento e Formatação
                const leadLimpo = formatarLeadParaSheets(linha); // Sua função utilitária
                
                if (leadLimpo) {
                    // leadLimpo costuma ser um array [Data, Nome, Telefone...]
                    // Precisamos converter a data do CSV para comparar
                    // Exemplo: assumindo que a data está em linha['Data'] ou no seu formato
                    const dataServico = converterDataERP(linha['DATA_CADASTRO'] || linha['ULTIMA_VISITA']);

                    // 2. Classificação de Temperatura do Dado
                    if (dataServico >= limiteData) {
                        dadosQuentes.push(leadLimpo); // Vai para a aba de Pós-Venda Ativo
                    }
                    dadosFrios.push(leadLimpo); // Vai para a aba de Histórico Geral
                }
            })
            .on('end', async () => {
                try {
                    // 3. Envio para as abas corretas (Isolamento de Dados)
                    if (dadosQuentes.length > 0) {
                        await atualizarAbaClientes(dadosQuentes, clienteId); // Pós-Venda
                    }
                    
                    if (dadosFrios.length > 0) {
                        await atualizarAbaHistorico(dadosFrios, clienteId); // Histórico Geral (Nova função)
                    }

                    // 4. Persistência no Banco (Dados Frios para Relatórios)
                    await salvarNoPostgres(dadosFrios, clienteId);

                    resolve();
                } catch (e) { reject(e); }
            });
    });
}

// Função auxiliar para entender a data do ERP
function converterDataERP(dataStr) {
    if (!dataStr) return new Date(0);
    // Ajuste o split conforme o formato do seu CSV (ex: 01/04/2026)
    const [dia, mes, ano] = dataStr.split('/');
    return new Date(ano, mes - 1, dia);
}
async function salvarNoPostgres(dados, clienteId) {
    console.log(`[Database] Persistindo ${dados.length} registros no histórico do Cliente ${clienteId}...`);
    for (const linha of dados) {
        // Exemplo de query para evitar duplicados (ajuste as colunas conforme sua tabela)
        const [data, nome, telefone] = linha;
        await query(`
            INSERT INTO historico_clientes (cliente_id, nome, celular, ultima_visita)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (cliente_id, celular) DO UPDATE SET ultima_visita = $4
        `, [clienteId, nome, telefone, data]);
    }
}

async function processarCSV_OS(caminhoArquivo, clienteId) {
    let cabecalho = [];
    const linhasBrutas = [];

    return new Promise((resolve, reject) => {
        fs.createReadStream(caminhoArquivo)
            .pipe(csv({ separator: ';' })) 
            .on('headers', (headers) => cabecalho = headers)
            .on('data', (linha) => {
                linhasBrutas.push(cabecalho.map(col => linha[col]));
            })
            .on('end', async () => {
                try {
                    // Chama a nova função do Google Sheets
                    if (linhasBrutas.length > 0) {
                        await salvarDadosBrutosOS(cabecalho, linhasBrutas, clienteId);
                    }
                    resolve();
                } catch (e) { reject(e); }
            }).on('error', reject);
    });
}

module.exports = { extrairDadosDoERP };