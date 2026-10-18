# ---------------------------------------------------------------------------
# backup-db.ps1 - Sauvegarde d'une base PostgreSQL pour backend_new
#
# Place dans backend_new/_scripts/ pour rester dans le perimetre backend_new.
#
# Usage (depuis backend_new/) :
#   powershell -ExecutionPolicy Bypass -File ".\_scripts\backup-db.ps1"
#   powershell -ExecutionPolicy Bypass -File ".\_scripts\backup-db.ps1" -Database uswap
#
# Produit un dump SQL lisible (-Fp) ET un dump binaire (-Fc) dans backend_new/backups/.
# ---------------------------------------------------------------------------
param(
    [string]$Database = "uswap_new",
    [string]$DbHost   = "localhost",
    [int]   $Port     = 5432,
    [string]$DbUser   = "postgres",
    [string]$Password = "danielle1234@@@@"
)

$ErrorActionPreference = "Stop"

$psqlBin = "C:\Program Files\PostgreSQL\17\bin"
$dumpExe = Join-Path $psqlBin "pg_dump.exe"

if (-not (Test-Path $dumpExe)) {
    Write-Error "pg_dump.exe introuvable dans $psqlBin. Verifiez l'installation PostgreSQL."
    exit 1
}

# Dossier de sauvegarde a cote de backend_new/ (backend_new/backups).
$backDir = Join-Path (Split-Path -Parent $PSScriptRoot) "backups"
if (-not (Test-Path $backDir)) { New-Item -ItemType Directory -Path $backDir | Out-Null }

$stamp    = Get-Date -Format "yyyyMMdd-HHmmss"
$sqlFile  = Join-Path $backDir "$Database-$stamp.sql"
$dumpFile = Join-Path $backDir "$Database-$stamp.dump"

$env:PGPASSWORD = $Password

Write-Host "Sauvegarde de la base '$Database' vers :" -ForegroundColor Cyan
Write-Host "  - $sqlFile"
Write-Host "  - $dumpFile"

# Dump SQL (lisible, restaurable avec psql)
& $dumpExe -U $DbUser -h $DbHost -p $Port -d $Database -Fp -f $sqlFile
if ($LASTEXITCODE -ne 0) { Write-Error "Echec du dump SQL."; exit 1 }

# Dump binaire (restauration plus rapide avec pg_restore)
& $dumpExe -U $DbUser -h $DbHost -p $Port -d $Database -Fc -f $dumpFile
if ($LASTEXITCODE -ne 0) { Write-Error "Echec du dump binaire."; exit 1 }

Write-Host "Sauvegarde terminee avec succes." -ForegroundColor Green
Get-Item $sqlFile, $dumpFile | Select-Object Name, Length, LastWriteTime | Format-Table
