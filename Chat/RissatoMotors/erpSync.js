// Chat/RissatoMotors/erpSync.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const puppeteer = require('puppeteer');
const fs = require('fs');
const csv = require('csv-parser');

const { formatarLeadParaSheets } = require('../../utils/formatador');
const { salvarDadosBrutosERP, atualizarAbaClientes } = require('../../Functions/googleSheets');

const ERP_CHAVE = process.env.ERP_CHAVE; 
const ERP_USER = process.env.ERP_USER;
const ERP_PASS = process.env.ERP_PASS;

async function extrairDadosDoERP() {
    console.log("🤖 [RPA] Iniciando extração de dados...");

    const browser = await puppeteer.launch({
        headless: "new", // Melhor suporte a downloads automáticos em servidores VPS
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--start-maximized',
            '--disable-dev-shm-usage' // Essencial para evitar crash de memória em VPS
        ],
        defaultViewport: null
    });

    const page = await browser.newPage();
    
    // --- CONFIGURAÇÃO DE DOWNLOAD (CAMINHO ABSOLUTO) ---
    const downloadPath = path.resolve(__dirname, 'downloads');
    if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath, { recursive: true });
    }

    // Limpa arquivos antigos para não processar dado errado (sujeira de execuções anteriores)
    const files = fs.readdirSync(downloadPath);
    for (const file of files) {
        fs.unlinkSync(path.join(downloadPath, file));
    }

    // Protocolo CDP para forçar permissão de download no modo headless
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadPath, 
    });

    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // --- LOGIN ---
        console.log("➡️ Acessando login...");
        await page.goto('https://sistema.oficinaintegrada.com.br/login.asp', { waitUntil: 'networkidle2' });

        await page.type('#chave', ERP_CHAVE); 
        await page.type('#usuario', ERP_USER);       
        await page.type('#senha', ERP_PASS);         

        console.log("🔑 Fazendo login...");
        await Promise.all([
            page.click('#btnLogar'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }) 
        ]);

        // --- NAVEGAÇÃO DIRETA ---
        console.log("🖱️ Navegando até Clientes...");
        await page.goto('https://sistema.oficinaintegrada.com.br/P_LISTAR_CLIENTES.ASP', { waitUntil: 'networkidle2' });

        // --- EXPORTAÇÃO BLINDADA (Tratamento de Timeout) ---
        console.log("⬇️ Solicitando exportação...");
        await page.waitForSelector('.btn.yellow.dropdown-toggle', { visible: true });
        
        // 1º Clique: Tenta abrir o menu normalmente
        await page.click('.btn.yellow.dropdown-toggle');
        await new Promise(r => setTimeout(r, 2000)); // Aguarda animação do dropdown
        
        console.log("🖱️ Tentando encontrar o botão de CSV...");
        try {
            await page.waitForSelector('a[onclick="exportarCSV();"]', { visible: true, timeout: 10000 });
        } catch (e) {
            console.log("⚠️ Menu não abriu no clique normal. Forçando via JS...");
            // Retentativa: Força o clique no menu via evaluate
            await page.evaluate(() => {
                const btn = document.querySelector('.btn.yellow.dropdown-toggle');
                if (btn) btn.click();
            });
            await new Promise(r => setTimeout(r, 2000));
        }

        // Clique final no CSV usando evaluate. Isso garante a execução mesmo se o elemento estiver sobreposto ou "invisível" para o mouse virtual.
        console.log("🚀 Disparando comando de exportação CSV...");
        const csvClicado = await page.evaluate(() => {
            const link = document.querySelector('a[onclick="exportarCSV();"]');
            if (link) {
                link.click();
                return true;
            }
            return false;
        });

        if (!csvClicado) {
            throw new Error("Não foi possível encontrar o botão 'exportarCSV' na página.");
        }

        // --- VERIFICAÇÃO DE DOWNLOAD ---
        console.log("⏳ Aguardando o arquivo aparecer na pasta...");
        let arquivoBaixado = null;
        for (let i = 0; i < 45; i++) { // Tenta por 45 segundos (ajustado para servidores mais lentos)
            const arquivosNaPasta = fs.readdirSync(downloadPath);
            arquivoBaixado = arquivosNaPasta.find(f => f.endsWith('.csv') || f.endsWith('.xls'));
            
            // Aceita o arquivo apenas se ele não for um arquivo temporário de download do Chrome
            if (arquivoBaixado && !arquivoBaixado.endsWith('.crdownload')) {
                console.log(`✅ Arquivo pronto: ${arquivoBaixado}`);
                break;
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        if (!arquivoBaixado) throw new Error("O arquivo não foi gerado na pasta de downloads dentro do tempo limite.");

        // --- PROCESSAMENTO ---
        await processarCSVBaixado(path.join(downloadPath, arquivoBaixado));

    } catch (error) {
        console.error("❌ [RPA] Erro:", error);
    } finally {
        await browser.close();
        console.log("🛑 Navegador fechado.");
    }
}

async function processarCSVBaixado(caminhoArquivo) {
    console.log(`📊 Processando: ${caminhoArquivo}`);

    // 👇 DEFINA O ID DA RISSATO MOTORS NO SEU BANCO DE DADOS AQUI
    const CLIENTE_ID_BANCO = 1; // Troque para o ID correto se não for 1

    let cabecalho = [];
    const linhasBrutas = [];
    const dadosParaOSheets = [];

    return new Promise((resolve, reject) => {
        fs.createReadStream(caminhoArquivo)
            .pipe(csv({ separator: ';' })) 
            .on('headers', (headers) => cabecalho = headers)
            .on('data', (linha) => {
                const linhaArray = cabecalho.map(col => linha[col]);
                linhasBrutas.push(linhaArray);

                const leadLimpo = formatarLeadParaSheets(linha);
                if (leadLimpo) dadosParaOSheets.push(leadLimpo);
            })
            .on('end', async () => {
                try {
                    // Passando CLIENTE_ID_BANCO como o último parâmetro para as funções
                    if (linhasBrutas.length > 0) {
                        await salvarDadosBrutosERP(cabecalho, linhasBrutas, CLIENTE_ID_BANCO);
                    }
                    if (dadosParaOSheets.length > 0) {
                        await atualizarAbaClientes(dadosParaOSheets, CLIENTE_ID_BANCO);
                    }
                    
                    // Apaga o arquivo CSV após enviar para o Google Sheets (planilha)
                    fs.unlinkSync(caminhoArquivo); 
                    console.log(`✅ [RPA] Sucesso! Dados sincronizados para o cliente ID: ${CLIENTE_ID_BANCO}`);
                    resolve();
                } catch (e) { reject(e); }
            });
    });
}

if (require.main === module) {
    extrairDadosDoERP();
}

module.exports = { extrairDadosDoERP };