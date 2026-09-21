# 00 — Instalación, actualización y comandos

Como instalar una herramienta en un banco de trabajo, este proceso coloca Shell donde la terminal puede encontrarlo sin mover las herramientas vecinas.

## Requisitos y primera instalación

En macOS o Linux se necesitan Node.js 22.19 o superior, `curl` y `shasum` o `sha256sum`. Instala el release público con:

```bash
curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash
```

El instalador verifica descargas, prepara Shell bajo `~/.forge614/shell/` y asegura una copia compatible de Engines. Abre una terminal nueva y ejecuta `forge614-shell`.

## Comandos

```text
forge614-shell                    # inicia el selector interactivo
forge614-shell --help             # muestra ayuda
forge614-shell --version          # muestra la versión
forge614-shell update             # instala el último release estable
forge614-shell uninstall          # retira solo Shell tras confirmación
forge614-shell init --product engram
```

`--engine claude|codex|pi` es una opción heredada; en un terminal interactivo no evita los selectores. `pi` solo sirve para automatización no interactiva. El chat nativo requiere terminal interactiva.

## Inicio y errores frecuentes

Shell consulta Engines y solo ofrece Claude Code y Codex con adaptador de chat. Si Engines falta o no es compatible, reinstala Shell para repararlo; no intentes sustituirlo con detección manual. Si Claude o Codex no está autenticado, usa `/login` en Shell y completa el flujo oficial. Si el comando no se encuentra tras instalar, abre una terminal nueva y verifica que la línea de `PATH` añadida por el instalador se haya cargado.

Para inicializar Engram y su integración de memoria con los asistentes, consulta [07](07-inicializacion-engram-y-mcp.md). Para diagnóstico completo, consulta [08](08-diagnostico-y-limites.md).
