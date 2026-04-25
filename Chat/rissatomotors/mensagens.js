module.exports = {
    mensagens24h: [ 
        "Olá, {nome}! Como vai?\n\nAqui é da Rissato Motors. Queremos saber como foi a sua experiência com a gente após o serviço realizado em seu veículo: *{model_car}*, placa: *{car_plate}*.\n\nSua opinião é essencial para continuarmos evoluindo e entregando sempre mais qualidade.\n\nSe puder, nos deixe uma nota de 0 a 10.\n\nAgradecemos pelo seu tempo!",   
        
        "Olá, {nome}! Como vai?\nAqui é da Rissato Motors. Queremos saber como foi a sua experiência com a gente após o serviço realizado em seu veículo: *{model_car}* (Placa: *{car_plate}*).\nSua opinião é essencial para continuarmos evoluindo e entregando sempre mais qualidade.\nSe puder, nos deixe uma nota de 0 a 10.\n\nAgradecemos pelo seu tempo!",
        
        "Olá, {nome}! Espero que esteja bem!\nAqui é da Rissato Motors. De 0 a 10, como foi sua experiência com a gente após o serviço no seu *{model_car}* (Placa: *{car_plate}*)?\nSe tiver algo que não ficou 100%, pode nos falar, queremos melhorar pra você!\n\nGrato pelo seu tempo!"
    ],
    
    // Atualizado para 5 meses com modelo e placa para evitar confusão
    mensagens5meses: [
        "Olá {nome}! Tudo bem?\nJá faz 5 meses da última visita do seu *{model_car}* (Placa: *{car_plate}*) na Rissato. Que tal agendar uma verificação preventiva?",
        
        "Olá {nome}! Como vai?\nPara manter o seu *{model_car}* (Placa: *{car_plate}*) sempre em dia e evitar gastos imprevistos, recomendamos uma avaliação a cada 5 meses. Deseja agendar um horário?"
    ],

    // Respostas automáticas do NPS centralizadas aqui para organizar o fluxo.js
    // Respostas automáticas do NPS centralizadas aqui para organizar o fluxo.js
    respostasNPS: {
        detrator_pergunta: "Obrigado pela sua avaliacao. Voce poderia me contar mais como foi a sua experiencia na Rissato Motors?",
        
        detrator_agradecimento: "Agradeco pela sua avaliacao, vamos registrar no nosso banco de dados e fazer o possivel para melhorar. Agradeco pela avaliacao!",
        
        promotor_agradecimento: "Muito obrigado pela sua avaliacao, isso ajuda muito a melhorar o nosso trabalho! Voce poderia nos avaliar no Google para que todos saibam da qualidade do nosso servico? Sua avaliacao e muito importante para a gente!",
        
        promotor_link: "Segue o link: https://g.page/r/Cf9Mnbdd6dKmEBM/review"
    }
};