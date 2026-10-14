# 06 — Releases, seguridad y mantenimiento

Como una maleta sellada con etiqueta de envío, un release entrega una versión comprobable sin mezclarla con las pertenencias de otros productos.

## Instalación y actualización

El instalador público descarga el release, verifica su SHA-256 (huella criptográfica para detectar una descarga alterada), instala Shell bajo `~/.forge614/shell/<versión>/` (o `%USERPROFILE%\.forge614\shell\<versión>\` en Windows) y deja el ejecutable (`forge614-shell` en Unix, `forge614-shell.cmd` en Windows) en el `PATH` de usuario. En macOS y Linux requiere Node.js 22.19+, `curl` y una herramienta SHA-256 (`shasum` o `sha256sum`). En Windows x64 requiere Node.js 22.19+, PowerShell (5.1 o `pwsh`) y `tar.exe`; el comando documentado usa `curl.exe` para guardar `install.ps1` localmente antes de ejecutarlo con `-Latest` (evitando canalizar código remoto a `iex`). La guía de uso está en [00](00-instalacion-y-prueba-local-release.md).

Antes de activar Shell, el instalador valida Forge614 Engines en `~/.forge614/engines/` (`%USERPROFILE%\.forge614\engines\` en Windows) con `detect` y esquema 1, comprobando además que `fullySupported` sea booleano. Si hace falta, instala Engines mediante su instalador compatible. Engines no se añade al `PATH` ni se presenta como aplicación para ejecutar directamente.

`forge614-shell update` (o `install.ps1 -Latest`) descarga y activa el último release estable. `forge614-shell uninstall` pide confirmación y elimina solo la carpeta `shell/`; la ejecución directa de `install.ps1 -Uninstall -Yes` omite la confirmación. Engram, Atlas, Engines y la carpeta padre sobreviven intactos.

## Mantenimiento

Los mantenedores ejecutan `bun run check` antes de empaquetar: typecheck (comprobación estática de TypeScript), pruebas y build (compilación). `bun run bundle:release` crea el archivo del release (`forge614-shell-<versión>.tar.gz`, su sidecar `.sha256`, `install.sh` e `install.ps1`). El script `validate-release-bundle.mjs` verifica que el paquete contenga todas las piezas requeridas por ambos instaladores antes de la publicación. La versión publicada debe coincidir con `package.json` y con los assets de GitHub Releases.

## Límites

El instalador público soporta macOS, Linux y Windows x64. Paquetes nativos de distribución (.deb, .rpm, .msi) y un dominio propio no están implementados. Ninguna instalación configura asistentes, MCP o memoria por sí sola; la configuración MCP solo aparece como paso posterior y confirmado de `init --product engram`.
