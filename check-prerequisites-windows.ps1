Write-Host "============================================"
Write-Host "  Salon Manager - Prerequisite Check (Windows)"
Write-Host "============================================"
Write-Host ""
Write-Host "Note: no npm or pip packages are needed. The server is a single"
Write-Host "Python file using only its standard library, and the app is a"
Write-Host "single bundled HTML file. This checks the real requirements:"
Write-Host "Python (to run the server) and, if you want phones to reach it"
Write-Host "from outside the salon, Tailscale."
Write-Host ""

$allGood = $true
$missing = @()

# 1. Python check
Write-Host "[1/3] Checking for Python 3..."
$pyCmd = $null
foreach ($cmd in @("python", "python3")) {
    try {
        $ver = & $cmd --version 2>&1
        if ($LASTEXITCODE -eq 0 -and $ver -match "Python 3") {
            $pyCmd = $cmd
            Write-Host "  OK: Found $ver (command: $cmd)" -ForegroundColor Green
            break
        }
    } catch {}
}
if (-not $pyCmd) {
    Write-Host "  MISSING: Python 3 was not found." -ForegroundColor Red
    Write-Host "  Fix: run install-python-windows.bat in this same folder." -ForegroundColor Yellow
    $allGood = $false
    $missing += "Python 3"
}
Write-Host ""

# 2. App files + port check
Write-Host "[2/3] Checking the app files and port 8765..."
$serverPath = Join-Path $PSScriptRoot "server.py"
$htmlPath = Join-Path $PSScriptRoot "salon-manager-remote.html"
if (Test-Path $serverPath) {
    Write-Host "  OK: server.py found." -ForegroundColor Green
} else {
    Write-Host "  MISSING: server.py is not in this folder." -ForegroundColor Red
    $allGood = $false
    $missing += "server.py"
}
if (Test-Path $htmlPath) {
    Write-Host "  OK: salon-manager-remote.html found." -ForegroundColor Green
} else {
    Write-Host "  MISSING: salon-manager-remote.html is not in this folder." -ForegroundColor Red
    $allGood = $false
    $missing += "salon-manager-remote.html"
}
try {
    $portInUse = Test-NetConnection -ComputerName "localhost" -Port 8765 -WarningAction SilentlyContinue -InformationLevel Quiet
} catch { $portInUse = $false }
if ($portInUse) {
    Write-Host "  NOTE: Port 8765 is currently in use by something else." -ForegroundColor Yellow
    Write-Host "  Only a problem if the server fails to start -- if so, use" -ForegroundColor Yellow
    Write-Host "  a different port, e.g.: python server.py --port 8766" -ForegroundColor Yellow
} else {
    Write-Host "  OK: Port 8765 is free." -ForegroundColor Green
}
Write-Host ""

# 3. Tailscale check (only needed for phones to reach this computer from outside the salon)
Write-Host "[3/3] Checking for Tailscale (needed for phone access from anywhere)..."
$tailscalePaths = @(
    "$env:ProgramFiles\Tailscale\tailscale.exe",
    "${env:ProgramFiles(x86)}\Tailscale\tailscale.exe"
)
$tsFound = $tailscalePaths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($tsFound) {
    Write-Host "  OK: Tailscale is installed." -ForegroundColor Green
    try {
        $status = & $tsFound status 2>&1
        Write-Host "  $status" -ForegroundColor Gray
    } catch {}
} else {
    Write-Host "  Not installed yet." -ForegroundColor Yellow
    Write-Host "  This is only required if you want phones to reach the app" -ForegroundColor Yellow
    Write-Host "  from outside the salon's WiFi. See README.md -> 'Access From" -ForegroundColor Yellow
    Write-Host "  Anywhere (Tailscale)' for the install steps." -ForegroundColor Yellow
}
Write-Host ""

Write-Host "============================================"
if ($allGood) {
    Write-Host "All required prerequisites are met." -ForegroundColor Green
    Write-Host "You're ready to run start-server-windows.bat" -ForegroundColor Green
} else {
    Write-Host "MISSING: $($missing -join ', ')" -ForegroundColor Red
    Write-Host "Resolve the item(s) above, then run this check again." -ForegroundColor Red
}
Write-Host "============================================"
