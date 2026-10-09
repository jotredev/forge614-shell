#Requires -Version 5.1
<#
.SYNOPSIS
    Instalador y lanzador oficial de Forge614 Shell para Windows.
.DESCRIPTION
    Instala o desinstala Forge614 Shell en Windows.
    Permite instalar la última versión oficial (-Latest), un paquete local (-Archive)
    o desinstalar la versión activa (-Uninstall).
.PARAMETER Latest
    Descarga e instala la última versión publicada de Forge614 Shell.
.PARAMETER Archive
    Ruta a un paquete local .tar.gz de Forge614 Shell.
.PARAMETER Uninstall
    Elimina la instalación de Forge614 Shell y retira su directorio bin del PATH de usuario.
.PARAMETER Yes
    Confirma la desinstalación sin solicitar confirmación interactiva.
.PARAMETER Help
    Muestra la ayuda de uso de este script.
#>
[CmdletBinding(DefaultParameterSetName = "Latest")]
param(
    [Parameter(ParameterSetName = "Latest")]
    [switch]$Latest,

    [Parameter(ParameterSetName = "Archive", Mandatory = $true)]
    [string]$Archive,

    [Parameter(ParameterSetName = "Uninstall", Mandatory = $true)]
    [switch]$Uninstall,

    [Parameter(ParameterSetName = "Uninstall")]
    [switch]$Yes,

    [Parameter()]
    [switch]$Help
)

$ErrorActionPreference = "Stop"

# Idioma de presentación del instalador: "en" o "es" (por defecto "en")
$locale = if ($env:FORGE614_SHELL_LOCALE -in @("en", "es")) { $env:FORGE614_SHELL_LOCALE } else { "en" }

