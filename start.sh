#!/bin/bash

# Define cores para o terminal Linux
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # Sem cor

clear
echo "==================================================="
echo "       INICIANDO O SISTEMA - PROJETO CHARLIE"
echo "==================================================="
echo ""

echo "[1/3] Verificando o Docker..."
if ! command -v docker &> /dev/null
then
    echo -e "${RED}[ERRO] O Docker não foi encontrado!${NC}"
    echo "Por favor, instale o Docker para continuar."
    exit 1
fi

echo "[2/3] Baixando atualizações e ligando o servidor..."
docker compose -f docker-compose.yml up -d

echo ""
echo "[3/3] Tudo pronto!"
echo "==================================================="
echo -e "${GREEN}  SISTEMA ONLINE COM SUCESSO!${NC}"
echo "  Acesse no seu navegador: http://localhost:3000"
echo "==================================================="
echo ""