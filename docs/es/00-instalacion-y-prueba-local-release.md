# 00 — Instalación, actualización y comandos

Como instalar una herramienta en un banco de trabajo, este proceso coloca Shell donde la terminal puede encontrarlo sin mover las herramientas vecinas.

## Requisitos y primera instalación

### macOS y Linux
En macOS o Linux se necesitan Node.js 22.19 o superior, `curl` y `shasum` o `sha256sum`. Instala el release público con:

```bash
curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash
```

El portero requiere Node.js 22.19 o superior y verifica `install.mjs` y `forge614.node.json` contra `SHA256SUMS` en formato GNU. Prepara Shell bajo `~/.forge614/shell/<versión>/forge614-shell-<versión>/`, registra la versión activa y asegura Engines compatible. Abre una terminal nueva y ejecuta `forge614-shell`.

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

El portero requiere Node.js 22.19 o superior y verifica `install.mjs` y `forge614.node.json` contra `SHA256SUMS` en formato GNU. Instala Shell bajo `%USERPROFILE%\.forge614\shell\<versión>\forge614-shell-<versión>` (o `$env:FORGE614_HOME\shell\<versión>\forge614-shell-<versión>`), asegura Engines compatible (`fullySupported: true` para Claude Code), crea el lanzador `forge614-shell.cmd` y añade `shell\bin` al `Path` de usuario. Abre una ventana nueva de PowerShell o Terminal y ejecuta `forge614-shell`.

El portero de PowerShell usa las API SHA-256 de .NET y ejecuta `install.mjs` con `-ExecutionPolicy Bypass`, también con Windows PowerShell 5.1.

## Comandos

```text
forge614-shell                    # inicia el selector interactivo
forge614-shell --help             # muestra ayuda
forge614-shell --version          # muestra la versión
forge614-shell --version --json   # imprime el objeto común de versión
forge614-shell update [--version X.Y.Z|vX.Y.Z] [--json]
forge614-shell uninstall          # pregunta antes de borrar Shell, preferencias e historial
forge614-shell uninstall --json   # borra Shell sin preguntar y devuelve JSON
forge614-shell uninstall --self   # informa que Shell no tiene integraciones propias
forge614-shell init --product engram
```

`forge614-shell update` verifica el `install.sh` de la versión elegida contra `SHA256SUMS` estricto y siempre pasa al portero la etiqueta `vX.Y.Z` ya resuelta. También actualiza Forge614 Engines y, si está instalado, Forge614 Engram; cada resultado se reporta por separado y los fallos no se presentan como éxitos. Ejecuta `uninstall` desde fuera de `FORGE614_HOME/shell`; en Windows la orden espera a que termine el portero y solo informa que se eliminó cuando esa carpeta ya no existe. Entrada inválida: código 2; error de actualización o desinstalación: código 1; cancelar el uninstall interactivo: código 130.

Los releases de Shell usan etiquetas `vX.Y.Z`. La versión 1.17.0 también publica una sola vez `forge614-shell-1.17.0.tar.gz.sha256` para que el updater incluido en 1.16.0 pueda verificar y descargar el paquete nuevo; el release siguiente elimina ese sidecar de compatibilidad.

`--engine claude|codex` consulta a Forge614 Engines si el adaptador elegido tiene soporte completo antes de abrir una terminal o guardar preferencias; después Shell pregunta el idioma e inicia ese adaptador. `--engine pi` y otros ids no compatibles fallan con `engine-not-fully-supported`; si no se indica un id explícito compatible, el inicio pregunta qué adaptador abrir. El chat nativo requiere terminal interactiva. El instalador solo conserva un Forge614 Engines existente si `capabilities --agent claude-code` además devuelve `fullySupported` como booleano; si no (o si esa llamada falla), instala el último.

## Inicio y errores frecuentes

Shell consulta Engines y solo ofrece Claude Code y Codex con adaptador de chat. Si Engines falta o no es compatible, reinstala Shell para repararlo; no intentes sustituirlo con detección manual. Si Claude o Codex no está autenticado, usa `/login` (Claude Code) o `/f614:login` (Codex) en Shell y completa el flujo oficial. Si el comando no se encuentra tras instalar, abre una terminal nueva y verifica que la línea de `PATH` añadida por el instalador se haya cargado.

Para inicializar Engram y su integración de memoria con los asistentes, consulta [07](07-inicializacion-engram-y-mcp.md). Para diagnóstico completo, consulta [08](08-diagnostico-y-limites.md).
