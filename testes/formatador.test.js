const { formatarNumeroBaileys, formatarLeadParaSheets } = require('../utils/formatador');

describe('Testes de Formatação LeadsFlow', () => {
    
    test('Deve formatar número para padrão Baileys (JID)', () => {
        const numeroSujo = "(11) 97274-3124";
        const resultado = formatarNumeroBaileys(numeroSujo);
        expect(resultado).toBe('5511972743124@s.whatsapp.net');
    });

    test('Deve transformar linha do CSV em Array para Google Sheets', () => {
        const linhaSimulada = {
            nome: 'Julia Rissato',
            celular: '11999998888',
            datacadastro: '25/03/2026',
            veiculo: 'Civic'
        };

        const resultado = formatarLeadParaSheets(linhaSimulada);
        
        expect(resultado).toHaveLength(8); // Verifica se tem as 8 colunas (A a H)
        expect(resultado[1]).toBe('Julia Rissato');
        expect(resultado[2]).toBe('11999998888'); // Celular original
        expect(resultado[4]).toBe('5511999998888@s.whatsapp.net'); // JID limpo
        expect(resultado[5]).toBe('pendente'); // Status inicial
    });
});