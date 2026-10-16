#requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$Rebuild,
    [switch]$NoBrowser,
    [ValidateRange(30, 1800)][int]$StartupTimeoutSeconds = 240
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot 'deploy\.env'
$composePath = Join-Path $projectRoot 'deploy\docker-compose.yml'
$dc = @('compose', '--env-file', $envPath, '-f', $composePath)

function Invoke-Docker {
    param([string[]]$Arguments)
    $ErrorActionPreference = 'Continue'
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed (exit $LASTEXITCODE). See the output above." }
}

function Get-DockerExitCode {
    param([string[]]$Arguments)
    $ErrorActionPreference = 'Continue'
    & docker @Arguments *> $null
    return $LASTEXITCODE
}

function New-Secret {
    $buf = New-Object byte[] 24
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buf) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($buf).Replace('+', '-').Replace('/', '_').TrimEnd('=')
}

function Start-DockerDesktop {
    $dockerBin = Split-Path -Parent (Get-Command docker).Source
    $desktopRoot = Split-Path -Parent (Split-Path -Parent $dockerBin)
    $desktopExe = Join-Path $desktopRoot 'Docker Desktop.exe'
    $installPath = Join-Path $env:ProgramData 'DockerDesktop\install-settings.json'
    # Windows can retain an inaccessible AF_UNIX socket after Desktop exits.
    # A fresh LOCALAPPDATA avoids it. Only do this when the existing data disk
    # is explicitly configured independently of LOCALAPPDATA and still exists.
    if ((Test-Path -LiteralPath $desktopExe) -and (Test-Path -LiteralPath $installPath)) {
        $install = Get-Content -LiteralPath $installPath -Raw | ConvertFrom-Json
        $dataRoot = [string]$install.wslDefaultDataRoot
        if ($dataRoot -and (Test-Path -LiteralPath (Join-Path $dataRoot 'disk\docker_data.vhdx') -PathType Leaf)) {
            # Keep Unix socket paths short; Windows AF_UNIX cannot bind long paths.
            $sessionName = [guid]::NewGuid().ToString('N').Substring(0, 8)
            $runtimeLocal = Join-Path (Join-Path (Split-Path -Parent $dataRoot) 'runtime') $sessionName
            $socketPath = $runtimeLocal.Replace('\', '/') + '/docker-secrets-engine/engine.sock'
            if ([Text.Encoding]::UTF8.GetByteCount($socketPath) -ge 104) {
                throw 'The Docker runtime path is too long for a Windows Unix socket.'
            }
            New-Item -ItemType Directory -Force -Path $runtimeLocal | Out-Null
            Write-Host "Using fresh Docker runtime cache; existing data disk: $dataRoot"
            $previousLocal = $env:LOCALAPPDATA
            try {
                $env:LOCALAPPDATA = $runtimeLocal
                Start-Process -FilePath $desktopExe -WindowStyle Hidden
            } finally { $env:LOCALAPPDATA = $previousLocal }
            return
        }
    }
    try { Invoke-Docker -Arguments @('desktop', 'start') } catch {
        if (-not (Test-Path -LiteralPath $desktopExe)) {
            throw 'Start Docker Desktop, wait for its engine to be ready, then run this script again.'
        }
        Start-Process -FilePath $desktopExe -WindowStyle Hidden
    }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker was not found. Install Docker Desktop first.'
}
Invoke-Docker -Arguments @('compose', 'version')
if ((Get-DockerExitCode -Arguments @('info', '--format', '{{.ServerVersion}}')) -ne 0) {
    Write-Host 'Starting Docker Desktop...'
    Start-DockerDesktop
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    do {
        if ((Get-DockerExitCode -Arguments @('info', '--format', '{{.ServerVersion}}')) -eq 0) { break }
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Docker engine did not become ready within 120 seconds.' }
        Start-Sleep -Seconds 2
    } while ($true)
}

New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'deploy\models') | Out-Null
if (-not (Test-Path -LiteralPath $envPath)) {
    @"
MYSQL_PASSWORD=$(New-Secret)
MYSQL_ROOT_PASSWORD=$(New-Secret)
MYSQL_PORT=3307
DEMO_USERNAME=demo
DEMO_PASSWORD=$(New-Secret)
OPERATOR_PASSWORD=$(New-Secret)
WEB_PORT=8088
WEB_BIND=127.0.0.1
IMAGE_PREFIX=docker.m.daocloud.io/library/
YOLO_WEIGHTS=
"@ | Set-Content -LiteralPath $envPath -Encoding ascii
    Write-Host 'Created deploy/.env with random passwords.'
} else {
    Write-Host 'Using existing deploy/.env.'
}
Invoke-Docker -Arguments ($dc + @('config', '--quiet'))
$configText = & docker @dc config --format json
if ($LASTEXITCODE -ne 0) { throw 'Cannot read Compose configuration.' }
$config = ($configText -join [Environment]::NewLine) | ConvertFrom-Json
$webPort = [int]$config.services.frontend.ports[0].published
$baseUrl = "http://localhost:$webPort"

$needsBuild = $Rebuild.IsPresent
foreach ($serviceName in @('backend', 'frontend')) {
    $imageName = $config.services.$serviceName.image
    if (-not $imageName) { $imageName = $config.name + '-' + $serviceName }
    if ((Get-DockerExitCode -Arguments @('image', 'inspect', $imageName)) -ne 0) { $needsBuild = $true }
}
$upArgs = $dc + @('up', '-d', '--wait', '--wait-timeout', "$StartupTimeoutSeconds")
if ($needsBuild) { $upArgs += '--build' }
try {
    Invoke-Docker -Arguments $upArgs
} catch {
    & docker @dc logs --no-color --tail 70 backend frontend mysql
    throw 'Containers did not become healthy. Review the logs above. To rebuild images, run this script with -Rebuild.'
}

# Check the host port and reverse proxy without using a system HTTP proxy.
Add-Type -AssemblyName System.Net.Http
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.UseProxy = $false
$client = [System.Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(10)
try {
    $health = $client.GetStringAsync("http://127.0.0.1:$webPort/api/health").GetAwaiter().GetResult() | ConvertFrom-Json
    if ($health.status -ne 'ok') { throw 'Backend health check failed.' }
    $html = $client.GetStringAsync("http://127.0.0.1:$webPort/").GetAwaiter().GetResult()
    $asset = [regex]::Match($html, 'src="(/assets/[^"\s]+\.js)"')
    if (-not $asset.Success) { throw 'The frontend HTML is missing its JavaScript bundle.' }
    $js = $client.GetStringAsync("http://127.0.0.1:$webPort" + $asset.Groups[1].Value).GetAwaiter().GetResult()
    if ($js.Length -lt 50 -or $js.TrimStart().StartsWith('<')) { throw 'Frontend JavaScript bundle is unavailable.' }
} finally {
    $client.Dispose()
    $handler.Dispose()
}
Invoke-Docker -Arguments ($dc + @('ps'))
Write-Host "Ready: $baseUrl" -ForegroundColor Green
Write-Host 'Login credentials (also saved in deploy/.env):'
Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^(DEMO_USERNAME|DEMO_PASSWORD|OPERATOR_PASSWORD)=' } | ForEach-Object { Write-Host $_ }
if (-not $NoBrowser) { Start-Process $baseUrl }
