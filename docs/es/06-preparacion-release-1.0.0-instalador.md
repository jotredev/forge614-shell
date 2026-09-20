# 06 — Releases, seguridad y mantenimiento

Como una maleta sellada con etiqueta de envío, un release entrega una versión comprobable sin mezclarla con las pertenencias de otros productos.

## Instalación y actualización

El instalador público descarga el release, verifica su SHA-256 (huella criptográfica para detectar una descarga alterada), instala Shell bajo `~/.forge614/shell/<versión>/` y deja `forge614-shell` como la única entrada de Shell añadida a `PATH`. Requiere Node.js 22.19+, `curl` y una herramienta SHA-256. La guía de uso está en [00](00-instalacion-y-prueba-local-release.md).

Antes de activar Shell, el instalador valida Forge614 Engines en `~/.forge614/engines/` con `detect` y esquema 1. Si hace falta, instala Engines mediante su instalador compatible. Engines no se añade al `PATH` ni se presenta como aplicación para ejecutar directamente.

`forge614-shell update` descarga y activa el último release estable. `forge614-shell uninstall` pide confirmación y elimina solo `~/.forge614/shell/`; Engram, Atlas, Engines y la carpeta padre sobreviven.

## Mantenimiento

Los mantenedores ejecutan `bun run check` antes de empaquetar: typecheck (comprobación estática de TypeScript), pruebas y build (compilación). `bun run bundle:release` crea el archivo del release. La versión publicada debe coincidir con `package.json` y con los assets (archivos descargables) de GitHub Releases.

## Límites

El instalador público actual apunta a macOS y Linux. Windows, paquetes nativos y un dominio propio no están implementados. Ninguna instalación configura asistentes, MCP o memoria por sí sola; la configuración MCP solo aparece como paso posterior y confirmado de `init --product engram`.
