# One-click setup for people who don't code. Started by Install.bat.
# Gets Node.js if needed, builds the installer, installs the app and opens it.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is far slower when it draws progress
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$NodeVersion = '24.22.2'
$NodeSha256 = 'ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2'
$MinNodeMajor = 20
$MinFreeGB = 4
$MaxRootLength = 110 # Node.js and node_modules add up to ~135 characters; Windows stops at 260

trap { Stop-WithError $_.Exception.Message }

$root = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$appName = $package.build.productName
$setupExe = Join-Path $root "dist\DIY-MC-Hosting-Setup-$($package.version).exe"
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) "$($package.build.nsis.shortcutName).lnk"

function Write-Step($number, $text) {
  Write-Host ''
  Write-Host " [$number/4] $text" -ForegroundColor Green
}

function Stop-WithError($text) {
  Write-Host ''
  Write-Host " Setup stopped: $text" -ForegroundColor Red
  Write-Host ''
  Write-Host ' Nothing on your PC was damaged, and you can run Install.bat again.'
  Write-Host ' If it keeps happening, take a screenshot of this window and open an issue:'
  Write-Host ' https://github.com/Ikmal1270/Minecraft-self-hosting/issues'
  exit 1
}

function Wait-ForAppToClose {
  while (Get-Process -Name $appName -ErrorAction SilentlyContinue) {
    Write-Host ''
    Write-Host " $appName is open. Stop your server and close the app, including from the system tray." -ForegroundColor Yellow
    Read-Host ' Press Enter when it is closed' | Out-Null
  }
}

function Get-InstalledNodeMajor {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) { return 0 }
  try { return [int]((& $node.Source --version) -replace '^v(\d+).*', '$1') } catch { return 0 }
}

function Install-PortableNode {
  $toolsDir = Join-Path $root '.tools'
  $nodeDir = Join-Path $toolsDir "node-v$NodeVersion-win-x64"
  if (-not (Test-Path -LiteralPath (Join-Path $nodeDir 'node.exe'))) {
    Write-Host ' Downloading a private copy of Node.js. It stays inside this folder.'
    New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
    $zip = Join-Path $toolsDir 'node.zip'
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" -OutFile $zip
    } catch {
      Stop-WithError 'Could not download Node.js. Check your internet connection.'
    }
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $NodeSha256) {
      Remove-Item -LiteralPath $zip -Force
      Stop-WithError 'The Node.js download was damaged or changed, so it was deleted.'
    }
    Expand-Archive -LiteralPath $zip -DestinationPath $toolsDir -Force
    Remove-Item -LiteralPath $zip -Force
  }
  $env:Path = "$nodeDir;$env:Path"
}

Write-Host ''
Write-Host " $appName - one-click setup" -ForegroundColor Cyan
Write-Host ' This takes a few minutes and needs an internet connection. Keep this window open.'

Write-Step 1 'Checking your PC'
if (-not [Environment]::Is64BitOperatingSystem) {
  Stop-WithError 'This app needs 64-bit Windows.'
}
if ($root.Length -gt $MaxRootLength) {
  Stop-WithError 'This folder is buried too deep for Windows to handle. Move it somewhere short, like C:\DIY-MC-Hosting, and run Install.bat from there.'
}
$freeGB = [math]::Round((Get-PSDrive -Name $root.Substring(0, 1)).Free / 1GB, 1)
if ($freeGB -lt $MinFreeGB) {
  Stop-WithError "This drive has $freeGB GB free and setup needs about $MinFreeGB GB. Free up some space, or move this folder to another drive."
}
Wait-ForAppToClose
if ((Get-InstalledNodeMajor) -lt $MinNodeMajor) { Install-PortableNode }
Set-Location -LiteralPath $root

Write-Step 2 'Downloading what the app needs'
& npm.cmd ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Could not download the app''s components. Check your internet connection.' }

Write-Step 3 'Building the app'
& npm.cmd run build:installer
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $setupExe)) { Stop-WithError 'The build did not finish.' }

Write-Step 4 'Installing the app'
Wait-ForAppToClose
$installer = Start-Process -FilePath $setupExe -ArgumentList '/S' -Wait -PassThru
if ($installer.ExitCode -ne 0) { Stop-WithError "The installer failed with code $($installer.ExitCode)." }

Write-Host ''
Write-Host " Done! $appName is installed." -ForegroundColor Green
Write-Host ' You can open it any time from the Start menu or your desktop.'
if (Test-Path -LiteralPath $shortcut) { Start-Process -FilePath $shortcut }
