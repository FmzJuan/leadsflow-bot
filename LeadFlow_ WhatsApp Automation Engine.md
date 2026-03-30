# 🚀 **LeadFlow**: WhatsApp Automation Engine

![GitHub Workflow Status](https://img.shields.io/badge/status-active-brightgreen?style=for-the-badge) ![Node.js Version](https://img.shields.io/badge/node-v20%2B-green?style=for-the-badge) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4285F4?style=for-the-badge&logo=postgresql&logoColor=white) ![Google Sheets](https://img.shields.io/badge/Google%20Sheets-34A853?style=for-the-badge&logo=googlesheets&logoColor=white)

Bem-vindo ao **LeadFlow**, um sistema robusto de automação para WhatsApp, carinhosamente conhecido como **Projeto Charlie**. Desenvolvido em Node.js, esta solução inteligente atua como um motor de captação e gestão de leads, integrando-se perfeitamente com o WhatsApp, um banco de dados relacional (PostgreSQL) e planilhas na nuvem (Google Sheets). Além disso, oferece uma interface web intuitiva (Dashboard) para monitoramento em tempo real e interação administrativa.

---

## ✨ Funcionalidades Chave

O **LeadFlow** foi projetado para otimizar a gestão de leads, oferecendo um conjunto poderoso de funcionalidades:

- **Sincronização Dupla de Dados**: Salva automaticamente os dados dos leads tanto no banco de dados PostgreSQL quanto em uma planilha Google Sheets, garantindo redundância e flexibilidade na gestão.
- **Captura Inteligente de Leads**: Identifica novos contatos, processa seus dados (nome, número limpo) e gera um link direto para o chat do WhatsApp, facilitando o acompanhamento.
- **Dashboard Administrativa Integrada**: Uma interface web dedicada para monitorar o status da conexão do WhatsApp, visualizar o QR Code para pareamento e acessar informações importantes do sistema. Protegida por um sistema de login com sessão para acesso seguro.
- **Relatórios On-demand em PDF**: Administradores podem solicitar um relatório completo dos leads capturados diretamente pelo WhatsApp, utilizando o comando `/relatorio`. O sistema gera um PDF formatado e o envia de volta.
- **Formatação Automática de Google Sheets**: Integração com a API do Google Sheets para aplicar formatação visual (cabeçalho, bordas) automaticamente a cada novo lead inserido, mantendo a planilha organizada e profissional.
- **Persistência de Dados com PostgreSQL**: Utiliza PostgreSQL para armazenamento estruturado e histórico de interações, com lógica `ON CONFLICT` para evitar duplicação de registros e atualizar a última interação do lead.
- **Auto-reconexão Inteligente**: Monitora a conexão com o WhatsApp e tenta restabelecê-la automaticamente em caso de queda, garantindo a continuidade da operação.

---

## 🏗️ Arquitetura do Sistema

O projeto é modular e bem estruturado, dividido em três camadas principais para facilitar a manutenção e escalabilidade:

1. **Engine (Motor)**: O coração do sistema, responsável pela conexão e interação com o WhatsApp (via Baileys), a lógica de processamento de mensagens, a integração com a API do Google Sheets e a geração de relatórios em PDF.
2. **Database (Persistência)**: Gerencia a conexão e as operações com o banco de dados PostgreSQL, garantindo o armazenamento seguro e eficiente dos dados dos leads e suas interações.
3. **Web Interface (Dashboard)**: Uma aplicação Express.js que serve como painel de controle. Utiliza Socket.io para comunicação em tempo real (exibição de QR Code e status) e EJS para renderização das views, oferecendo uma experiência de usuário fluida e segura.

---

## 📁 Estrutura do Projeto

```text
.
├── DataBase/           # Módulo de conexão e operações com o PostgreSQL
│   └── connection.js   # Lógica de conexão e execução de queries
├── Engine/             # Módulo principal com a lógica de negócio do bot
│   ├── report.js       # Geração de relatórios em PDF
│   ├── sheets.js       # Integração com Google Sheets API
│   └── whatsapp.js     # Conexão e manipulação do WhatsApp (Baileys)
├── public/             # Arquivos estáticos da Dashboard (CSS, JS, imagens)
│   └── style.css       # Estilos CSS para a interface web
├── views/              # Templates EJS para as páginas da Dashboard
│   ├── index.ejs       # Página principal da Dashboard
│   └── login.ejs       # Página de login da Dashboard
├── docker-compose.yml  # Definição dos serviços Docker (aplicação e banco de dados)
├── Dockerfile          # Instruções para construir a imagem Docker da aplicação
├── index.js            # Ponto de entrada da aplicação e servidor web
├── package.json        # Metadados do projeto e lista de dependências Node.js
├── package-lock.json   # Bloqueio de versões das dependências
└── start.sh            # Script de inicialização (opcional, para ambiente sem Docker)
```

---

## 🛠️ Tecnologias Utilizadas

- **Node.js**: Ambiente de execução JavaScript.
- **Express.js**: Framework web para a Dashboard.
- **Socket.io**: Comunicação em tempo real entre servidor e cliente.
- **@whiskeysockets/baileys**: Biblioteca para interação com a API do WhatsApp.
- **PostgreSQL**: Banco de dados relacional para persistência de dados.
- **Google APIs (googleapis)**: Integração com Google Sheets.
- **PDFKit**: Geração de documentos PDF.
- **EJS**: Engine de templates para as views da Dashboard.
- **Dotenv**: Gerenciamento de variáveis de ambiente.
- **Docker & Docker Compose**: Orquestração e conteinerização da aplicação.

---

## ⚙️ Configuração e Instalação

Para colocar o **LeadFlow** em funcionamento, siga os passos abaixo:

### 1. Pré-requisitos

Certifique-se de ter os seguintes softwares instalados em sua máquina ou servidor:

- **Docker & Docker Compose**: Essenciais para a execução conteinerizada do projeto. Você pode baixá-los em [docker.com](https://www.docker.com/).
- **Conta Google Cloud Platform**: Necessária para configurar as credenciais de acesso à API do Google Sheets.

### 2. Configuração das Credenciais Google Sheets

O **LeadFlow** utiliza uma **Service Account** para interagir com o Google Sheets. Siga estes passos para obter seu arquivo `credentials.json`:

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/).
2. Crie um novo projeto ou selecione um existente.
3. No menu de navegação, vá para **APIs e Serviços > Credenciais**.
4. Clique em **Criar Credenciais > Chave da conta de serviço**.
5. Selecione a conta de serviço desejada (ou crie uma nova), escolha o tipo de chave **JSON** e clique em **Criar**.
6. Um arquivo `JSON` será baixado. Renomeie-o para `credentials.json` e coloque-o na **raiz do diretório do projeto** (`bot-wpp-balleys/`).
7. Certifique-se de que a API do Google Sheets esteja ativada para o seu projeto (vá em **APIs e Serviços > Biblioteca** e procure por "Google Sheets API").
8. **Compartilhe a planilha**: Para que a Service Account possa escrever na sua planilha, você precisa compartilhar a planilha com o e-mail da Service Account (encontrado no arquivo `credentials.json` na chave `client_email`).

### 3. Configuração das Variáveis de Ambiente (`.env`)

Crie um arquivo chamado `.env` na **raiz do diretório do projeto** (`bot-wpp-balleys/`) e preencha-o com as seguintes informações:

```env
# Configurações do Banco de Dados PostgreSQL
DB_USER=seu_usuario_postgres
DB_PASS=sua_senha_postgres
DB_NAME=nome_do_banco_postgres
DB_HOST=db_postgres  # Nome do serviço Docker para o banco de dados
DB_PORT=5432

# Configurações do Painel Administrativo (Dashboard Web)
PANEL_USER=admin_usuario
PANEL_PASS=senha_segura_dashboard
SESSION_SECRET=uma_chave_secreta_aleatoria_e_longa_para_sessao

# Configurações do Bot WhatsApp
ADMIN_NUMBER=5511999999999  # Seu número de WhatsApp com DDI e DDD (ex: 5511987654321)
SHEET_ID=id_da_sua_planilha_google  # O ID da sua planilha Google (URL: .../d/SEU_ID_AQUI/edit)
```

### 4. Execução do Projeto (com Docker Compose)

Com o Docker e Docker Compose instalados, o arquivo `credentials.json` na raiz e o `.env` configurado, você pode iniciar o projeto com um único comando:

1. Navegue até o diretório raiz do projeto (`bot-wpp-balleys/`) no seu terminal.
2. Execute o comando:
   ```bash
   docker-compose up -d --build
   ```
   - `up`: Inicia os serviços definidos no `docker-compose.yml`.
   - `-d`: Executa os contêineres em modo *detached* (em segundo plano).
   - `--build`: Reconstrói as imagens dos serviços, garantindo que as últimas alterações sejam aplicadas.
3. Aguarde alguns instantes para que os serviços sejam inicializados.
4. Acesse a Dashboard em seu navegador: `http://localhost:3000`.
5. Faça login com as credenciais `PANEL_USER` e `PANEL_PASS` definidas no seu `.env`.
6. O QR Code para pareamento do WhatsApp será exibido na Dashboard. Escaneie-o com seu celular.

---

## 📸 Screenshots

*(Em breve: Adicione aqui screenshots da Dashboard (tela de login, tela principal com QR Code e status) e um exemplo da planilha Google Sheets formatada automaticamente.)*

---

## 💡 Sugestões de Melhoria e Evolução

O **LeadFlow** é um projeto em constante evolução. Aqui estão algumas ideias para futuras melhorias:

1. **Validação de Mensagens e Fluxo de Conversa**: Implementar um sistema de "Menu" ou "Fluxo de Conversa" (chatbot) mais sofisticado para qualificar leads e guiar a interação.
2. **Logs em Arquivo com Rotação**: Adicionar um sistema de log mais robusto, com rotação de arquivos, para facilitar o debug e a auditoria em ambientes de produção.
3. **Gerenciamento de Segredos**: Explorar soluções mais seguras para o armazenamento de credenciais (ex: HashiCorp Vault, AWS Secrets Manager) em vez de `.env` em produção.
4. **Notificações de Status**: Implementar notificações (e-mail, Telegram) para alertar sobre o status da conexão do WhatsApp ou erros críticos.
5. **Integração com CRM**: Conectar o sistema a plataformas de CRM populares para uma gestão de leads ainda mais completa.

---

## 🤝 Contribuição

Contribuições são bem-vindas! Se você tiver ideias, sugestões ou quiser reportar um bug, sinta-se à vontade para abrir uma *issue* ou enviar um *pull request*.

---

## 👨‍💻 Autor

**FmzJuan - Juan Meneghesso Vildoso**

- [GitHub](https://github.com/FmzJuan)
- [LinkedIn](https://www.linkedin.com/in/juanmeneghesso/)

---

© 2026 - Desenvolvido por Juan Meneghesso **Vildoso**.
