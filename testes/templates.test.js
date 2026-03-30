const templates = require('../utils/templates');

test('Deve gerar o texto de revisão de 6 meses corretamente', () => {
    const texto = templates.REVISAO_6M('Juan', 'Honda Civic');
    expect(texto).toContain('Juan');
    expect(texto).toContain('Honda Civic');
    expect(texto).toContain('6 meses');
});