# Starts CertiFlow so a PHONE on the same Wi-Fi can open the QR codes.
# Finds this computer's LAN address, saves it as PUBLIC_URL in .env, then starts everything.
# Run from the certiflow folder:   powershell -ExecutionPolicy Bypass -File .\start-lan.ps1
$cfg = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1
if (-not $cfg) { Write-Host "No network connection found. Connect to Wi-Fi first." -ForegroundColor Red; exit 1 }
$ip = ($cfg.IPv4Address | Select-Object -First 1).IPAddress
$url = "http://${ip}:8080"

$lines = @()
if (Test-Path .env) { $lines = Get-Content .env | Where-Object { $_ -notmatch '^PUBLIC_URL=' } }
$lines += "PUBLIC_URL=$url"
Set-Content -Path .env -Value $lines -Encoding ascii

Write-Host "PUBLIC_URL set to $url" -ForegroundColor Green
docker compose up -d --build
Write-Host ""
Write-Host "Open on this computer:  $url" -ForegroundColor Cyan
Write-Host "Phone must be on the SAME Wi-Fi. If the phone cannot open it, allow port 8080 in Windows Firewall:" 
Write-Host "  (Admin PowerShell)  New-NetFirewallRule -DisplayName CertiFlow8080 -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow"
