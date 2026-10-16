#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ProjectPath = 'E:\web\Zaoyan-AI\zaoyan-ai'
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Invoke-DockerStep {
    param([Parameter(Mandatory=$true)][string[]]$ArgsList)
    $ErrorActionPreference = 'Continue'
    & docker @ArgsList
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        throw "Docker step failed (exit $code). The repair has stopped; earlier build output is the cause."
    }
}

function Read-DockerJson {
    param([string[]]$ArgsList)
    $raw = @(Invoke-DockerStep -ArgsList $ArgsList)
    return (($raw -join "`n") | ConvertFrom-Json -ErrorAction Stop)
}

function Write-Utf8 {
    param([string]$Path, [string]$Text)
    [System.IO.File]::WriteAllText($Path, $Text, [System.Text.UTF8Encoding]::new($false))
}

# Embedded, offline verifier. It never downloads packages or edits the database.
$validator = @'
"""Offline checks for the existing runtime and a Spring Boot executable JAR."""
import argparse
import hashlib
import io
import json
import pathlib
import subprocess
import sys
import zipfile


def verify_jar(filename, expected_sha256=None):
    path = pathlib.Path(filename)
    if not path.is_file() or path.stat().st_size == 0:
        raise ValueError("JAR is missing, empty, or not a regular file: " + str(path))
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    sha256 = digest.hexdigest()
    if expected_sha256 and sha256.lower() != expected_sha256.lower():
        raise ValueError("JAR SHA256 differs from the verified host artifact")
    with zipfile.ZipFile(path) as archive:
        bad = archive.testzip()
        if bad:
            raise ValueError("JAR CRC error: " + bad)
        names = set(archive.namelist())
        required = {
            "META-INF/MANIFEST.MF",
            "org/springframework/boot/loader/launch/JarLauncher.class",
            "BOOT-INF/classes/com/zaoyan/ZaoyanApplication.class",
            "BOOT-INF/classes/application.yml",
        }
        if not required.issubset(names):
            raise ValueError("Missing Spring Boot entries: " + repr(sorted(required - names)))
        # JAR manifests allow CRLF followed by a space to continue a line.
        manifest = archive.read("META-INF/MANIFEST.MF").decode("utf-8")
        manifest = manifest.replace("\r\n", "\n").replace("\n ", "")
        attributes = dict(line.split(": ", 1) for line in manifest.splitlines() if ": " in line)
        if attributes.get("Main-Class") != "org.springframework.boot.loader.launch.JarLauncher":
            raise ValueError("Unexpected or absent executable Main-Class")
        if attributes.get("Start-Class") != "com.zaoyan.ZaoyanApplication":
            raise ValueError("Unexpected or absent Spring Boot Start-Class")
        for name in required:
            if name.endswith(".class") and archive.read(name)[:4] != b"\xca\xfe\xba\xbe":
                raise ValueError("Invalid Java class header: " + name)
        libraries = sorted(n for n in names if n.startswith("BOOT-INF/lib/") and n.endswith(".jar"))
        if not libraries:
            raise ValueError("BOOT-INF/lib contains no dependency JARs")
        for name in libraries:
            with zipfile.ZipFile(io.BytesIO(archive.read(name))) as nested:
                bad = nested.testzip()
                if bad:
                    raise ValueError("Nested dependency CRC error: " + name + ":" + bad)
    print("JAR_INTEGRITY_OK " + json.dumps({
        "bytes": path.stat().st_size, "sha256": sha256,
        "dependency_jars": len(libraries)
    }), flush=True)


