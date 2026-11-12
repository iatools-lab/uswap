# ---------------------------------------------------------------------------
# backup-db.ps1 - Sauvegarde d'une base PostgreSQL pour backend
#
# Place dans backend/_scripts/ pour rester dans le perimetre backend.
#
# Usage (depuis backend/) :
#   powershell -ExecutionPolicy Bypass -File ".\_scripts\backup-db.ps1"
#   powershell -ExecutionPolicy Bypass -File ".\_scripts\backup-db.ps1" -Database uswap
#
# AUCUN mot de passe n'est ecrit dans ce fichier. Il est lu, dans cet ordre :
#   1. -Password (parametre explicite)
#   2. la variable d'environnement PGPASSWORD
#   3. la variable DATABASE_URL du fichier backend/.env
#
# Produit un dump SQL lisible (-Fp) ET un dump binaire (-Fc) dans backend/backups/.
# ---------------------------------------------------------------------------
param(
    [string]$Database = "uswap_new",
    [string]$DbHost   = "localhost",
    [int]   $Port     = 5432,
    [string]$DbUser   = "postgres",
    [string]$Password = ""
)

$ErrorActionPreference = "Stop"

$psqlBin = "C:\Program Files\PostgreSQL\17\bin"
$dumpExe = Join-Path $psqlBin "pg_dump.exe"

if (-not (Test-Path $dumpExe)) {
    Write-Error "pg_dump.exe introuvable dans $psqlBin. Verifiez l'installation PostgreSQL."
    exit 1
}

# Dossier de sauvegarde a cote de backend/ (backend/backups).
$backDir = Join-Path (Split-Path -Parent $PSScriptRoot) "backups"
if (-not (Test-Path $backDir)) { New-Item -ItemType Directory -Path $backDir | Out-Null }

$stamp    = Get-Date -Format "yyyyMMdd-HHmmss"
$sqlFile  = Join-Path $backDir "$Database-$stamp.sql"
$dumpFile = Join-Path $backDir "$Database-$stamp.dump"

if (-not $Password) { $Password = $env:PGPASSWORD }

# Repli : mot de passe lu depuis backend/.env (jamais versionne).
if (-not $Password) {
    $envFile = Join-Path (Split-Path -Parent $PSScriptRoot) ".env"
    if (Test-Path $envFile) {
        $url = (Select-String -Path $envFile -Pattern '^DATABASE_URL=' |
            Select-Object -First 1).Line
        if ($url -match '://([^:]+):([^@]+)@([^:/]+)') {
            $encoded = $matches[2]
            if (-not $DbUser -or $DbUser -eq "postgres" -and $matches[1]) { $DbUser = [uri]::UnescapeDataString($matches[1]) }
            $Password = [uri]::UnescapeDataString($encoded)
            if (-not $PSBoundParameters.ContainsKey("DbHost")) { $DbHost = $matches[3] }
        }
    }
}

if (-not $Password) {
    Write-Error "Mot de passe introuvable : utilisez -Password, PGPASSWORD ou DATABASE_URL dans backend/.env."
    exit 1
}

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
