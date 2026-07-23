#requires -Version 5.1
<#
.SYNOPSIS
Installe pi-studio et, par défaut, le fork pi-ask-tool web-aware.

.DESCRIPTION
Installateur Windows PowerShell pour les packages Pi publics d'EFC.
Supporte -h/--help, --ref, --no-ask, --launch, --port et --lan.

.EXAMPLE
.\scripts\install.ps1

.EXAMPLE
.\scripts\install.ps1 --launch --port 8080 --lan
#>

$ErrorActionPreference = "Stop"
$Ref = "main"
$InstallAsk = $true
$Launch = $false
$Port = 4173
$Lan = $false

function Show-Help {
    @"
pi-studio installer (Windows PowerShell)

Usage:
  .\scripts\install.ps1 [options]

Options:
  -h, --help          Afficher cette aide
  --ref REF           Branche, tag ou commit Git (défaut: main)
  --no-ask            Ne pas installer le fork pi-ask-tool web-aware
  --launch            Lancer Pi et /webui après l'installation
  --port PORT         Port de /webui (défaut: 4173)
  --lan               Bind 0.0.0.0 lors du lancement (risque réseau)

Exemples:
  .\scripts\install.ps1
  .\scripts\install.ps1 --launch
  .\scripts\install.ps1 --launch --port 8080 --lan

Le mode --lan expose un agent qui peut exécuter des commandes et accéder aux
fichiers. Traitez l'URL complète générée comme un mot de passe.
"@
}

for ($i = 0; $i -lt $args.Count; $i++) {
    switch ($args[$i]) {
        { $_ -in @("-h", "--help") } {
            Show-Help
            exit 0
        }
        "--ref" {
            if ($i + 1 -ge $args.Count) { throw "Valeur manquante pour --ref" }
            $Ref = $args[++$i]
        }
        { $_ -in @("--no-ask", "--without-ask") } { $InstallAsk = $false }
        "--launch" { $Launch = $true }
        "--port" {
            if ($i + 1 -ge $args.Count) { throw "Valeur manquante pour --port" }
            $Port = [int]$args[++$i]
        }
        "--lan" { $Lan = $true }
        default { throw "Option inconnue: $($args[$i]) (utilisez --help)" }
    }
}

if ($Port -lt 1 -or $Port -gt 65535) { throw "Le port doit être entre 1 et 65535" }
if ($Ref -match "\s") { throw "La référence Git ne doit pas contenir d'espace" }

foreach ($Command in @("git", "node", "pi")) {
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "Commande requise introuvable: $Command"
    }
}

$NodeMajor = [int](& node -p "Number(process.versions.node.split('.')[0])")
if ($NodeMajor -lt 20) { throw "Node.js 20+ requis (version détectée: $(& node --version))" }

Write-Host ""
Write-Host "Installation de pi-studio (ref: $Ref)" -ForegroundColor Cyan
Write-Host "Pi: $(& pi --version | Select-Object -First 1) | Node: $(& node --version)"

if ($InstallAsk) {
    Write-Host "[1/2] Installation de pi-ask-tool web-aware…"
    & pi install "git:github.com/erfinfo/pi-ask-tool@$Ref"
    if ($LASTEXITCODE -ne 0) { throw "Échec de l'installation de pi-ask-tool" }
} else {
    Write-Host "[1/2] pi-ask-tool ignoré (--no-ask)"
}

Write-Host "[2/2] Installation de pi-studio…"
& pi install "git:github.com/erfinfo/pi-studio@$Ref"
if ($LASTEXITCODE -ne 0) { throw "Échec de l'installation de pi-studio" }

$WebuiCommand = "/webui --port $Port"
if ($Lan) {
    $WebuiCommand += " --lan"
    Write-Warning "--lan donne accès à Pi sur le réseau. Traitez l'URL complète comme un mot de passe."
}

Write-Host ""
Write-Host "Installation terminée." -ForegroundColor Green
Write-Host "Dans Pi, lancez: $WebuiCommand"
Write-Host "Mise à jour future: pi update --extensions"

if ($Launch) {
    Write-Host ""
    Write-Host "Lancement de Pi…"
    & pi $WebuiCommand
    exit $LASTEXITCODE
}