function Get-Message {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Key,
        [object[]]$Arguments = @()
    )
    $messages = @{
        "en:usage" = "Usage: install.ps1 [-Latest | -Uninstall [-Yes] | -Archive <forge614-shell-<version>.tar.gz>]"
        "es:usage" = "Uso: install.ps1 [-Latest | -Uninstall [-Yes] | -Archive <forge614-shell-<version>.tar.gz>]"
        "en:requires_command" = "Forge614 Shell requires {0}."
        "es:requires_command" = "Forge614 Shell requiere {0}."
        "en:requires_node_version" = "Forge614 Shell requires Node.js 22.19 or newer."
        "es:requires_node_version" = "Forge614 Shell requiere Node.js 22.19 o más reciente."
        "en:engines_using_compatible" = "Using compatible Forge614 Engines (schema v{0})."
        "es:engines_using_compatible" = "Usando Forge614 Engines compatible (esquema v{0})."
        "en:engines_installing" = "Installing required Forge614 Engines (schema v{0})."
        "es:engines_installing" = "Instalando Forge614 Engines requerido (esquema v{0})."
        "en:engines_download_failed" = "Could not download the Forge614 Engines installer."
        "es:engines_download_failed" = "No se pudo descargar el instalador de Forge614 Engines."
        "en:engines_install_failed" = "Forge614 Engines installation failed; Forge614 Shell was not changed."
        "es:engines_install_failed" = "Falló la instalación de Forge614 Engines; Forge614 Shell no se modificó."
        "en:engines_incompatible" = "Installed Forge614 Engines is not compatible with Forge614 Shell; Forge614 Shell was not changed."
        "es:engines_incompatible" = "El Forge614 Engines instalado no es compatible con Forge614 Shell; Forge614 Shell no se modificó."
        "en:uninstall_removes" = "This removes Forge614 Shell from {0}."
        "es:uninstall_removes" = "Esto elimina Forge614 Shell de {0}."
        "en:uninstall_other_tools_unchanged" = "Engram, Atlas, and other Forge614 tools are unchanged."
        "es:uninstall_other_tools_unchanged" = "Engram, Atlas y otras herramientas de Forge614 no cambian."
        "en:uninstall_continue_prompt" = "Continue? [y/N] "
        "es:uninstall_continue_prompt" = "¿Continuar? [y/N] "
        "en:uninstall_cancelled" = "Uninstall cancelled."
        "es:uninstall_cancelled" = "Desinstalación cancelada."
        "en:uninstall_done" = "Forge614 Shell was uninstalled. Other Forge614 tools are unchanged."
        "es:uninstall_done" = "Forge614 Shell se desinstaló. Las demás herramientas de Forge614 no cambiaron."
        "en:release_metadata_failed" = "Could not download Forge614 Shell release metadata."
        "es:release_metadata_failed" = "No se pudo descargar la información de la versión de Forge614 Shell."
        "en:release_assets_invalid" = "Latest release is missing valid Forge614 Shell assets."
        "es:release_assets_invalid" = "La última versión no tiene archivos válidos de Forge614 Shell."
        "en:download_failed" = "Could not download Forge614 Shell v{0}."
        "es:download_failed" = "No se pudo descargar Forge614 Shell v{0}."
        "en:checksum_download_failed" = "Could not download the Forge614 Shell checksum."
        "es:checksum_download_failed" = "No se pudo descargar la suma de verificación de Forge614 Shell."
        "en:checksum_failed" = "Forge614 Shell download checksum failed."
        "es:checksum_failed" = "Falló la verificación de la descarga de Forge614 Shell."
        "en:archive_not_found" = "Release archive not found: {0}"
        "es:archive_not_found" = "No se encontró el archivo de la versión: {0}"
        "en:archive_invalid" = "Invalid Forge614 Shell release archive."
        "es:archive_invalid" = "El archivo de la versión de Forge614 Shell no es válido."
        "en:version_invalid" = "Invalid Forge614 Shell release version."
        "es:version_invalid" = "La versión de Forge614 Shell no es válida."
        "en:already_active" = "Forge614 Shell v{0} is already active."
        "es:already_active" = "Forge614 Shell v{0} ya está activo."
        "en:installed" = "Installed Forge614 Shell v{0}"
        "es:installed" = "Se instaló Forge614 Shell v{0}"
        "en:configured_path" = "Added {0} to your user PATH."
        "es:configured_path" = "Se añadió {0} a tu PATH de usuario."
        "en:close_reopen_terminal" = "Close and reopen your terminal, then run: forge614-shell"
        "es:close_reopen_terminal" = "Cierra y vuelve a abrir tu terminal, luego ejecuta: forge614-shell"
    }

    $lookupKey = "$locale`:$Key"
    if (-not $messages.ContainsKey($lookupKey)) {
        $lookupKey = "en`:$Key"
    }
    $pattern = $messages[$lookupKey]
    if ($Arguments.Count -gt 0) {
        return [string]::Format($pattern, $Arguments)
    }
    return $pattern
}

if ($Help) {
    Write-Host (Get-Message -Key "usage")
    exit 0
}

# Validación estricta de FORGE614_HOME: no puede ser vacío ni relativo
$rawForgeHome = $env:FORGE614_HOME
if ($null -ne $rawForgeHome) {
    if ([string]::IsNullOrWhiteSpace($rawForgeHome)) {
        throw "FORGE614_HOME cannot be empty or whitespace."
    }
    if (-not [System.IO.Path]::IsPathRooted($rawForgeHome)) {
        throw "FORGE614_HOME must be an absolute path: '$rawForgeHome'"
    }
    $forgeHome = [System.IO.Path]::GetFullPath($rawForgeHome)
} else {
    if (-not $env:USERPROFILE) {
        throw "USERPROFILE environment variable is not defined."
    }
    $forgeHome = Join-Path $env:USERPROFILE ".forge614"
}

