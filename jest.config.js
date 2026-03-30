module.exports = {
  // Define o ambiente de teste como Node.js
  testEnvironment: 'node',

  // Padrões para encontrar arquivos de teste
  testMatch: [
    '**/__tests__/**/*.js', // Seus testes podem estar aqui
    '**/?(*.)+(spec|test).js' // Ou com sufixo .spec.js ou .test.js
  ],

  // Ignora o diretório node_modules e outros
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/.history/'
  ],

  // Arquivos que serão executados antes de cada arquivo de teste
  // Útil para configurar mocks globais ou variáveis de ambiente
  setupFilesAfterEnv: [
    './jest.setup.js' // Caminho para o arquivo de setup global
  ],

  // Mapeamento de módulos para mocks, se necessário
  // Exemplo: se você precisar mockar um módulo específico globalmente
  moduleNameMapper: {
    // '^@/(.*)$': '<rootDir>/src/$1', // Exemplo para aliases de caminho
  },

  // Configuração para coletar cobertura de código
  collectCoverage: true,
  collectCoverageFrom: [
    '**/*.js',
    '!**/node_modules/**',
    '!**/__tests__/**',
    '!**/coverage/**',
    '!jest.config.js',
    '!jest.setup.js',
    '!index.js', // Se index.js for o ponto de entrada principal e não tiver lógica testável diretamente
    '!legado.js', // Se for código legado que não será testado
    '!start.sh',
    '!Ligar_Sistema.bat'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['json', 'lcov', 'text', 'clover'],

  // Configuração para jest-puppeteer (se você for usar)
  // preset: 'jest-puppeteer', // Descomente se for usar jest-puppeteer

  // Configuração para resolver módulos CommonJS em um ambiente Node.js
  // Isso é importante porque seu package.json define "type": "commonjs"
  // e algumas libs podem ser ESM, ou vice-versa.
  // O Jest geralmente lida bem com CommonJS por padrão, mas se houver problemas
  // com módulos ESM, pode ser necessário um transformador como babel-jest.
  // Por enquanto, vamos manter simples.
};
