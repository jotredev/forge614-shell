# 06 — Releases, seguridad y mantenimiento

Como una maleta sellada con etiqueta de envío, un release entrega una versión comprobable sin mezclarla con las pertenencias de otros productos.

## Instalación y actualización

El portero público requiere Node.js 22.19+, verifica `install.mjs` y `forge614.node.json` con `SHA256SUMS` en formato GNU, instala Shell bajo `~/.forge614/shell/<versión>/forge614-shell-<versión>/` (o `%USERPROFILE%\.forge614\shell\<versión>\forge614-shell-<versión>` en Windows) y deja el lanzador estable en el `PATH` del usuario. En Windows usa PowerShell 5.1 o `pwsh` con `-ExecutionPolicy Bypass`. La guía de uso está en [00](00-instalacion-y-prueba-local-release.md).

Antes de activar Shell, el instalador valida Forge614 Engines en `~/.forge614/engines/` (`%USERPROFILE%\.forge614\engines\` en Windows) con `detect` y esquema 1, comprobando además que `fullySupported` sea booleano. Si hace falta, instala Engines mediante su instalador compatible. Engines no se añade al `PATH` ni se presenta como aplicación para ejecutar directamente.

Los releases usan etiquetas `vX.Y.Z`. `forge614-shell --version` imprime `forge614-shell <versión>`; con `--json` devuelve `{"schemaVersion":1,"name":"forge614-shell","version":"<versión>"}`. `forge614-shell update [--version X.Y.Z|vX.Y.Z] [--json]` descarga y verifica el portero de la versión resuelta, y activa esa versión. Shell también actualiza Engines y Engram cuando están instalados. `forge614-shell uninstall` pide confirmación y elimina toda la carpeta `shell/`, incluidas las preferencias y el historial; `uninstall --json` no pregunta y `uninstall --self` informa que Shell no tiene integraciones externas. Engram, Atlas, Engines y la carpeta padre permanecen intactos.

El release 1.17.0 publica una vez `forge614-shell-1.17.0.tar.gz.sha256` para que el actualizador anterior de 1.16.0 valide el archivo nuevo. El siguiente release quitará ese sidecar de compatibilidad; los porteros nuevos usan `SHA256SUMS`.

## Mantenimiento

Los mantenedores ejecutan `bun run typecheck`, `bun test`, `bun run build` y `git diff --check`. `bun run bundle:release` crea el paquete Node con los lanzadores POSIX y Windows; `scripts/prepare-release-assets.mjs` agrega los porteros comunes y la ficha del nodo, y escribe `SHA256SUMS`. El workflow valida que la etiqueta `vX.Y.Z` coincida con `package.json` y publica siete assets para 1.17.0.

## Límites

El instalador público soporta macOS, Linux y Windows x64. Paquetes nativos de distribución (.deb, .rpm, .msi) y un dominio propio no están implementados. Ninguna instalación configura asistentes, MCP o memoria por sí sola; la configuración MCP solo aparece como paso posterior y confirmado de `init --product engram`.