# Verificación de URLs seguras: HTTPS obligatorio salvo URLs loopback explícitas en pruebas
function Test-LoopbackUri([string]$UriString) {
    try {
        $uri = [System.Uri]$UriString
        if ($uri.Scheme -ne "http") { return $false }
        if ($uri.Host -notin @("localhost", "127.0.0.1", "::1", "[::1]")) { return $false }
        if ($uri.IsDefaultPort -or $uri.Port -lt 1 -or $uri.Port -gt 65535) { return $false }
        if ($uri.UserInfo -or $uri.Fragment) { return $false }
        return $true
    } catch {
        return $false
    }
}

function Assert-ApprovedUri([string]$UriString, [string]$OfficialUri, [bool]$AllowLoopbackHttp = $false) {
    $uri = $null
    if (-not [System.Uri]::TryCreate($UriString, [System.UriKind]::Absolute, [ref]$uri)) {
        throw "Invalid URL: $UriString"
    }
    if ($uri.AbsoluteUri -ceq $OfficialUri) {
        return
    }
    if ($AllowLoopbackHttp -and (Test-LoopbackUri $UriString)) {
        return
    }
    throw "Only the official Forge614 URL or an HTTP loopback test fixture is permitted: $UriString"
}

# Exige una sola línea de huella para el nombre descargado, sin aceptar otro asset.
function Assert-ArchiveChecksum([string]$ArchivePath, [string]$ChecksumPath, [string]$AssetName) {
    $lines = @((Get-Content -LiteralPath $ChecksumPath -Raw) -split "`r?`n" | Where-Object { $_ -ne "" })
    if ($lines.Count -ne 1) {
        throw (Get-Message -Key "checksum_failed")
    }
    $checksumMatch = [regex]::Match($lines[0], '^([a-f0-9]{64})  ([^\r\n]+)$')
    if (-not $checksumMatch.Success -or $checksumMatch.Groups[2].Value -cne $AssetName) {
        throw (Get-Message -Key "checksum_failed")
    }
    $actualHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($checksumMatch.Groups[1].Value -cne $actualHash) {
        throw (Get-Message -Key "checksum_failed")
    }
}

