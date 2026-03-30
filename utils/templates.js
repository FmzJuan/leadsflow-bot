const templates = {
    SAUDACAO_24H: (nome) => `Olá ${nome}! Tudo bem? Gostamos muito de ter você aqui na Rissato Motors ontem. Como foi sua experiência com o serviço?`,
    REVISAO_6M: (nome, veiculo) => `Oi ${nome}, aqui é da Rissato Motors! Notamos que faz 6 meses que você revisou seu ${veiculo}. Que tal agendar uma nova inspeção?`,
    ERRO_SISTEMA: "⚠️ Ops! Tivemos um problema ao processar seu pedido. Mas já estamos verificando!"
};

module.exports = templates;