#Requires -Version 5.1
<#
.SYNOPSIS
    Suite de verificación nativa en Windows para el instalador y lanzador de Forge614 Shell.
.DESCRIPTION
    Prueba las defensas críticas requeridas para Windows:
    1. Verificación estricta de checksum SHA-256 en -Archive / -Latest.
    2. Preservación intacta de Forge614 Shell ante fallo de Forge614 Engines.
    3. Coincidencia exacta de entrada en PATH y preservación de prefijos y otras herramientas.
    4. Quoting del lanzador .cmd en rutas con espacios y paso de argumentos con espacios.
    5. Preservación de carpetas engram/ y engines/ en instalación y desinstalación.
#>

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$installScript = Join-Path $repoRoot "scripts\install.ps1"
$releaseBundle = Join-Path $repoRoot "scripts\release-bundle.mjs"

if (-not (Test-Path $installScript)) {
    throw "scripts/install.ps1 no encontrado en $installScript"
}

$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$testBase = Join-Path $tempRoot ("forge614-win-test-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $testBase | Out-Null

$originalUserPath = [Environment]::GetEnvironmentVariable("Path", "User")

try {
    Write-Host "=== Construyendo paquete de release para pruebas ==="
    $distRelease = Join-Path $testBase "release"
    & bun $releaseBundle --out $distRelease
    if ($LASTEXITCODE -ne 0) { throw "Fallo al construir release bundle" }

    $archiveFile = (Get-ChildItem -Path $distRelease -Filter "*.tar.gz" | Select-Object -First 1).FullName
    if (-not $archiveFile) { throw "No se encontro el archivo .tar.gz en $distRelease" }
    $checksumFile = "$archiveFile.sha256"
    if (-not (Test-Path $checksumFile)) { throw "No se encontro el sidecar .sha256 en $checksumFile" }

    Write-Host "Paquete de prueba generado en $archiveFile"

    # Preparar fixture local de Forge614 Engines compatible
    $testHome = Join-Path $testBase "home-standard"
    $enginesBin = Join-Path $testHome "engines\bin"
    New-Item -ItemType Directory -Force -Path $enginesBin | Out-Null
    $fakeEnginesExe = Join-Path $enginesBin "forge614-engines.exe"

    # Crear fake compatible de engines usando bun build --compile
    $fakeEnginesTs = Join-Path $testBase "fake-engines.ts"
    @'
const args = process.argv.slice(2);
if (args[0] === "detect") {
    console.log(JSON.stringify({ schemaVersion: 1, agents: [] }));
    process.exit(0);
}
if (args[0] === "capabilities") {
    console.log(JSON.stringify({ schemaVersion: 1, id: "claude-code", supportsMcp: true, fullySupported: true }));
    process.exit(0);
}
process.exit(64);
'@ | Set-Content -Path $fakeEnginesTs -Encoding UTF8

    & bun build $fakeEnginesTs --compile --outfile $fakeEnginesExe
    if ($LASTEXITCODE -ne 0) { throw "Fallo al compilar fake engines binario" }

    # Marcadores en engram/ y engines/
    $engramDir = Join-Path $testHome "engram"
    New-Item -ItemType Directory -Force -Path $engramDir | Out-Null
    Set-Content -Path (Join-Path $engramDir "marker.txt") -Value "engram-data-preserved"
    Set-Content -Path (Join-Path (Join-Path $testHome "engines") "marker.txt") -Value "engines-data-preserved"

    # =========================================================================
    # DEFENSA 1: Verificación de checksum SHA-256
    # =========================================================================
    Write-Host "`n--- [Defensa 1] Verificación de checksum SHA-256 ---"
    $corruptArchive = Join-Path $testBase "corrupted.tar.gz"
    Copy-Item $archiveFile $corruptArchive
    Set-Content -Path "$corruptArchive.sha256" -Value "0000000000000000000000000000000000000000000000000000000000000000  corrupted.tar.gz"

    $checksumFailed = $false
    try {
        $env:FORGE614_HOME = $testHome
        & pwsh -NoProfile -ExecutionPolicy Bypass -File $installScript -Archive $corruptArchive
        if ($LASTEXITCODE -ne 0) { $checksumFailed = $true }
    } catch {
        $checksumFailed = $true
    }
    if (-not $checksumFailed) {
        throw "Defensa 1 FALLO: El instalador acepto un paquete con checksum corrupto."
    }
    if (Test-Path (Join-Path $testHome "shell")) {
        throw "Defensa 1 FALLO: El checksum corrupto modifico Shell."
    }

    $correctHash = (Get-FileHash -LiteralPath $corruptArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -Path "$corruptArchive.sha256" -Value "$correctHash  otro-asset.tar.gz"
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $installScript -Archive $corruptArchive
    if ($LASTEXITCODE -eq 0) {
        throw "Defensa 1 FALLO: Se acepto una huella con nombre de asset distinto."
    }

    Set-Content -Path "$corruptArchive.sha256" -Value "$correctHash  corrupted.tar.gz`n$correctHash  corrupted.tar.gz"
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $installScript -Archive $corruptArchive
    if ($LASTEXITCODE -eq 0) {
        throw "Defensa 1 FALLO: Se acepto un sidecar con dos menciones del mismo asset."
    }

    $env:FORGE614_RELEASE_API_URL = "https://example.com/not-forge614"
    try {
        $rejectedOutput = & pwsh -NoProfile -ExecutionPolicy Bypass -File $installScript -Latest 2>&1
        if ($LASTEXITCODE -eq 0 -or "$rejectedOutput" -notmatch 'Only the official Forge614 URL') {
            throw "Defensa 1 FALLO: Se acepto un servidor HTTPS ajeno a Forge614."
        }
    } finally {
        Remove-Item env:FORGE614_RELEASE_API_URL -ErrorAction SilentlyContinue
    }
    if (Test-Path (Join-Path $testHome "shell")) {
        throw "Defensa 1 FALLO: Un asset invalido modifico Shell."
    }
    Write-Host "Defensa 1 OK: El instalador rechazo el checksum corrupto."

    # =========================================================================
    # DEFENSA 4: Quoting del lanzador y soporte de espacios
    # =========================================================================
    Write-Host "`n--- [Defensa 4] Quoting del lanzador con rutas que contienen espacios ---"
    $homeWithSpaces = Join-Path $testBase "forge 614 home with spaces"
    $enginesBinSpaces = Join-Path $homeWithSpaces "engines\bin"
    New-Item -ItemType Directory -Force -Path $enginesBinSpaces | Out-Null
    Copy-Item $fakeEnginesExe (Join-Path $enginesBinSpaces "forge614-engines.exe")

    $env:FORGE614_HOME = $homeWithSpaces
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $installScript -Archive $archiveFile
    if ($LASTEXITCODE -ne 0) {
        throw "Defensa 4 FALLO: La instalacion en ruta con espacios fallo."
    }

    $launcherSpaces = Join-Path $homeWithSpaces "shell\bin\forge614-shell.cmd"
    if (-not (Test-Path $launcherSpaces)) {
        throw "Defensa 4 FALLO: No se creo el lanzador en $launcherSpaces"
    }

    # Ejecutar con cmd.exe real para validar parsing de batch shims
    $versionOutput = & cmd.exe /c "`"$launcherSpaces`" --version"
    Write-Host "Salida de version con espacios: $versionOutput"
    if ($versionOutput -notmatch "forge614-shell \d+\.\d+\.\d+") {
        throw "Defensa 4 FALLO: El lanzador no reporto version correctamente: $versionOutput"
    }

    $helpOutput = & cmd.exe /c "`"$launcherSpaces`" --help"
    if ($helpOutput -notmatch "Forge614-Shell") {
        throw "Defensa 4 FALLO: El lanzador no mostro la ayuda correctamente."
    }
    $installedVersion = (Get-Content (Join-Path $homeWithSpaces "shell\.active-version") -Raw).Trim()
    $installedCli = Join-Path $homeWithSpaces "shell\$installedVersion\dist\cli.js"
    $originalCli = [System.IO.File]::ReadAllBytes($installedCli)
    try {
        [System.IO.File]::WriteAllText($installedCli, 'console.log(JSON.stringify(process.argv.slice(2)))')
        $argumentOutput = & $launcherSpaces "two words"
        if ($LASTEXITCODE -ne 0 -or "$argumentOutput" -cne '["two words"]') {
            throw "Defensa 4 FALLO: El argumento con espacios cambio al pasar por el .cmd: $argumentOutput"
        }
    } finally {
        [System.IO.File]::WriteAllBytes($installedCli, $originalCli)
    }
    Write-Host "Defensa 4 OK: El lanzador funciona con rutas con espacios y quoting preservado."

    # =========================================================================
    # DEFENSA 2: Preservación de Shell ante fallo de Engines
    # =========================================================================
    Write-Host "`n--- [Defensa 2] Preservación de Shell ante fallo de Engines ---"
    $homeBrokenEngines = Join-Path $testBase "home-broken-engines"
    $brokenEnginesBin = Join-Path $homeBrokenEngines "engines\bin"
    New-Item -ItemType Directory -Force -Path $brokenEnginesBin | Out-Null

    # Poner un engines roto que devuelva error
    $brokenTs = Join-Path $testBase "broken-engines.ts"
    "process.exit(1);" | Set-Content -Path $brokenTs -Encoding UTF8
    & bun build $brokenTs --compile --outfile (Join-Path $brokenEnginesBin "forge614-engines.exe")

    # Primero instalamos Shell con engines valido en este home
    Copy-Item $fakeEnginesExe (Join-Path $brokenEnginesBin "forge614-engines.exe") -Force
    $env:FORGE614_HOME = $homeBrokenEngines
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $installScript -Archive $archiveFile
    if ($LASTEXITCODE -ne 0) { throw "Defensa 2 FALLO: No se pudo preparar la instalacion inicial de Shell." }

    $activeVersionBefore = Get-Content (Join-Path $homeBrokenEngines "shell\.active-version") -Raw
    $activeLauncherBefore = (Get-FileHash -LiteralPath (Join-Path $homeBrokenEngines "shell\bin\forge614-shell.cmd") -Algorithm SHA256).Hash
    $activeCliBefore = (Get-FileHash -LiteralPath (Join-Path $homeBrokenEngines "shell\$($activeVersionBefore.Trim())\dist\cli.js") -Algorithm SHA256).Hash

    # Ahora rompemos engines y hacemos que falle el instalador de engines
    & bun build $brokenTs --compile --outfile (Join-Path $brokenEnginesBin "forge614-engines.exe")
    $enginesFailed = $false
    try {
        $env:FORGE614_HOME = $homeBrokenEngines
        $env:FORGE614_ENGINES_INSTALLER_URL = "http://127.0.0.1:65534/missing-installer.ps1"
        & pwsh -NoProfile -ExecutionPolicy Bypass -File $installScript -Archive $archiveFile
        if ($LASTEXITCODE -ne 0) { $enginesFailed = $true }
    } catch {
        $enginesFailed = $true
    } finally {
        Remove-Item env:FORGE614_ENGINES_INSTALLER_URL -ErrorAction SilentlyContinue
    }

    if (-not $enginesFailed) {
        throw "Defensa 2 FALLO: El instalador continuo a pesar del fallo de Engines."
    }

    # Verificar que la version de Shell sigue intacta
    $activeVersionAfter = Get-Content (Join-Path $homeBrokenEngines "shell\.active-version") -Raw
    if ($activeVersionAfter -ne $activeVersionBefore) {
        throw "Defensa 2 FALLO: La instalacion de Shell fue modificada tras el fallo de Engines."
    }
    $activeLauncherAfter = (Get-FileHash -LiteralPath (Join-Path $homeBrokenEngines "shell\bin\forge614-shell.cmd") -Algorithm SHA256).Hash
    $activeCliAfter = (Get-FileHash -LiteralPath (Join-Path $homeBrokenEngines "shell\$($activeVersionAfter.Trim())\dist\cli.js") -Algorithm SHA256).Hash
    if ($activeLauncherAfter -cne $activeLauncherBefore -or $activeCliAfter -cne $activeCliBefore) {
        throw "Defensa 2 FALLO: El lanzador o el CLI activos cambiaron tras el fallo de Engines."
    }
    Write-Host "Defensa 2 OK: La instalacion activa de Shell se preservo ante fallo de Engines."

    # =========================================================================
    # DEFENSA 3: Coincidencia exacta de PATH y preservación de prefijos
    # =========================================================================
    Write-Host "`n--- [Defensa 3] Coincidencia exacta del PATH y preservación de herramientas ---"
    $homePathTest = Join-Path $testBase "home-path-test"
    $homePathEnginesBin = Join-Path $homePathTest "engines\bin"
    New-Item -ItemType Directory -Force -Path $homePathEnginesBin | Out-Null
    Copy-Item $fakeEnginesExe (Join-Path $homePathEnginesBin "forge614-engines.exe")

    # Marcadores
    New-Item -ItemType Directory -Force -Path (Join-Path $homePathTest "engram") | Out-Null
    Set-Content -Path (Join-Path $homePathTest "engram\marker.txt") -Value "engram-safe"
    Set-Content -Path (Join-Path $homePathTest "engines\marker.txt") -Value "engines-safe"

    $targetBin = Join-Path $homePathTest "shell\bin"
    $similarBin = Join-Path $homePathTest "shell\bin-other"
    $otherToolBin = Join-Path $homePathTest "engines\bin"

    # Sembrar PATH de usuario con prefijo similar y otra herramienta
    $initialPath = "$originalUserPath;$similarBin;$otherToolBin"
    [Environment]::SetEnvironmentVariable("Path", $initialPath, "User")

    $env:FORGE614_HOME = $homePathTest
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $installScript -Archive $archiveFile
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $installScript -Archive $archiveFile # Idempotencia

    $pathAfterInstall = [Environment]::GetEnvironmentVariable("Path", "User")
    $occurrences = ($pathAfterInstall -split ';' | Where-Object { $_ -ieq $targetBin }).Count
    if ($occurrences -ne 1) {
        throw "Defensa 3 FALLO: La instalacion repetida duplico entradas en PATH ($occurrences encontradas)."
    }

    # Desinstalar con -Yes
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $installScript -Uninstall -Yes

    $pathAfterUninstall = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($pathAfterUninstall -split ';' | Where-Object { $_ -ieq $targetBin }) {
        throw "Defensa 3 FALLO: El directorio $targetBin no fue retirado del PATH."
    }
    if (-not ($pathAfterUninstall -split ';' | Where-Object { $_ -ieq $similarBin })) {
        throw "Defensa 3 FALLO: Se retiro indebidamente el prefijo similar $similarBin del PATH."
    }
    if (-not ($pathAfterUninstall -split ';' | Where-Object { $_ -ieq $otherToolBin })) {
        throw "Defensa 3 FALLO: Se retiro indebidamente la otra herramienta $otherToolBin del PATH."
    }

    # Verificar que los marcadores en engram/ y engines/ siguen ahi
    if (-not (Test-Path (Join-Path $homePathTest "engram\marker.txt"))) {
        throw "Defensa 3 FALLO: La desinstalacion borro archivos en engram/"
    }
    if (-not (Test-Path (Join-Path $homePathTest "engines\marker.txt"))) {
        throw "Defensa 3 FALLO: La desinstalacion borro archivos en engines/"
    }

    Write-Host "Defensa 3 OK: PATH exacto respetado, prefijos conservados y otras herramientas intactas."
    Write-Host "`n=== Todas las defensas nativas de Windows pasaron exitosamente ==="
} finally {
    # Restaurar PATH original del usuario bajo cualquier circunstancia
    [Environment]::SetEnvironmentVariable("Path", $originalUserPath, "User")
    Remove-Item -Recurse -Force $testBase -ErrorAction SilentlyContinue
}
