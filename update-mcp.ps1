# MCP Adatbázis Építő Szkript (Teljes)
Set-Location -Path $PSScriptRoot

Write-Host "1. Teljes adatbázis letöltés elindítása (resume funkcióval)..."
Write-Host "Kérlek légy türelemmel, ez az NJT korlátozásai miatt 1-2 órát is igénybe vehet!"
npm run ingest:full

Write-Host "2. Docker konténer újraépítése a friss, nagy adatbázissal..."
docker compose up -d --build

Write-Host "Frissítés sikeresen befejeződött! Az MCP konténer mostantól a teljes jogi adatbázissal fut."
