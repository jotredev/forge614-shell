# 08 — Diagnóstico y límites operativos

Como una lista de averías de automóvil, este documento conecta cada síntoma con el componente que puede resolverlo, sin prometer que una luz apagada sea una reparación.

| Síntoma | Significado y acción |
| --- | --- |
| Engines ausente o esquema incompatible | Reinstala Forge614 Shell para reparar su dependencia; Shell no busca otro ejecutable por su cuenta. |
| No hay asistentes de chat | Instala y autentica Claude Code o Codex; Shell lista solo los asistentes que Engines informa como de soporte completo. |
| `engine-not-fully-supported` | Shell no puede abrir ese id porque Engines no lo informa como compatible en su totalidad o Shell no tiene un adaptador para él. Usa `claude` o `codex` solo si Engines confirma el soporte completo. |
| `init` sin terminal interactivo | Ejecuta el comando en una terminal real; el flujo requiere selección y confirmación. |
| No hay asistentes para configurar Engram | Ningún asistente instalado respondió `fullySupported: true`; Engram ya puede estar inicializado. |
| Engines necesita actualizarse | El Engines instalado no informa `fullySupported` (anterior a 1.14.0). Ejecuta `forge614-shell update`. |
| Plan MCP bloqueado | Engines rechazó el cambio, por ejemplo por una entrada con el mismo nombre. Lee el motivo mostrado; Shell no fuerza archivos. |
| Resultado `not configured` | El plan o la aplicación falló, o Engines devolvió `applied: false`. Los demás asistentes pueden haber terminado correctamente. |
| Credenciales o URL base en el entorno | El adaptador rechaza desvíos de autenticación. Usa una terminal limpia y el login oficial. |
| Datos de cuotas/contexto ausentes | El cliente nativo no los reportó; Shell no los calcula ni inventa. |
| El botón `Copiar` de un bloque copia texto ajeno o el doble clic selecciona una palabra | Shell fija el bloque al presionar y consume el resto del gesto. Un doble clic rápido vuelve a copiar ese bloque; arrastrar o desplazar el chat después de presionar no cambia el texto copiado. La selección manual fuera del botón sigue terminando al soltar. |
| Aviso «Enviado a la terminal para copiar…» | El programa del sistema no confirmó la copia, así que Shell envió OSC 52 a la terminal. Puede no pegar si la terminal no permite esa secuencia; prueba pegar en la aplicación de destino. Si aparece «No se pudo copiar», tampoco se pudo escribir la secuencia en la terminal. |
| Aviso «Codex no respondió a la petición de detener…» | `/f614:stop` no recibió respuesta a `turn/interrupt` en 5 segundos: Shell dio el turno por terminado de su lado. Una petición vencida cierra el transporte a propósito, para que nada siga corriendo sin control, y Shell se reconecta solo: vuelve a abrir el app-server de Codex y, si ya había una conversación, la retoma (`thread/resume` con el mismo id; si no había, solo abre una conexión nueva), y el aviso lo dice («…y se reconectó con Codex. Tu conversación sigue aquí.»): sigue trabajando. Solo si no puede reconectarse el aviso termina con «…y cerró la conexión. Reinicia Shell para seguir trabajando.» (una conversación lateral no se reconecta, así que ahí aplica la segunda redacción). Si el aviso dice que Codex no tenía un turno en marcha, Shell no cerró la conexión y normalmente no hace falta reiniciar. |
| Aviso «Codex aceptó la petición de detener pero no terminó el turno…» | Codex confirmó `turn/interrupt`, pero no terminó el turno (`turn/completed`) en 5 segundos: Shell dio el turno por terminado de su lado y no cerró la conexión con Codex. Normalmente no hace falta reiniciar. |
| Aviso «Turno detenido: Claude Code no respondió a la detención en 5 segundos…» | `/f614:stop` interrumpe a Claude Code sin cerrarlo; si no termina el turno en 5 segundos, Shell lo cierra y lo abre de nuevo en segundo plano con la misma conversación (si ya había una). Las tareas en segundo plano que corrían quedan «interrumpida». Sale solo si había un mensaje tuyo esperando. No hace falta reiniciar Shell. |
| Aviso «Turno detenido: Claude Code se cerró antes de poder responder.» | Claude Code se cerró antes de contestar un mensaje tuyo: lo detuviste mientras Claude Code aún se abría, o hiciste `/logout` con un mensaje esperando. Envía el mensaje de nuevo. |
| Una herramienta MCP no muestra 🧠 | Solo `forge614-engram` usa ese indicador. Otros MCP muestran `servidor: herramienta`; un asistente nuevo necesita un adaptador y validación de su protocolo. |
| `init` regresa al prompt sin mostrar nada | Corregido: cualquier falla al entrar o salir de la pantalla alterna ahora fuerza una salida limpia y un mensaje en la terminal normal, con código de salida distinto de cero. Si aún ocurre, ejecuta `FORGE614_SHELL_DEBUG_INIT=1 forge614-shell init --product engram`. El diagnóstico nunca se imprime en pantalla — mezclarlo con el render de la pantalla alterna la corrompe — se escribe en un archivo privado bajo `$FORGE614_HOME/shell/logs/` (o `~/.forge614/shell/logs/`), cuya ruta se imprime una sola vez en la terminal normal al finalizar el comando. El archivo registra estado de TTY, clasificación de teclas (Enter/Esc/Ctrl-D/otra), señales y el motivo exacto de terminación, nunca secretos. |
| `Cmd+V` en la Terminal de macOS no pega una imagen | Con una imagen en el portapapeles, la Terminal de macOS no le manda nada al programa (ni siquiera un pegado vacío), así que Shell no puede reaccionar. Usa `Ctrl+V` en la caja de escribir (`Alt+V` en Windows); donde no corre Orca, la caja vacía lo recuerda en gris. Orca sí pega la ruta de la imagen con `Cmd+V`. |
| «No hay una imagen en el portapapeles» | `Ctrl+V` (`Alt+V` en Windows) no encontró una imagen en el portapapeles (un texto copiado no cuenta). Copia una captura, por ejemplo con `Cmd+Ctrl+Shift+4` en macOS, y vuelve a pulsarlo. |
| «No se pudo leer el portapapeles: instala wl-clipboard» (o `xclip`) | En Linux Shell lee el portapapeles con `wl-paste` (paquete `wl-clipboard`, Wayland) o `xclip` (X11) y ninguno está instalado; instala el de tu sesión. Si no se sabe la sesión, el aviso dice «wl-clipboard o xclip». |
| «La imagen del portapapeles pesa más de 20 MB» | El tope de una imagen, pegada o escrita como ruta, es de 20 MB; una más pesada no se dibuja (una ruta de ese tamaño sale solo como línea gris). |
| «No se pudo leer la imagen del portapapeles» | El programa que lee el portapapeles falló, no contestó en 5 segundos o entregó algo que no es una imagen. Vuelve a copiarla e inténtalo de nuevo. |
| No hay miniatura, solo la línea gris `🖼 nombre · W×H · KB` | La terminal no muestra imágenes en el chat: la Terminal de macOS, iTerm2 (pi-tui apaga su protocolo en la pantalla alterna, también con `FORGE614_SHELL_IMAGES=iterm2`), Windows Terminal, VS Code y otras. Con Orca, kitty, Ghostty, WezTerm o Warp sí hay miniatura. En una terminal que entiende el protocolo kitty, prueba `FORGE614_SHELL_IMAGES=kitty`. Mientras la miniatura se prepara también se ve solo la línea gris. |
| Bajo tmux o screen no hay miniaturas | Esos programas no pasan los gráficos a la terminal, así que Shell no los dibuja ahí, aunque la terminal de fuera sí pueda. Solo se ve la línea gris. |
| Una miniatura desaparece entera al subir el chat | Cuando la primera fila de una miniatura sale por arriba del chat, pi-tui quita la imagen completa (solo la recorta cuando sale por abajo). Vuelve a bajar para verla. |
| Una ruta de imagen muy larga no es un enlace | Una ruta que ocupa varios renglones deja de ser un enlace con clic en el texto; la imagen se detecta igual y su línea gris sí lleva el enlace. |

## Límites conocidos

Windows x64 cuenta con instalador oficial (`install.ps1`) y lanzador nativo (`forge614-shell.cmd`), verificados de forma continua en CI nativa (`windows-latest`) junto con macOS y Linux. No obstante, el chat interactivo con cuentas reales de asistentes (Claude Code, Codex) y emuladores de terminal concretos aún requiere comprobación manual con cuentas externas. Shell no incluye gestor de worktrees, motores locales ni interfaz de eliminación MCP. `forge614-ai` aún no posee `forge614 init`.

## Verificación de mantenimiento

Ejecuta desde el repositorio:

```bash
bun run typecheck
bun test
bun run build
```

No hay un verificador documental configurado en `package.json`; la revisión documental comprueba pares ES/EN, enlaces Markdown, mapa Notion y afirmaciones frente al código y las pruebas.