# Gestión del PATH del usuario en Windows (registro HKCU\Environment)
function Notify-EnvironmentChanged {
    try {
        if (-not ('Forge614Installer.UserEnvironmentNotifier' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Forge614Installer {
    public static class UserEnvironmentNotifier {
        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern IntPtr SendMessageTimeout(
            IntPtr hWnd, uint msg, IntPtr wParam, string lParam,
            uint flags, uint timeout, out IntPtr result);
    }
}
'@ -ErrorAction SilentlyContinue
        }
        if ('Forge614Installer.UserEnvironmentNotifier' -as [type]) {
            $result = [IntPtr]::Zero
            [Forge614Installer.UserEnvironmentNotifier]::SendMessageTimeout(
                [IntPtr]0xffff, 0x001a, [IntPtr]::Zero, 'Environment', 2, 5000, [ref]$result) | Out-Null
        }
    } catch {
        # Notificación no bloqueante
    }
}

function Publish-UserPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Directory
    )
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($null -eq $currentPath) { $currentPath = "" }
    $normalized = $Directory.TrimEnd('\', '/')
    $entries = $currentPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

    foreach ($entry in $entries) {
        if ($entry.TrimEnd('\', '/') -ieq $normalized) {
            # Evita duplicados si la entrada exacta ya existe en el PATH
            return
        }
    }

    $newPath = if ([string]::IsNullOrWhiteSpace($currentPath)) {
        $Directory
    } else {
        "$currentPath;$Directory"
    }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Notify-EnvironmentChanged
}

function Remove-UserPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Directory
    )
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ([string]::IsNullOrWhiteSpace($currentPath)) { return }
    $normalized = $Directory.TrimEnd('\', '/')
    $entries = $currentPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

    $remaining = @()
    $changed = $false
    foreach ($entry in $entries) {
        # Coincidencia exacta: remueve solo la entrada idéntica, preservando prefijos similares u otras herramientas
        if ($entry.TrimEnd('\', '/') -ieq $normalized) {
            $changed = $true
        } else {
            $remaining += $entry
        }
    }

    if ($changed) {
        $newPath = $remaining -join ';'
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Notify-EnvironmentChanged
    }
}

function Assert-PlainDirectory([string]$Directory) {
    if (-not (Test-Path -LiteralPath $Directory)) { return }
    $entry = Get-Item -LiteralPath $Directory -Force
    if (-not $entry.PSIsContainer -or ($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
        throw "Refusing a linked or non-directory Shell destination: $Directory"
    }
}

# Desinstalación de Forge614 Shell
if ($PSCmdlet.ParameterSetName -eq "Uninstall") {
    $shellRoot = Join-Path $forgeHome "shell"
    $binDir = Join-Path $shellRoot "bin"
    Assert-PlainDirectory $shellRoot

    Write-Host (Get-Message -Key "uninstall_removes" -Arguments @($shellRoot))
    Write-Host (Get-Message -Key "uninstall_other_tools_unchanged")

    if (-not $Yes) {
        $prompt = Get-Message -Key "uninstall_continue_prompt"
        Write-Host -NoNewline $prompt
        $answer = Read-Host
        if ($answer -notin @("y", "Y")) {
            Write-Host (Get-Message -Key "uninstall_cancelled")
            exit 0
        }
    }

    if (Test-Path $shellRoot) {
        Remove-Item -LiteralPath $shellRoot -Recurse -Force
    }
    Remove-UserPath -Directory $binDir
    Write-Host (Get-Message -Key "uninstall_done")
    exit 0
}

# Comprobación de prerrequisitos del sistema
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
    throw (Get-Message -Key "requires_command" -Arguments @("tar.exe (Windows 10 1803+ / Windows 11)"))
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw (Get-Message -Key "requires_command" -Arguments @("Node.js 22.19+"))
}

# Verificar versión de Node >= 22.19
$nodeCheck = & node -p "const [a,b]=process.versions.node.split('.').map(Number); a>22||(a===22&&b>=19)?'ok':'old'" 2>$null
if ($LASTEXITCODE -ne 0 -or $nodeCheck -ne "ok") {
    throw (Get-Message -Key "requires_node_version")
}

# Comprobación y aseguramiento de Forge614 Engines antes de alterar Shell
$enginesRoot = Join-Path $forgeHome "engines"
$enginesBin = Join-Path $enginesRoot "bin"
$enginesBinary = Join-Path $enginesBin "forge614-engines.exe"
$enginesSchemaVersion = 1

function Test-EnginesCompatibility {
    if (-not (Test-Path $enginesBinary)) {
        return $false
    }
    try {
        $reportRaw = & $enginesBinary detect 2>$null
        if ($LASTEXITCODE -ne 0) { return $false }
        $report = $reportRaw | ConvertFrom-Json
        if ($report.schemaVersion -ne $enginesSchemaVersion -or -not ($report.agents -is [System.Array])) {
            return $false
        }

        $capabilitiesRaw = & $enginesBinary capabilities --agent claude-code 2>$null
        if ($LASTEXITCODE -ne 0) { return $false }
        $capabilities = $capabilitiesRaw | ConvertFrom-Json
        if ($capabilities.fullySupported -isnot [bool]) {
            return $false
        }

        return $true
    } catch {
        return $false
    }
}

function Ensure-Engines {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TempDirectory
    )
    if (Test-EnginesCompatibility) {
        Write-Host (Get-Message -Key "engines_using_compatible" -Arguments @($enginesSchemaVersion))
        return
    }

    Write-Host (Get-Message -Key "engines_installing" -Arguments @($enginesSchemaVersion))
    $installerUrl = if ($env:FORGE614_ENGINES_INSTALLER_URL) {
        $env:FORGE614_ENGINES_INSTALLER_URL
    } else {
        "https://github.com/jotredev/forge614-engines/releases/latest/download/install.ps1"
    }

    $isLoopback = Test-LoopbackUri $installerUrl
    Assert-ApprovedUri $installerUrl "https://github.com/jotredev/forge614-engines/releases/latest/download/install.ps1" -AllowLoopbackHttp $isLoopback

    $enginesInstallerPath = Join-Path $TempDirectory "forge614-engines-install.ps1"
    try {
        Invoke-WebRequest -Uri $installerUrl -OutFile $enginesInstallerPath -UseBasicParsing
    } catch {
        throw (Get-Message -Key "engines_download_failed")
    }

    $psExe = if (Get-Command pwsh -ErrorAction SilentlyContinue) { "pwsh" } else { "powershell.exe" }

    $prevHome = $env:FORGE614_HOME
    $env:FORGE614_HOME = $forgeHome
    try {
        & $psExe -NoProfile -ExecutionPolicy Bypass -File $enginesInstallerPath -Latest
        if ($LASTEXITCODE -ne 0) {
            throw (Get-Message -Key "engines_install_failed")
        }
    } catch {
        throw (Get-Message -Key "engines_install_failed")
    } finally {
        if ($null -ne $prevHome) { $env:FORGE614_HOME = $prevHome } else { Remove-Item env:FORGE614_HOME -ErrorAction SilentlyContinue }
    }

    if (-not (Test-EnginesCompatibility)) {
        throw (Get-Message -Key "engines_incompatible")
    }
}

