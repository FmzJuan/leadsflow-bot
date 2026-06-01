const path = require('path');
const puppeteer = require('puppeteer');
const fs = require('fs');
const csv = require('csv-parser');
const { formatarLeadParaSheets, limparEFormatarCelular } = require('../../utils/formatador');

const { 
    salvarDadosBrutosERP, 
    atualizarAbaClientes, 
    salvarDadosBrutosOS, 
    atualizarAbaHistorico 
} = require('../../Functions/googleSheets');
const { query } = require('../../DataBase/conection');

// --- FUNÇÕES UTILITÁRIAS ---

function obterDatasMesAtual() {
    const hoje = new Date();
    const mes = hoje.getMonth() + 1; 
    const ano = hoje.getFullYear();
    
    const primeiroDia = `01/${mes}/${ano}`;
    const ultimoDiaMes = new Date(ano, mes, 0).getDate();
    const ultimoDia = `${ultimoDiaMes}/${mes}/${ano}`;
    
    return { primeiroDia, ultimoDia };
}

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

function converterDataERP(dataStr) {
    if (!dataStr) return new Date(0);
    const [dia, mes, ano] = dataStr.split('/');
    return new Date(ano, mes - 1, dia);
}

// --- FUNÇÕES DE EXTRAÇÃO (BLOCOS LÓGICOS) ---

async function extrairPlanilhaClientes(page, downloadPath, clienteId, mapaContatos) {
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
    
    await processarCSVClientes(caminhoArquivo, clienteId, mapaContatos);
    
    fs.unlinkSync(caminhoArquivo); 
}

