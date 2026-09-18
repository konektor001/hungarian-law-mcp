# ==============================================================================
# Windows Napi MCP Szinkronizáló Szkript (PowerShell)
# ==============================================================================
Set-Location -Path $PSScriptRoot

Write-Host "Magyar Jogszabály MCP - Napi Szinkronizálás..." -ForegroundColor Cyan
npx tsx scripts/daily-sync.ts

if ($LASTEXITCODE -eq 0) {
    Write-Host "Napi szinkronizálás sikeresen befejeződött!" -ForegroundColor Green
} else {
    Write-Host "Figyelmeztetés vagy hiba történt a szinkronizálás során." -ForegroundColor Yellow
}