def verify_runtime():
    # Tests only installed demo runtime components; does not load a YOLO model.
    for command in (["java", "-version"], ["ffmpeg", "-version"]):
        completed = subprocess.run(command, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, timeout=20, check=True)
        print(completed.stdout.decode("utf-8", "replace").splitlines()[0], flush=True)
    import numpy as np
    import cv2
    frame = np.zeros((16, 16, 3), dtype=np.uint8)
    ok, encoded = cv2.imencode(".png", frame)
    if not ok or cv2.imdecode(encoded, cv2.IMREAD_COLOR).shape != frame.shape:
        raise ValueError("OpenCV encode/decode probe failed")
    root = pathlib.Path("/app/ai-engine")
    if not root.is_dir():
        raise ValueError("AI source directory is missing")
    sources = list(root.rglob("*.py"))
    if not sources:
        raise ValueError("No Python algorithm sources found")
    for source in sources:
        compile(source.read_text(encoding="utf-8-sig"), str(source), "exec")
    print("RUNTIME_SMOKE_OK numpy=" + np.__version__ + " cv2=" + cv2.__version__, flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--jar")
    parser.add_argument("--sha256")
    parser.add_argument("--runtime", action="store_true")
    args = parser.parse_args()
    if not (args.jar or args.runtime):
        parser.error("specify --jar or --runtime")
    if args.runtime:
        verify_runtime()
    if args.jar:
        verify_jar(args.jar, args.sha256)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("VALIDATION_FAILED: " + type(exc).__name__ + ": " + str(exc), file=sys.stderr)
        sys.exit(1)
'@

$oldLocation = Get-Location
$backup = $null
$dc = $null
$applied = $false
$utf8 = [System.Text.UTF8Encoding]::new($false, $true)
try {
    Write-Host "`n[1/8] Preflight: read the real configuration and save recovery information" -ForegroundColor Cyan
    $project = (Resolve-Path -LiteralPath $ProjectPath -ErrorAction Stop).Path
    if ($project.Contains(',')) { throw 'A comma in the project path is not supported by this --mount command.' }
    Set-Location -LiteralPath $project
    $composePath = Join-Path $project 'deploy\docker-compose.yml'
    foreach ($relative in @('deploy\docker-compose.yml','deploy\.env','backend\pom.xml','backend\src','backend\maven-settings.xml')) {
        if (-not (Test-Path -LiteralPath (Join-Path $project $relative))) { throw "Missing: $relative" }
    }
    $dc = @('compose','--env-file','.\deploy\.env','-f','.\deploy\docker-compose.yml')
    $before = Read-DockerJson -ArgsList ($dc + @('config','--format','json'))
    $backendIds = @(Invoke-DockerStep -ArgsList ($dc + @('ps','-a','-q','backend')))
    $mysqlIds = @(Invoke-DockerStep -ArgsList ($dc + @('ps','-a','-q','mysql')))
    if ($backendIds.Count -ne 1 -or $mysqlIds.Count -ne 1) { throw 'Expected exactly one backend and one mysql container for this project.' }
    $backendInfo = @(Read-DockerJson -ArgsList @('inspect',$backendIds[0]))[0]
    $mysqlInfo = @(Read-DockerJson -ArgsList @('inspect',$mysqlIds[0]))[0]
    if ($mysqlInfo.State.Health.Status -ne 'healthy') { throw 'MySQL is not healthy. This repair deliberately does not modify MySQL.' }
    $oldImageId = [string]$backendInfo.Image
    $mainImageTag = [string]$backendInfo.Config.Image
    if ([string]::IsNullOrWhiteSpace($mainImageTag) -or $mainImageTag.Contains('@') -or $mainImageTag.StartsWith('sha256:')) {
        throw 'The backend does not use a normal image tag; stop rather than guessing.'
    }
    foreach ($mount in @($backendInfo.Mounts)) {
        if ($mount.Destination -eq '/app' -or $mount.Destination -eq '/app/server.jar') {
            throw 'A mount is overriding /app or /app/server.jar. Stop rather than overwriting your custom deployment.'
        }
    }
    $webPortSpec = @($before.services.frontend.ports | Where-Object { $_.target -eq 80 -and $_.protocol -eq 'tcp' })
    if ($webPortSpec.Count -ne 1) { throw 'Expected one published HTTP port for frontend.' }
    $webPort = [int]$webPortSpec[0].published
    if ($webPort -lt 1 -or $webPort -gt 65535) { throw 'Invalid web port.' }

    $stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0,6))
    $backup = Join-Path (Split-Path $project -Parent) ('backups\runtime-repair-' + $stamp)
    $buildRoot = Join-Path $backup 'java-source'
    $payload = Join-Path $backup 'payload'
    New-Item -ItemType Directory -Path $buildRoot,$payload -Force | Out-Null
    Copy-Item -LiteralPath $composePath -Destination (Join-Path $backup 'docker-compose.yml.before')
    $originalText = [System.IO.File]::ReadAllText($composePath,$utf8)
    Write-Utf8 -Path (Join-Path $payload 'verify_runtime.py') -Text $validator
    $savedTag = 'zaoyan-backend-saved:' + $stamp
    $candidateTag = 'zaoyan-backend-repaired:' + $stamp
    Invoke-DockerStep -ArgsList @('tag',$oldImageId,$savedTag)
    @{
        project=$project; originalBackendImage=$oldImageId; originalBackendTag=$mainImageTag;
        savedBackendTag=$savedTag; candidateTag=$candidateTag; mysqlContainerId=$mysqlInfo.Id;
        originalComposeSha256=(Get-FileHash -LiteralPath $composePath -Algorithm SHA256).Hash
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backup 'recovery-info.json') -Encoding UTF8
    Write-Host "Backup directory: $backup"

    Write-Host "`n[2/8] Stop only the broken backend; verify the existing Java/Python runtime" -ForegroundColor Cyan
    Invoke-DockerStep -ArgsList ($dc + @('stop','backend'))
    Invoke-DockerStep -ArgsList @('cp',($backendInfo.Id + ':/app/server.jar'),(Join-Path $backup 'server.jar.before'))
    $probeBase = @('run','--rm','--pull=never','--network','none',
        '--mount',"type=bind,source=$payload,target=/repair,readonly",
        '--entrypoint','/opt/zaoyan-venv/bin/python',$savedTag,'/repair/verify_runtime.py')
    Invoke-DockerStep -ArgsList ($probeBase + @('--runtime'))
    # If Java/Python/OpenCV/FFmpeg cannot run, no large reinstall or deletion is attempted.

    Write-Host "`n[3/8] Compile only Java from a fresh local source copy (NO apt, pip, npm)" -ForegroundColor Cyan
    Copy-Item -LiteralPath (Join-Path $project 'backend\pom.xml') -Destination (Join-Path $buildRoot 'pom.xml')
    Copy-Item -LiteralPath (Join-Path $project 'backend\maven-settings.xml') -Destination (Join-Path $buildRoot 'maven-settings.xml')
    Copy-Item -LiteralPath (Join-Path $project 'backend\src') -Destination (Join-Path $buildRoot 'src') -Recurse
    $mavenImage = 'maven:3.9.9-eclipse-temurin-21'
    $mavenBase = @('run','--rm','--platform','linux/amd64','--pull=missing',
        '--memory','2g','--cpus','2','--env','MAVEN_OPTS=-Xmx1024m',
        '--mount',"type=bind,source=$buildRoot,target=/work",
        '--mount','type=volume,source=zaoyan_maven_repair_cache,target=/root/.m2',
        '--workdir','/work','--entrypoint','mvn',$mavenImage)
    Invoke-DockerStep -ArgsList ($mavenBase + @('--version'))
    Invoke-DockerStep -ArgsList ($mavenBase + @('-B','-s','/work/maven-settings.xml','-DskipTests','clean','package'))
    $builtJars = @(Get-ChildItem -LiteralPath (Join-Path $buildRoot 'target') -Filter '*.jar' -File |
        Where-Object { $_.Name -notmatch '-(sources|javadoc|tests)\.jar$' })
    if ($builtJars.Count -ne 1) { throw 'Expected exactly one application JAR. Stop instead of picking a random artifact.' }
    $jarPath = Join-Path $payload 'server.jar'
    Copy-Item -LiteralPath $builtJars[0].FullName -Destination $jarPath
    $jarSha256 = (Get-FileHash -LiteralPath $jarPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ((Get-Item -LiteralPath $jarPath).Length -eq 0) { throw 'The new JAR is empty.' }

    Write-Host "`n[4/8] Verify JAR manifest, executable classes, and outer/nested ZIP CRCs" -ForegroundColor Cyan
    Invoke-DockerStep -ArgsList ($probeBase + @('--jar','/repair/server.jar','--sha256',$jarSha256))
    Write-Utf8 -Path (Join-Path $payload 'Dockerfile') -Text @'
ARG RUNTIME_IMAGE
FROM ${RUNTIME_IMAGE}
COPY --chmod=0644 server.jar /app/server.jar
COPY --chmod=0644 verify_runtime.py /app/zaoyan-verify-runtime.py
RUN ["/opt/zaoyan-venv/bin/python", "/app/zaoyan-verify-runtime.py", "--jar", "/app/server.jar", "--runtime"]
'@

    Write-Host "`n[5/8] Replace only the JAR image layer; verify the EXPORTED image again" -ForegroundColor Cyan
    Invoke-DockerStep -ArgsList @('build','--progress=plain','--pull=false',
        '--build-arg',"RUNTIME_IMAGE=$savedTag",'-t',$candidateTag,$payload)
    Invoke-DockerStep -ArgsList @('run','--rm','--pull=never','--network','none',
        '--entrypoint','/opt/zaoyan-venv/bin/python',$candidateTag,
        '/app/zaoyan-verify-runtime.py','--jar','/app/server.jar','--sha256',$jarSha256,'--runtime')

    Write-Host "`n[6/8] Keep the database network; add a fresh normal bridge for frontend publishing" -ForegroundColor Cyan
    $text = $originalText.Replace("`r`n","`n")
    $frontendMatch = [regex]::Match($text,'(?ms)^  frontend:\n.*?(?=^[A-Za-z_][A-Za-z0-9_-]*:|^  [A-Za-z_][A-Za-z0-9_-]*:\n|\z)')
    if (-not $frontendMatch.Success) { throw 'Cannot isolate the frontend YAML block; no config has been changed.' }
    $segment = $frontendMatch.Value
    $oldNetworks = '    networks: [internal]'
    $newNetworks = '    networks: [internal, web_access_runtime_fix]'
    if ($segment.Contains($oldNetworks)) {
        $segment = $segment.Replace($oldNetworks,$newNetworks)
    } elseif (-not $segment.Contains($newNetworks)) {
        throw 'Custom frontend network definition found; stop rather than replacing it.'
    }
    $oldPort = '      - "${WEB_PORT:-8088}:80"'
    $newPort = '      - "127.0.0.1:${WEB_PORT:-8088}:80"'
    if ($segment.Contains($oldPort)) {
        $segment = $segment.Replace($oldPort,$newPort)
    } elseif (-not $segment.Contains($newPort)) {
        throw 'Custom frontend port definition found; stop rather than overwriting it.'
    }
    $patched = $text.Substring(0,$frontendMatch.Index) + $segment + $text.Substring($frontendMatch.Index+$frontendMatch.Length)
    if (-not ($before.networks.PSObject.Properties.Name -contains 'web_access_runtime_fix')) {
        $topLevelKeys = [regex]::Matches($patched,'(?m)^[A-Za-z_][A-Za-z0-9_-]*:')
        if ($topLevelKeys.Count -eq 0 -or $topLevelKeys[$topLevelKeys.Count-1].Value -ne 'networks:') {
            throw 'The final top-level YAML section is not networks; no config has been changed.'
        }
        $patched = $patched.TrimEnd() + "`n  web_access_runtime_fix:`n    driver: bridge`n    internal: false`n"
    }
    try {
        Write-Utf8 -Path $composePath -Text $patched
        $after = Read-DockerJson -ArgsList ($dc + @('config','--format','json'))
        $oldMysql = $before.services.mysql | ConvertTo-Json -Depth 40 -Compress
        $newMysql = $after.services.mysql | ConvertTo-Json -Depth 40 -Compress
        $oldBackend = $before.services.backend | ConvertTo-Json -Depth 40 -Compress
        $newBackend = $after.services.backend | ConvertTo-Json -Depth 40 -Compress
        $oldVolumes = $before.volumes | ConvertTo-Json -Depth 40 -Compress
        $newVolumes = $after.volumes | ConvertTo-Json -Depth 40 -Compress
        if ($oldMysql -cne $newMysql -or $oldBackend -cne $newBackend -or $oldVolumes -cne $newVolumes) {
            throw 'Unexpected database/backend/volume config change. Restoring original YAML.'
        }
        if ($after.networks.web_access_runtime_fix.internal -eq $true) { throw 'The publishing bridge must not be internal.' }
        $newPortSpec = @($after.services.frontend.ports | Where-Object { $_.target -eq 80 })
        if ($newPortSpec.Count -ne 1 -or $newPortSpec[0].host_ip -ne '127.0.0.1' -or [int]$newPortSpec[0].published -ne $webPort) {
            throw 'The new frontend port mapping failed validation.'
        }
    } catch {
        Copy-Item -LiteralPath (Join-Path $backup 'docker-compose.yml.before') -Destination $composePath -Force
        throw
    }
    Invoke-DockerStep -ArgsList @('tag',$candidateTag,$mainImageTag)
    $applied = $true

    Write-Host "`n[7/8] Recreate ONLY backend and frontend; do not recreate MySQL" -ForegroundColor Cyan
    Invoke-DockerStep -ArgsList ($dc + @('up','-d','--no-build','--pull','never','--no-deps','--force-recreate','backend','frontend'))
    $newBackendIds = @(Invoke-DockerStep -ArgsList ($dc + @('ps','-a','-q','backend')))
    $newFrontendIds = @(Invoke-DockerStep -ArgsList ($dc + @('ps','-a','-q','frontend')))
    if ($newBackendIds.Count -ne 1 -or $newFrontendIds.Count -ne 1) { throw 'The recreated application containers were not found.' }
    $newBackendInfo = @(Read-DockerJson -ArgsList @('inspect',$newBackendIds[0]))[0]
    $candidateInfo = @(Read-DockerJson -ArgsList @('image','inspect',$candidateTag))[0]
    if ($newBackendInfo.Image -ne $candidateInfo.Id) { throw 'The backend is not using the verified new image.' }

    Write-Host "`n[8/8] Check host port + frontend assets + /api/health (up to 180 seconds)" -ForegroundColor Cyan
    Add-Type -AssemblyName System.Net.Http
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.UseProxy = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(5)
    $baseUrl = 'http://127.0.0.1:' + $webPort
    $deadline = [DateTime]::UtcNow.AddSeconds(180)
    $ready = $false
    $lastError = ''
    try {
        while ([DateTime]::UtcNow -lt $deadline) {
            try {
                $indexHtml = $client.GetStringAsync($baseUrl + '/').GetAwaiter().GetResult()
                $healthText = $client.GetStringAsync($baseUrl + '/api/health').GetAwaiter().GetResult()
                $health = $healthText | ConvertFrom-Json -ErrorAction Stop
                if ($health.status -ne 'ok') { throw 'Health endpoint did not report ok.' }
                $asset = [regex]::Match($indexHtml, 'src="(/assets/[^"\s]+\.js)"')
                if (-not $asset.Success) { throw 'Frontend HTML does not contain the expected built JS asset.' }
                $js = $client.GetStringAsync($baseUrl + $asset.Groups[1].Value).GetAwaiter().GetResult()
                if ($js.Length -lt 50 -or $js.TrimStart().StartsWith('<!doctype',[StringComparison]::OrdinalIgnoreCase)) {
                    throw 'Frontend JS asset is missing or contains an HTML error page.'
                }
                $ready = $true
                break
            } catch { $lastError = $_.Exception.Message }
            $state = @(Read-DockerJson -ArgsList @('inspect',$newBackendIds[0]))[0]
            if ($state.State.Status -in @('exited','dead','restarting')) { throw 'Backend failed during startup; its latest log follows below.' }
            Write-Host 'Waiting for the real HTTP response...'
            Start-Sleep -Seconds 3
        }
    } finally {
        $client.Dispose()
        $handler.Dispose()
    }
    if (-not $ready) { throw "HTTP verification failed: $lastError" }
    Start-Sleep -Seconds 3
    $steadyBackend = @(Read-DockerJson -ArgsList @('inspect',$newBackendIds[0]))[0]
    if ($steadyBackend.State.Status -ne 'running' -or $steadyBackend.RestartCount -ne 0) {
        throw 'Backend is not stable after the HTTP check; recent logs follow.'
    }
    $currentMysqlIds = @(Invoke-DockerStep -ArgsList ($dc + @('ps','-a','-q','mysql')))
    if ($currentMysqlIds.Count -ne 1 -or $currentMysqlIds[0] -ne $mysqlInfo.Id) { throw 'MySQL container identity changed unexpectedly.' }
    $currentMysql = @(Read-DockerJson -ArgsList @('inspect',$mysqlInfo.Id))[0]
    if ($currentMysql.State.Health.Status -ne 'healthy') { throw 'MySQL is no longer healthy.' }
    Invoke-DockerStep -ArgsList ($dc + @('ps','-a'))
    Invoke-DockerStep -ArgsList @('port',$newFrontendIds[0],'80/tcp')
    Write-Host "`nVERIFIED: frontend HTML/JS and backend HTTP health are reachable at $baseUrl" -ForegroundColor Green
    Write-Host 'This is a startup check, not an end-to-end test of video recognition or forecasting.'
    Write-Host "Backup / artifact / recovery information: $backup"
    Write-Host 'The verified candidate is tagged with the original backend name. Existing Compose commands still work.'
    Write-Host 'The normal Dockerfile is unchanged. A later --build creates another image and must be validated again.'
} catch {
    Write-Host "`nREPAIR STOPPED: $($_.Exception.Message)" -ForegroundColor Red
    if ($backup) { Write-Host "Backup and build output: $backup" }
    if ($applied -and $dc) {
        Write-Host 'Verified image and frontend network config are retained for inspection; the known-bad image was not restored.'
        try { Invoke-DockerStep -ArgsList ($dc + @('logs','--no-color','--tail','80','backend','frontend')) } catch {}
    }
    Write-Host 'MySQL was not stopped/recreated. No Docker volumes or original images were deleted.'
    throw
} finally {
    Set-Location -LiteralPath $oldLocation.Path
}
