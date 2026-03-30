// Simulação do motor de envio para o Jest
const enviarMensagemMock = jest.fn((numero, texto) => {
    if (!numero.includes('@s.whatsapp.net')) return { success: false, error: 'JID Inválido' };
    return { success: true, messageId: 'ABC123XYZ' };
});

describe('Módulo de Mensageria (WhatsApp Mock)', () => {
    test('Deve validar se a mensagem está pronta para envio', async () => {
        const payload = {
            numero: '5511972743124@s.whatsapp.net',
            texto: 'Olá Julia, sua revisão de 6 meses está chegando!'
        };

        const resultado = await enviarMensagemMock(payload.numero, payload.texto);
        
        expect(resultado.success).toBe(true);
        expect(enviarMensagemMock).toHaveBeenCalledWith(payload.numero, payload.texto);
    });

    test('Deve falhar se o número não estiver formatado corretamente', async () => {
        const resultado = await enviarMensagemMock('11972743124', 'Erro esperado');
        expect(resultado.success).toBe(false);
    });
});