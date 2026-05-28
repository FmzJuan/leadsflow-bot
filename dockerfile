# ESTÁGIO 1: Builder
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

# ESTÁGIO 2: Final
FROM node:20-slim
WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive

# wget para healthcheck, ffmpeg para mídia (Baileys), Chromium + libs para Puppeteer (ERP)
RUN apt-get update && apt-get install -y \
    wget \
    ffmpeg \
    chromium \
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
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY --from=builder /app/node_modules ./node_modules
COPY . .

EXPOSE 3000

CMD ["node", "index.js"]