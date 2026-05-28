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
 * Normaliza um JID do WhatsApp para garantir consistência, adicionando o nono dígito se necessário.
 * @param {string} jid - O JID original (ex: 551188887777@s.whatsapp.net ou 5511988887777@s.whatsapp.net).
 * @returns {string} O JID normalizado.
 */
/**
 * Normaliza um número de telefone, adicionando o 9º dígito se necessário e removendo caracteres não numéricos.
 * @param {string} numeroBruto - O número de telefone bruto.
 * @returns {string} O número de telefone normalizado (apenas dígitos).
 */
function normalizarNumero(numeroBruto) {
  const limpo = numeroBruto.replace(/\D/g, \'\');
  let normalizado = limpo;
  if (limpo.startsWith(\'55\') && limpo.length === 12) {
    normalizado = limpo.slice(0, 4) + \'9\' + limpo.slice(4);
  }
  return normalizado;
}

/**
 * Normaliza um JID do WhatsApp para garantir consistência, adicionando o nono dígito se necessário.
 * @param {string} jid - O JID original (ex: 551188887777@s.whatsapp.net ou 5511988887777@s.whatsapp.net).
 * @returns {string} O JID normalizado.
 */
function normalizarJid(jid) {
  // Remove tudo que não é número, mantém o @s.whatsapp.net
  const [numero, dominio] = jid.split('@');
  const limpo = numero.replace(/\D/g, '');
  
  // Garante que números BR com DDD tenham o nono dígito
  // Ex: 5511988887777 (13 dígitos) = formato correto
  // Ex: 551188887777 (12 dígitos) = falta o nono, adiciona
  let normalizado = limpo;
  if (limpo.startsWith('55') && limpo.length === 12) {
    normalizado = limpo.slice(0, 4) + '9' + limpo.slice(4);
  }
  
  return `${normalizado}@${dominio}`;
}

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
module.exports = { formatarNumeroBaileys, normalizarJid, normalizarNumero, formatarLeadParaSheets };
