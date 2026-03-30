@echo off
color 0A
echo ===================================================
echo        INICIANDO O SISTEMA - PROJETO CHARLIE
echo ===================================================
echo.

echo [1/3] Verificando o Docker...
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [ERRO] O Docker nao foi encontrado ou nao esta rodando!
    echo Por favor, abra o Docker Desktop, espere ele iniciar e tente novamente.
    echo.
    pause
    exit /b
)

echo [2/3] Baixando atualizacoes e ligando o servidor...
docker compose -f docker-compose.yml up -d

echo.
echo [3/3] Tudo pronto!
echo ===================================================
echo  SISTEMA ONLINE COM SUCESSO!
echo  Acesse no seu navegador: http://localhost:3000
echo ===================================================
echo.
pause