async function extrairPlanilhaOS(page, downloadPath, clienteId, mapaContatos) {
    const { primeiroDia, ultimoDia } = obterDatasMesAtual();
    console.log(`[Tenant ${clienteId}] 🖱️ Acessando OS Entregues (${primeiroDia} a ${ultimoDia})...`);
    
    const urlOS = `https://sistema.oficinaintegrada.com.br/P_LISTAR_OS.ASP?POR=STATUSOS&DATA_TIPO=2&DATA_INICIAL=${primeiroDia}&DATA_FINAL=${ultimoDia}&BUSCA=4`;
    await page.goto(urlOS, { waitUntil: 'networkidle2' });

    console.log(`[Tenant ${clienteId}] ⬇️ Procurando botão de exportação de OS...`);
    
    try {
        const menuAcoes = await page.$('.btn.yellow.dropdown-toggle');
        if (menuAcoes) {
            console.log(`[Tenant ${clienteId}] ⚠️ Menu de ações encontrado. Abrindo...`);
            await page.evaluate(el => el.click(), menuAcoes);
            await new Promise(r => setTimeout(r, 1500)); 
        }

        const clicou = await page.evaluate(() => {
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
        
        await processarCSV_OS(caminhoArquivo, clienteId, mapaContatos);
        fs.unlinkSync(caminhoArquivo);

    } catch (error) {
        const screenshotPath = path.resolve(__dirname, `ERRO_OS_tenant_${clienteId}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        throw new Error(`Falha na tela de OS. Um print da tela foi salvo em: ${screenshotPath} | Detalhe: ${error.message}`);
    }
}

// --- MOTOR PRINCIPAL ---

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

        // 🧠 CRIAMOS O DICIONÁRIO EM MEMÓRIA ISOLADO PARA ESTE TENANT
        const mapaContatos = new Map();

        // === ORQUESTRAÇÃO DE EXTRAÇÕES ===
        await extrairPlanilhaClientes(page, downloadPath, clienteId, mapaContatos);
        await extrairPlanilhaOS(page, downloadPath, clienteId, mapaContatos);
        // =================================

    } catch (error) {
        throw new Error(`[RPA Tenant ${clienteId}] Erro durante execução: ${error.message}`);
    } finally {
        await browser.close();
        if (fs.existsSync(downloadPath)) fs.rmSync(downloadPath, { recursive: true, force: true });
    }
}

// --- PROCESSADORES DE DADOS ---

async function processarCSVClientes(caminhoArquivo, clienteId, mapaContatos) {
    let cabecalho = [];
    const dadosQuentes = []; 
    const dadosFrios = [];  

    const limiteData = new Date();
    limiteData.setMonth(limiteData.getMonth() - 6); 

    return new Promise((resolve, reject) => {
        fs.createReadStream(caminhoArquivo)
            .pipe(csv({ separator: ';' })) 
            .on('headers', (headers) => cabecalho = headers)
            .on('data', (linha) => {
                const leadLimpo = formatarLeadParaSheets(linha); 
                
                if (leadLimpo) {
                    const [dataStr, nome, telefone] = leadLimpo;
                    
                    // 🧠 Alimenta o dicionário [Nome -> Telefone]
                    if (nome && telefone) {
                        mapaContatos.set(nome.trim().toUpperCase(), telefone);
                    }

                    const dataServico = converterDataERP(linha['DATA_CADASTRO'] || linha['ULTIMA_VISITA']);
                    if (dataServico >= limiteData) {
                        dadosQuentes.push(leadLimpo); 
                    }
                    dadosFrios.push(leadLimpo); 
                }
            })
            .on('end', async () => {
                try {
                    // Atualiza as abas visuais do Sheets
                    if (dadosQuentes.length > 0) {
                        await atualizarAbaClientes(dadosQuentes, clienteId); 
                    }
                    if (dadosFrios.length > 0) {
                        await atualizarAbaHistorico(dadosFrios, clienteId); 
                    }
                    
                    // ⚠️ Seguindo a recomendação da análise: NÃO chamamos o salvarNoPostgres aqui.
                    resolve();
                } catch (e) { reject(e); }
            });
    });
}

async function processarCSV_OS(caminhoArquivo, clienteId, mapaContatos) {
    let cabecalho = [];
    const linhasBrutas = [];
    const dadosCruzadosParaBanco = []; // Array unificado para o BD

    return new Promise((resolve, reject) => {
        fs.createReadStream(caminhoArquivo)
            .pipe(csv({ separator: ';' })) 
            .on('headers', (headers) => cabecalho = headers)
            .on('data', (linha) => {
                linhasBrutas.push(cabecalho.map(col => linha[col]));

                // --- 🧠 O PROCV AUTOMÁTICO ---
                const clienteRaw = linha['Cliente'] || linha['CLIENTE'] || '';
                const partes = clienteRaw.split(' - ');
                const nomeOS = partes.length > 1 ? partes.slice(1).join(' - ').trim().toUpperCase() : clienteRaw.trim().toUpperCase();

                const dataSaida = linha['Saida'] || linha['SAIDA'];
                const veiculo = `${linha['Marca'] || ''} ${linha['Modelo'] || ''}`.trim();
                const placa = linha['Placa'] || linha['PLACA'] || '';

                // Busca o telefone no dicionário
                const telefoneEncontrado = mapaContatos.get(nomeOS);

                // Se achou o telefone e tem a data exata da OS, prepara para o banco
                if (telefoneEncontrado && dataSaida) {
                dadosCruzadosParaBanco.push([dataSaida, nomeOS, telefoneEncontrado, veiculo, placa]);                }
            })
            .on('end', async () => {
                try {
                    // Salva a aba visual de OS no Sheets
                    if (linhasBrutas.length > 0) {
                        await salvarDadosBrutosOS(cabecalho, linhasBrutas, clienteId);
                    }

                    // 🚀 O ÚNICO LUGAR QUE SALVA NO BANCO: Inserção com dados cruzados e completos!
                    if (dadosCruzadosParaBanco.length > 0) {
                        await salvarNoPostgres(dadosCruzadosParaBanco, clienteId);
                    }

                    resolve();
                } catch (e) { reject(e); }
            }).on('error', reject);
    });
}

// --- FUNÇÃO DE BANCO DE DADOS INTELIGENTE ---

async function salvarNoPostgres(dados, clienteId) {
    console.log(`[Database] Persistindo ${dados.length} registros no histórico e agendando Leads do Cliente ${clienteId}...`);
    
    for (const linha of dados) {
        // Agora sabemos que a posição '2' da linha (telefone) já está limpa 
        // devido ao processamento anterior, mas vamos garantir:
        const [dataStr, nome, telefoneOriginal, veiculoInfo, placaInfo] = linha;
        
        // Aplica a limpeza final (segurança extra)
        const telefone = limparEFormatarCelular(telefoneOriginal);
        
        const veiculo = veiculoInfo || 'Não informado';
        const placa = placaInfo || 'Não informada';

        let dataSaida;
        if (dataStr.includes('/')) {
            const [dia, mes, ano] = dataStr.split('/');
            dataSaida = new Date(ano, mes - 1, dia);
        } else {
            dataSaida = new Date(dataStr);
        }

        // IMPORTANTE: Use a variável 'telefone' já limpa aqui:
        if (isNaN(dataSaida.getTime()) || !telefone) continue;

        // Salva no arquivo morto (Histórico Geral)
        await query(`
            INSERT INTO historico_clientes (cliente_id, nome, celular, ultima_visita)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (cliente_id, celular) DO UPDATE SET ultima_visita = $4
        `, [clienteId, nome, telefone, dataSaida]);

        // O CÉREBRO: Lógica de 24h ou 6 Meses baseada na Data de Saída Real da OS
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);

        let tipoEnvio = 'retorno_6meses';
        let dataAgendada = new Date(dataSaida);
        dataAgendada.setMonth(dataAgendada.getMonth() + 6);

        const diffDias = Math.floor((hoje.getTime() - dataSaida.getTime()) / (1000 * 3600 * 24));
        
        if (diffDias <= 5 && diffDias >= 0) { 
            tipoEnvio = 'pos_venda_24h';
            dataAgendada = new Date(dataSaida);
            dataAgendada.setDate(dataAgendada.getDate() + 1); 
        }

        // Insere na tabela LEADS (O escudo WHERE NOT EXISTS impede de inserir a mesma OS duplicada)
        // 4. Insere na tabela LEADS (Com os tipos de dados definidos para o PostgreSQL)
        await query(`
            INSERT INTO leads (cliente_id, nome, celular, veiculo, placa, data_saida, data_agendada, tipo_envio, status_envio)
            SELECT $1::INTEGER, $2::VARCHAR, $3::VARCHAR, $4::VARCHAR, $5::VARCHAR, $6::DATE, $7::TIMESTAMP, $8::VARCHAR, 'pendente'
            WHERE NOT EXISTS (
                SELECT 1 FROM leads 
                WHERE celular = $3::VARCHAR AND data_saida = $6::DATE AND tipo_envio = $8::VARCHAR
            )
        `, [clienteId, nome, telefone, veiculo, placa, dataSaida, dataAgendada, tipoEnvio]);
    }
}

module.exports = { extrairDadosDoERP };