$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("forge614-shell-install-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temporary | Out-Null
$releaseVersion = $null

try {
    if ($PSCmdlet.ParameterSetName -eq "Latest") {
        $apiUrl = if ($env:FORGE614_RELEASE_API_URL) {
            $env:FORGE614_RELEASE_API_URL
        } else {
            "https://api.github.com/repos/jotredev/forge614-shell/releases/latest"
        }
        $isLoopback = Test-LoopbackUri $apiUrl
        Assert-ApprovedUri $apiUrl "https://api.github.com/repos/jotredev/forge614-shell/releases/latest" -AllowLoopbackHttp $isLoopback

        try {
            $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "forge614-shell-installer" }
        } catch {
            throw (Get-Message -Key "release_metadata_failed")
        }

        $version = "$($release.tag_name)" -replace "^v", ""
        if ($version -notmatch "^\d+\.\d+\.\d+$") {
            throw (Get-Message -Key "version_invalid")
        }
        $releaseVersion = $version

        $archiveName = "forge614-shell-$version.tar.gz"
        $checksumName = "$archiveName.sha256"

        $archiveAsset = @($release.assets | Where-Object { $_.name -eq $archiveName })
        $checksumAsset = @($release.assets | Where-Object { $_.name -eq $checksumName })

        if ($archiveAsset.Count -ne 1 -or $checksumAsset.Count -ne 1) {
            throw (Get-Message -Key "release_assets_invalid")
        }

        $officialAssetBase = "https://github.com/jotredev/forge614-shell/releases/download/$($release.tag_name)/"
        Assert-ApprovedUri $archiveAsset[0].browser_download_url "$officialAssetBase$archiveName" -AllowLoopbackHttp $isLoopback
        Assert-ApprovedUri $checksumAsset[0].browser_download_url "$officialAssetBase$checksumName" -AllowLoopbackHttp $isLoopback

        $archivePath = Join-Path $temporary $archiveName
        $checksumPath = Join-Path $temporary $checksumName

        try {
            Invoke-WebRequest -Uri $archiveAsset[0].browser_download_url -OutFile $archivePath -UseBasicParsing
        } catch {
            throw (Get-Message -Key "download_failed" -Arguments @($version))
        }

        try {
            Invoke-WebRequest -Uri $checksumAsset[0].browser_download_url -OutFile $checksumPath -UseBasicParsing
        } catch {
            throw (Get-Message -Key "checksum_download_failed")
        }

        # Verificación estricta de SHA-256 antes de modificar la instalación
        Assert-ArchiveChecksum $archivePath $checksumPath $archiveName
    } else {
        if (-not (Test-Path $Archive)) {
            throw (Get-Message -Key "archive_not_found" -Arguments @($Archive))
        }
        $archivePath = (Resolve-Path $Archive).Path

        # Comprobación de sidecar .sha256 si existe
        $sidecarChecksum = "$archivePath.sha256"
        if (Test-Path $sidecarChecksum) {
            Assert-ArchiveChecksum $archivePath $sidecarChecksum ([System.IO.Path]::GetFileName($archivePath))
        }
    }

    # Comprobar los nombres y tipos del paquete antes de extraer contenido.
    $archiveEntries = @(& tar.exe -tzf $archivePath 2>$null)
    if ($LASTEXITCODE -ne 0 -or $archiveEntries.Count -eq 0) {
        throw (Get-Message -Key "archive_invalid")
    }
    $archiveRootName = ($archiveEntries[0] -split '/')[0]
    if ($archiveRootName -notmatch '^forge614-shell-\d+\.\d+\.\d+$') {
        throw (Get-Message -Key "archive_invalid")
    }
    foreach ($entry in $archiveEntries) {
        $parts = $entry -split '/'
        if ($parts[0] -cne $archiveRootName -or $entry.Contains('\') -or $entry.Contains(':') -or
            @($parts | Where-Object { $_ -eq '..' }).Count -gt 0) {
            throw (Get-Message -Key "archive_invalid")
        }
    }
    $verboseEntries = @(& tar.exe -tvzf $archivePath 2>$null)
    if ($LASTEXITCODE -ne 0 -or @($verboseEntries | Where-Object { $_ -match '^[lh]' }).Count -gt 0) {
        throw (Get-Message -Key "archive_invalid")
    }

    # Asegurar Engines compatible ANTES de alterar la instalación de Shell
    Ensure-Engines -TempDirectory $temporary

    # Desempaquetar archivo de release
    $extracted = Join-Path $temporary "extracted"
    New-Item -ItemType Directory -Path $extracted | Out-Null
    tar -xzf $archivePath -C $extracted
    if ($LASTEXITCODE -ne 0) {
        throw (Get-Message -Key "archive_invalid")
    }

    $releaseRoot = Get-Item -LiteralPath (Join-Path $extracted $archiveRootName) -ErrorAction SilentlyContinue
    if (-not $releaseRoot -or -not (Test-Path (Join-Path $releaseRoot.FullName "package.json")) -or -not (Test-Path (Join-Path $releaseRoot.FullName "dist\cli.js"))) {
        throw (Get-Message -Key "archive_invalid")
    }

    $packageJson = Get-Content (Join-Path $releaseRoot.FullName "package.json") -Raw | ConvertFrom-Json
    $version = "$($packageJson.version)"
    if ($version -notmatch "^\d+\.\d+\.\d+$") {
        throw (Get-Message -Key "version_invalid")
    }
    if ($archiveRootName -cne "forge614-shell-$version" -or ($null -ne $releaseVersion -and $releaseVersion -cne $version)) {
        throw (Get-Message -Key "archive_invalid")
    }

    $shellRoot = Join-Path $forgeHome "shell"
    $target = Join-Path $shellRoot $version
    $binDir = Join-Path $shellRoot "bin"
    $activeLauncher = Join-Path $binDir "forge614-shell.cmd"
    $activeVersionFile = Join-Path $shellRoot ".active-version"
    Assert-PlainDirectory $shellRoot
    Assert-PlainDirectory $target

    # Verificar si ya está activa esta versión
    if ((Test-Path $activeLauncher) -and (Test-Path $activeVersionFile) -and (Test-Path $target) -and ((Get-Content $activeVersionFile -Raw).Trim() -eq $version)) {
        Publish-UserPath -Directory $binDir
        Write-Host (Get-Message -Key "already_active" -Arguments @($version))
        exit 0
    }

    # Preparar el paquete y el lanzador antes de reemplazar cualquier versión activa.
    New-Item -ItemType Directory -Force -Path $shellRoot | Out-Null
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null

    $nonce = [Guid]::NewGuid().ToString("N")
    $staged = Join-Path $shellRoot ".$version.installing-$nonce"
    $backup = Join-Path $shellRoot ".$version.backup-$nonce"
    $launcherTemp = Join-Path $binDir ".forge614-shell-$nonce.cmd"
    $launcherBackup = Join-Path $binDir ".forge614-shell-$nonce.backup.cmd"
    $versionTemp = Join-Path $shellRoot ".active-version-$nonce"
    $versionBackup = Join-Path $shellRoot ".active-version-$nonce.backup"
    $templateCandidate = Join-Path $releaseRoot.FullName "forge614-shell.cmd.template"
    if (-not (Test-Path -LiteralPath $templateCandidate)) {
        throw (Get-Message -Key "archive_invalid")
    }
    $launcherBody = (Get-Content -LiteralPath $templateCandidate -Raw) -replace '__VERSION__', $version

    # Asegurar terminación CRLF para scripts batch de Windows.
    $launcherBody = $launcherBody -replace "`r?`n", "`r`n"
    $oldUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $hadTarget = Test-Path -LiteralPath $target
    $hadLauncher = Test-Path -LiteralPath $activeLauncher
    $hadVersionFile = Test-Path -LiteralPath $activeVersionFile
    $newTargetInstalled = $false
    try {
        Move-Item -LiteralPath $releaseRoot.FullName -Destination $staged
        [System.IO.File]::WriteAllText($launcherTemp, $launcherBody, [System.Text.Encoding]::ASCII)
        Set-Content -LiteralPath $versionTemp -Value $version -NoNewline
        if ($hadTarget) { Move-Item -LiteralPath $target -Destination $backup }
        Move-Item -LiteralPath $staged -Destination $target
        $newTargetInstalled = $true
        if ($hadLauncher) { Copy-Item -LiteralPath $activeLauncher -Destination $launcherBackup }
        if ($hadVersionFile) { Copy-Item -LiteralPath $activeVersionFile -Destination $versionBackup }
        Move-Item -LiteralPath $launcherTemp -Destination $activeLauncher -Force
        Move-Item -LiteralPath $versionTemp -Destination $activeVersionFile -Force
        Publish-UserPath -Directory $binDir
    } catch {
        if ($newTargetInstalled -and (Test-Path -LiteralPath $target)) { Remove-Item -LiteralPath $target -Recurse -Force }
        if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $target }
        if ($hadLauncher -and (Test-Path -LiteralPath $launcherBackup)) {
            Copy-Item -LiteralPath $launcherBackup -Destination $activeLauncher -Force
        } elseif (-not $hadLauncher -and (Test-Path -LiteralPath $activeLauncher)) {
            Remove-Item -LiteralPath $activeLauncher -Force
        }
        if ($hadVersionFile -and (Test-Path -LiteralPath $versionBackup)) {
            Copy-Item -LiteralPath $versionBackup -Destination $activeVersionFile -Force
        } elseif (-not $hadVersionFile -and (Test-Path -LiteralPath $activeVersionFile)) {
            Remove-Item -LiteralPath $activeVersionFile -Force
        }
        [Environment]::SetEnvironmentVariable("Path", $oldUserPath, "User")
        throw
    } finally {
        foreach ($leftover in @($staged, $launcherTemp, $versionTemp)) {
            if (Test-Path -LiteralPath $leftover) { Remove-Item -LiteralPath $leftover -Recurse -Force }
        }
    }
    foreach ($oldCopy in @($backup, $launcherBackup, $versionBackup)) {
        if (Test-Path -LiteralPath $oldCopy) { Remove-Item -LiteralPath $oldCopy -Recurse -Force }
    }

    Write-Host (Get-Message -Key "installed" -Arguments @($version))
    Write-Host (Get-Message -Key "configured_path" -Arguments @($binDir))
    Write-Host (Get-Message -Key "close_reopen_terminal")
} finally {
    Remove-Item -Recurse -Force $temporary -ErrorAction SilentlyContinue
}
