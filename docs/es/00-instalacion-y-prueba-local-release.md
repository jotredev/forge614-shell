# 00 — Instalación, actualización y comandos

Como instalar una herramienta en un banco de trabajo, este proceso coloca Shell donde la terminal puede encontrarlo sin mover las herramientas vecinas.

## Requisitos y primera instalación

### macOS y Linux
En macOS o Linux se necesitan Node.js 22.19 o superior, `curl` y `shasum` o `sha256sum`. Instala el release público con:

```bash
curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash
```

El instalador verifica descargas mediante SHA-256, prepara Shell bajo `~/.forge614/shell/` y asegura una copia compatible de Engines. Abre una terminal nueva y ejecuta `forge614-shell`.

### Windows x64
En Windows se necesitan Windows 10 versión 1803+ o Windows 11 x64, Node.js 22.19 o superior, PowerShell 5.1 o PowerShell 7 (`pwsh`) y `tar.exe`. Los comandos de descarga de abajo también usan `curl.exe`; el instalador utiliza PowerShell para descargar los assets.

Por seguridad, descarga el script instalador oficial como archivo local antes de ejecutarlo; nunca canalices scripts remotos directo a `Invoke-Expression` (`iex`):

```powershell
curl.exe -fsSL -o install.ps1 https://github.com/jotredev/forge614-shell/releases/latest/download/install.ps1
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Latest
Remove-Item install.ps1
```

O si utilizas PowerShell 7 (`pwsh`):

```powershell
curl.exe -fsSL -o install.ps1 https://github.com/jotredev/forge614-shell/releases/latest/download/install.ps1
pwsh -ExecutionPolicy Bypass -File .\install.ps1 -Latest
Remove-Item install.ps1
```

El instalador comprueba la huella criptográfica SHA-256 contra el sidecar `.sha256`, instala Shell bajo `%USERPROFILE%\.forge614\shell\<versión>` (o `$env:FORGE614_HOME\shell\<versión>`), asegura una versión compatible de Forge614 Engines (`forge614-engines.exe` con esquema 1 y la capacidad booleana `fullySupported`), genera el lanzador `forge614-shell.cmd` y añade `shell\bin` al `Path` de usuario. Abre una ventana nueva de PowerShell o Terminal y ejecuta `forge614-shell`.

## Comandos

```text
forge614-shell                    # inicia el selector interactivo
forge614-shell --help             # muestra ayuda
forge614-shell --version          # muestra la versión
forge614-shell update             # actualiza Shell, Engines y Engram (si está instalado)
forge614-shell uninstall          # retira solo Shell tras confirmación
forge614-shell init --product engram
```

`forge614-shell update` también actualiza Forge614 Engines y, si está instalado, Forge614 Engram — cada uno se reporta de forma independiente (actualizado, ya estaba actualizado, no instalado, o falló con un mensaje seguro), y el fallo de uno nunca oculta ni se presenta como éxito del otro; el comando termina con código distinto de cero si alguno de los tres falló.

`--engine claude|codex` es una opción heredada; en un terminal interactivo no evita los selectores. El chat nativo requiere terminal interactiva. El instalador solo conserva un Forge614 Engines existente si `capabilities --agent claude-code` además devuelve `fullySupported` como booleano; si no (o si esa llamada falla), instala el último.

## Inicio y errores frecuentes

Shell consulta Engines y solo ofrece Claude Code y Codex con adaptador de chat. Si Engines falta o no es compatible, reinstala Shell para repararlo; no intentes sustituirlo con detección manual. Si Claude o Codex no está autenticado, usa `/login` (Claude Code) o `/f614:login` (Codex) en Shell y completa el flujo oficial. Si el comando no se encuentra tras instalar, abre una terminal nueva y verifica que la línea de `PATH` añadida por el instalador se haya cargado.

Para inicializar Engram y su integración de memoria con los asistentes, consulta [07](07-inicializacion-engram-y-mcp.md). Para diagnóstico completo, consulta [08](08-diagnostico-y-limites.md).
