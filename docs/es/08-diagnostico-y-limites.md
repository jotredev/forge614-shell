# 08 — Diagnóstico y límites operativos

Como una lista de averías de automóvil, este documento conecta cada síntoma con el componente que puede resolverlo, sin prometer que una luz apagada sea una reparación.

| Síntoma | Significado y acción |
| --- | --- |
| Engines ausente o esquema incompatible | Reinstala Forge614 Shell para reparar su dependencia; Shell no busca otro ejecutable por su cuenta. |
| No hay asistentes de chat | Instala y autentica Claude Code o Codex; Shell lista solo los asistentes que Engines informa como de soporte completo. |
| `init` sin terminal interactivo | Ejecuta el comando en una terminal real; el flujo requiere selección y confirmación. |
| No hay asistentes para configurar Engram | Ningún asistente instalado respondió `fullySupported: true`; Engram ya puede estar inicializado. |
| Engines necesita actualizarse | El Engines instalado no informa `fullySupported` (anterior a 1.14.0). Ejecuta `forge614-shell update`. |
| Plan MCP bloqueado | Engines rechazó el cambio, por ejemplo por una entrada con el mismo nombre. Lee el motivo mostrado; Shell no fuerza archivos. |
| Resultado `not configured` | El plan o la aplicación falló, o Engines devolvió `applied: false`. Los demás asistentes pueden haber terminado correctamente. |
| Credenciales o URL base en el entorno | El adaptador rechaza desvíos de autenticación. Usa una terminal limpia y el login oficial. |
| Datos de cuotas/contexto ausentes | El cliente nativo no los reportó; Shell no los calcula ni inventa. |
| Aviso «Codex no respondió a la petición de detener…» | `/f614:stop` no recibió respuesta a `turn/interrupt` en 5 segundos: Shell dio el turno por terminado de su lado. Una petición vencida cierra el transporte a propósito, para que nada siga corriendo sin control, y Shell se reconecta solo: vuelve a abrir el app-server de Codex y, si ya había una conversación, la retoma (`thread/resume` con el mismo id; si no había, solo abre una conexión nueva), y el aviso lo dice («…y se reconectó con Codex. Tu conversación sigue aquí.»): sigue trabajando. Solo si no puede reconectarse el aviso termina con «…y cerró la conexión. Reinicia Shell para seguir trabajando.» (una conversación lateral no se reconecta, así que ahí aplica la segunda redacción). Si el aviso dice que Codex no tenía un turno en marcha, Shell no cerró la conexión y normalmente no hace falta reiniciar. |
| Aviso «Codex aceptó la petición de detener pero no terminó el turno…» | Codex confirmó `turn/interrupt`, pero no terminó el turno (`turn/completed`) en 5 segundos: Shell dio el turno por terminado de su lado y no cerró la conexión con Codex. Normalmente no hace falta reiniciar. |
| Una herramienta MCP no muestra 🧠 | Solo `forge614-engram` usa ese indicador. Otros MCP muestran `servidor: herramienta`; un asistente nuevo necesita un adaptador y validación de su protocolo. |
| `init` regresa al prompt sin mostrar nada | Corregido: cualquier falla al entrar o salir de la pantalla alterna ahora fuerza una salida limpia y un mensaje en la terminal normal, con código de salida distinto de cero. Si aún ocurre, ejecuta `FORGE614_SHELL_DEBUG_INIT=1 forge614-shell init --product engram`. El diagnóstico nunca se imprime en pantalla — mezclarlo con el render de la pantalla alterna la corrompe — se escribe en un archivo privado bajo `$FORGE614_HOME/shell/logs/` (o `~/.forge614/shell/logs/`), cuya ruta se imprime una sola vez en la terminal normal al finalizar el comando. El archivo registra estado de TTY, clasificación de teclas (Enter/Esc/Ctrl-D/otra), señales y el motivo exacto de terminación, nunca secretos. |

## Límites conocidos

Shell necesita pruebas manuales con cuentas reales para validar flujos externos y plataformas distintas de macOS/Linux. No hay instalador Windows, gestor de worktrees, motores locales ni interfaz de eliminación MCP. `forge614-ai` aún no posee `forge614 init`.

## Verificación de mantenimiento

Ejecuta desde el repositorio:

```bash
bun run typecheck
bun test
bun run build
```

No hay un verificador documental configurado en `package.json`; la revisión documental comprueba pares ES/EN, enlaces Markdown, mapa Notion y afirmaciones frente al código y las pruebas.
