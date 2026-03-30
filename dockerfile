# ESTÁGIO 1: Nomeie como "builder"
FROM node:20-slim AS builder  
WORKDIR /app
COPY package*.json ./
RUN npm install

# ESTÁGIO 2: 
FROM node:20-slim
WORKDIR /app
# Instala o Chromium e as dependências para o Puppeteer e Baileys
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    libnss3 \
    libatk-bridge2.0-0 \
    libxcomposite1 \
    libxrandr2 \
    libxdamage1 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Váriavel de ambiente para o Puppeteer saber onde está o Chrome no Linux
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY --from=builder /app/node_modules ./node_modules
COPY . .

EXPOSE 3000

CMD ["node", "index.js"]