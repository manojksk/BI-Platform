Write-Host "============================================"
Write-Host "  Installing Python 3 (Windows)"
Write-Host "============================================"
Write-Host ""

foreach ($cmd in @("python", "python3")) {
    try {
        $ver = & $cmd --version 2>&1
        if ($LASTEXITCODE -eq 0 -and $ver -match "Python 3") {
            Write-Host "Python is already installed: $ver" -ForegroundColor Green
            Write-Host "Nothing to do."
            exit 0
        }
    } catch {}
}

Write-Host "Python was not found. Attempting to install it now..."
Write-Host ""

$winget = Get-Command winget -ErrorAction SilentlyContinue
if ($winget) {
    Write-Host "Using winget (Windows Package Manager) to install Python 3.12..."
    Write-Host "You may see a Windows security prompt -- approve it to continue."
    Write-Host ""
    winget install --id Python.Python.3.12 --source winget --accept-package-agreements --accept-source-agreements
    Write-Host ""
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Install finished." -ForegroundColor Green
    } else {
        Write-Host "winget reported a problem (exit code $LASTEXITCODE)." -ForegroundColor Yellow
        Write-Host "Opening the official download page as a fallback." -ForegroundColor Yellow
        Start-Process "https://www.python.org/downloads/"
    }
    Write-Host ""
    Write-Host "IMPORTANT: close this window and open a NEW one before" -ForegroundColor Yellow
    Write-Host "running check-prerequisites-windows.bat again -- Windows only" -ForegroundColor Yellow
    Write-Host "picks up the updated PATH in fresh windows." -ForegroundColor Yellow
} else {
    Write-Host "winget isn't available on this computer (it ships with modern" -ForegroundColor Yellow
    Write-Host "Windows 10/11). Opening the official Python download page instead." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "When the installer runs, TICK the box that says" -ForegroundColor Yellow
    Write-Host "'Add python.exe to PATH' on its very first screen." -ForegroundColor Yellow
    Start-Process "https://www.python.org/downloads/"
}
