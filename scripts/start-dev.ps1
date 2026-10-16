# Windows 无 Docker 本地研发启动。需有 Java21、Maven、Node22、Python3.11+，以及互联网安装包依赖。
$ErrorActionPreference='Stop'
$root = Split-Path -Parent $PSScriptRoot
foreach ($name in @('java','mvn','node','npm','python')) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "缺少 $name，请先安装并加入 PATH。" }
}
$venv = Join-Path $root 'ai-engine\.venv'
if (-not (Test-Path $venv)) { & python -m venv $venv }
$py = Join-Path $venv 'Scripts\python.exe'
& $py -m pip install -r (Join-Path $root 'ai-engine\requirements-dev.txt')
if ($LASTEXITCODE -ne 0) { throw '安装 Python 依赖失败' }
Push-Location (Join-Path $root 'frontend')
try { & npm install --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm 安装失败' } } finally { Pop-Location }
$env:PYTHON_BIN=$py
$env:AI_ROOT=Join-Path $root 'ai-engine'
$env:STORAGE_ROOT=Join-Path $root 'backend\data\storage'
Write-Host '演示环境：账号 demo / 密码 Demo@2026，请勿暴露到公网。' -ForegroundColor Yellow
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
Start-Process powershell -ArgumentList @('-NoExit','-Command',"`$env:PYTHON_BIN='$py'; `$env:AI_ROOT='$(Join-Path $root 'ai-engine')'; `$env:STORAGE_ROOT='$(Join-Path $root 'backend\data\storage')'; Set-Location '$backend'; mvn spring-boot:run")
Start-Sleep -Seconds 4
Start-Process powershell -ArgumentList @('-NoExit','-Command',"Set-Location '$frontend'; npm run dev")
Start-Process 'http://localhost:5173'
Write-Host '前端：http://localhost:5173  后端：http://localhost:8080' -ForegroundColor Green
