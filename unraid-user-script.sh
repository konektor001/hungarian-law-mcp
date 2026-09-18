#!/bin/bash
# ==============================================================================
# Unraid Server & Linux VPS — Napi Automatikus MCP Frissítő Szkript
# ==============================================================================
# 
# UNRAID HASZNÁLAT:
# 1. Telepítsd a "User Scripts" plugint az Unraid Community Apps-ból.
# 2. Hozz létre egy új szkriptet: "Magyar-Jogszabaly-MCP-Daily-Sync"
# 3. Másold be ezt a kódot, és állítsd az ütemezést "Custom"-ra vagy "Daily"-re (pl. 0 3 * * * = minden éjjel 03:00-kor).
#
# LINUX VPS HASZNÁLAT:
# 1. Másold fel a szerverre: /root/scripts/docker-daily-update.sh
# 2. chmod +x /root/scripts/docker-daily-update.sh
# 3. Crontab szerkesztése (crontab -e):
#    0 3 * * * /root/scripts/docker-daily-update.sh >> /var/log/mcp-daily-sync.log 2>&1
# ==============================================================================

CONTAINER_NAME="magyar-jogszabaly-mcp"
DATE_STR=$(date '+%Y-%m-%d %H:%M:%S')

echo "------------------------------------------------------------------"
echo "[$DATE_STR] MCP Napi Szinkronizálás elindult..."

# Ellenőrizzük, hogy a Docker konténer fut-e
if [ "$(docker ps -q -f name=$CONTAINER_NAME)" ]; then
    echo "Konténer ($CONTAINER_NAME) aktív, belső napi szinkronizálás futtatása..."
    
    # 1. Belső napi szinkronizáló szkript futtatása a konténer Node környezetében
    if docker exec $CONTAINER_NAME test -f dist/daily-sync.js; then
        docker exec $CONTAINER_NAME node dist/daily-sync.js
    elif docker exec $CONTAINER_NAME test -f scripts/daily-sync.ts; then
        docker exec $CONTAINER_NAME npx tsx scripts/daily-sync.ts
    else
        echo "Nem található a daily-sync szkript, /health lekérdezése..."
        docker exec $CONTAINER_NAME node -e "http=require('http');http.get('http://localhost:3000/health',r=>{r.pipe(process.stdout)})"
    fi

    # 2. Opcionális: Ha van upstream Git tároló és compose fájl a mappában, új kép ellenőrzése
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
    if [ -f "$SCRIPT_DIR/docker-compose.yaml" ]; then
        cd "$SCRIPT_DIR"
        echo "Docker compose konfiguráció ellenőrzése ($SCRIPT_DIR)..."
    fi

    echo "[$DATE_STR] Szinkronizálás sikeresen befejeződött."
else
    echo "FIGYELEM: A konténer ($CONTAINER_NAME) nem fut! Megkísérlés az elindításra..."
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
    if [ -f "$SCRIPT_DIR/docker-compose.yaml" ]; then
        cd "$SCRIPT_DIR"
        docker compose up -d
        echo "Konténer elindítva."
    else
        docker start $CONTAINER_NAME || echo "Nem sikerült elindítani a konténert."
    fi
fi
echo "------------------------------------------------------------------"
