// src/utils/formatador.js

/**
 * Pega um telefone sujo e transforma no JID perfeito para o Baileys
 */
function formatarNumeroBaileys(celularBruto) {
    if (!celularBruto) return null;
    let numeroLimpo = celularBruto.toString().replace(/\D/g, ''); 
    
    // Se não tiver o 55 no início e tiver tamanho de celular, adiciona
    if (numeroLimpo.length >= 10 && !numeroLimpo.startsWith('55')) {
        return '55' + numeroLimpo + '@s.whatsapp.net';
    } else if (numeroLimpo.startsWith('55')) {
        return numeroLimpo + '@s.whatsapp.net';
    }
    return null; 
}

/**
 * Recebe uma linha inteira do CSV e transforma no array do Google Sheets
 */
/**
 * Recebe uma linha inteira do CSV e transforma no array do Google Sheets
 * Seguindo a estrutura: id_cliente, nome, celular, datacadastro, celular_limpo, status, 24horas, 6meses
 */
function formatarLeadParaSheets(linhaCSV) {
    // 1. MAPEAMENTO DAS COLUNAS DO ERP
    const id_cliente = linhaCSV['id_cliente'] || ""; 
    const nome = linhaCSV['nome'] || linhaCSV['NOME'] || "";
    const celularOriginal = linhaCSV['celular'] || "";
    const datacadastro = linhaCSV['datacadastro'] || "";

    // 2. VALIDAÇÃO
    if (!nome || !celularOriginal) return null;

    // 3. FORMATAÇÃO DO NÚMERO (Para a coluna celular_limpo)
    // Usamos sua função formatarNumeroBaileys que já adiciona o @s.whatsapp.net
    const jidFormatado = formatarNumeroBaileys(celularOriginal);
    if (!jidFormatado) return null;

    // 4. RETORNO NA ORDEM DA IMAGEM 2
    return [
        id_cliente,       // Coluna A
        nome.trim(),      // Coluna B
        celularOriginal,  // Coluna C (Formato original: (11) 97274...)
        datacadastro,     // Coluna D
        jidFormatado,     // Coluna E (Formato limpo: 5511972743124@s.whatsapp.net)
        "pendente",       // Coluna F: Status inicial para o bot reconhecer
        "aguardando",     // Coluna G: Referência para o gatilho de 24h
        "aguardando"      // Coluna H: Referência para o gatilho de 6 meses
    ];
}
module.exports = { formatarNumeroBaileys, formatarLeadParaSheets };