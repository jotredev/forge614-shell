$InstallerArgs = @($args)
$ErrorActionPreference = "Stop"
if ([Console]::IsOutputRedirected -or [Console]::IsErrorRedirected) {
  try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch { }
}
$NodeName = "shell"
$Repo = "jotredev/forge614-shell"

function Get-RootExceptionText {
  param([System.Exception]$Exception)
  $Current = $Exception
  while ($null -ne $Current.InnerException) { $Current = $Current.InnerException }
  return $Current.Message
}

function Get-Sha256 {
  param([string]$Path)
  $Algorithm = [System.Security.Cryptography.SHA256]::Create()
  $Stream = [System.IO.File]::OpenRead($Path)
  try {
    $Bytes = $Algorithm.ComputeHash($Stream)
    return ([System.BitConverter]::ToString($Bytes)).Replace("-", "").ToLowerInvariant()
  } finally {
    $Stream.Dispose()
    $Algorithm.Dispose()
  }
}

function Write-NodeRequirement {
  if ($env:FORGE614_LOCALE -like "en*" -or (-not $env:FORGE614_LOCALE -and $env:FORGE614_SHELL_LOCALE -like "en*")) {
    [Console]::Error.WriteLine("Forge614 requires Node.js 22.19.0 or later to install. Install it with Homebrew: brew install node; on Linux, use your distribution's package manager or https://nodejs.org; on Windows, use winget install OpenJS.NodeJS.LTS or https://nodejs.org. Then run this installer again.")
  } else {
    [Console]::Error.WriteLine("Forge614 necesita Node.js 22.19.0 o posterior para instalarse. Instálalo con Homebrew: brew install node; en Linux, con el gestor de paquetes de tu distribución o desde https://nodejs.org; en Windows, con winget install OpenJS.NodeJS.LTS o desde https://nodejs.org. Después vuelve a ejecutar este instalador.")
  }
}

$NodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $NodeCommand) { Write-NodeRequirement; exit 65 }
$NodeVersion = (& $NodeCommand.Source --version 2>$null).Trim().TrimStart("v")
$VersionParts = $NodeVersion.Split(".")
if ($VersionParts.Count -lt 2 -or [int]$VersionParts[0] -lt 22 -or ([int]$VersionParts[0] -eq 22 -and [int]$VersionParts[1] -lt 19)) {
  Write-NodeRequirement
  exit 65
}

$Tag = "latest"
$TagWasSet = $false
for ($Index = 0; $Index -lt $InstallerArgs.Count; $Index++) {
  if (-not $TagWasSet -and $InstallerArgs[$Index] -eq "--latest") { $Tag = "latest"; $TagWasSet = $true }
  if (-not $TagWasSet -and $InstallerArgs[$Index] -eq "--version") {
    if ($Index + 1 -ge $InstallerArgs.Count) { [Console]::Error.WriteLine("invalid value for --version"); exit 64 }
    $Tag = $InstallerArgs[$Index + 1]
    $TagWasSet = $true
  }
}

$TestBase = $env:FORGE614_INSTALL_TEST_BASE_URL
if ($TestBase) {
  $TestUri = $null
  if ($TestBase -notmatch '^http://(127\.0\.0\.1|\[::1\]):[0-9]+/?$' -or -not [System.Uri]::TryCreate($TestBase, [System.UriKind]::Absolute, [ref]$TestUri) -or $TestUri.Scheme -ne "http" -or $TestUri.Port -lt 1 -or ($TestUri.Host -ne "127.0.0.1" -and $TestUri.Host -ne "[::1]" -and $TestUri.Host -ne "::1") -or $TestUri.AbsolutePath -ne "/" -or $TestUri.Query -or $TestUri.Fragment -or $TestUri.UserInfo) {
    [Console]::Error.WriteLine("FORGE614_INSTALL_TEST_BASE_URL only accepts loopback HTTP.")
    exit 64
  }
  $Base = $TestUri.GetLeftPart([System.UriPartial]::Authority)
} else {
  $Base = "https://github.com/$Repo/releases"
}

$TemporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("forge614-" + [Guid]::NewGuid().ToString("N"))
try {
  [System.IO.Directory]::CreateDirectory($TemporaryDirectory) | Out-Null
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
  if ($Tag -eq "latest") {
    if ($TestBase) { $ApiUrl = "$Base/repos/$Repo/releases/latest" }
    else { $ApiUrl = "https://api.github.com/repos/$Repo/releases/latest" }
    $Release = Invoke-RestMethod -Uri $ApiUrl -Headers @{ Accept = "application/vnd.github+json" } -UseBasicParsing
    $Tag = [string]$Release.tag_name
  }
  if (-not $Tag.StartsWith("v")) { $Tag = "v$Tag" }
  if ($TestBase) { $DownloadBase = "$Base/repos/$Repo/releases/download/$([System.Uri]::EscapeDataString($Tag))" }
  else { $DownloadBase = "$Base/download/$([System.Uri]::EscapeDataString($Tag))" }
  $VersionTag = $Tag.TrimStart("v")
  if ($VersionTag -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') { [Console]::Error.WriteLine("invalid version tag"); exit 64 }
  foreach ($Name in @("install.mjs", "forge614.node.json", "SHA256SUMS")) {
    $Destination = Join-Path $TemporaryDirectory $Name
    Invoke-WebRequest -Uri "$DownloadBase/$Name" -OutFile $Destination -UseBasicParsing
  }
  foreach ($Name in @("install.mjs", "forge614.node.json")) {
    $Matches = @(Get-Content -LiteralPath (Join-Path $TemporaryDirectory "SHA256SUMS") | Where-Object { $_ -match "^([0-9a-f]{64})  $([regex]::Escape($Name))$" })
    if ($Matches.Count -ne 1) { throw "invalid SHA256SUMS entry: $Name" }
    $Expected = $Matches[0].Substring(0, 64)
    $Actual = Get-Sha256 -Path (Join-Path $TemporaryDirectory $Name)
    if ($Expected -ne $Actual) { throw "SHA-256 mismatch: $Name" }
  }
  $env:FORGE614_INSTALL_REPOSITORY = $Repo
  $env:FORGE614_INSTALL_NODE = $NodeName
  & $NodeCommand.Source (Join-Path $TemporaryDirectory "install.mjs") @InstallerArgs
  $InstallerExitCode = $LASTEXITCODE
  exit $InstallerExitCode
} catch {
  [Console]::Error.WriteLine((Get-RootExceptionText -Exception $_.Exception))
  exit 66
} finally {
  if ([System.IO.Directory]::Exists($TemporaryDirectory)) { Remove-Item -LiteralPath $TemporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue }
}
