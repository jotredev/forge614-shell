# 04 — Arquitectura y motores actuales

Piensa en una central telefónica: Shell atiende y muestra la conversación; Engines identifica qué líneas existen; cada cliente de IA transporta su propia llamada.

## Capas

| Capa | Responsabilidad actual |
| --- | --- |
| CLI (`src/cli.ts`) | Expone ayuda, versión, `update`, `uninstall`, `init` e inicio interactivo. |
| App y UI | Pide el estilo visual y el asistente; renderiza chat, estado y confirmaciones. |
| Infraestructura | Ejecuta los contratos públicos de Engines, Engram, actualización y procesos nativos. |
| Adaptadores | Claude Code y Codex traducen sus protocolos a la interfaz de Shell. |

## Detección y chat

Al iniciar de forma interactiva, Shell ejecuta `~/.forge614/engines/bin/forge614-engines detect` y exige `schemaVersion: 1` (versión del formato de respuesta). Solo muestra `claude-code` y `codex`, porque son los únicos identificadores con adaptador de chat. Si Engines falta, es incompatible o devuelve datos inválidos, Shell falla con instrucciones de reparación; no realiza una segunda detección en `PATH` (la lista de programas que el sistema puede ejecutar).

Claude Code usa su flujo oficial de suscripción y Codex usa `app-server` con inicio de sesión ChatGPT. Ambos conservan las credenciales administradas por su cliente nativo. `/login` reutiliza la cuenta existente o abre el flujo oficial; `/logout` borra únicamente el estado de la sesión de Shell.

## Mecanismos de inicio

Shell tiene dos adaptadores de chat para la conversación interactiva: Claude Code (que usa el SDK oficial de Anthropic) y Codex (que usa JSON-RPC sobre `app-server`). Shell nunca lanza el binario real de un cliente nativo entregándole la terminal — ni durante `init --product engram`, ni para la verificación del hook de memoria, ni en ningún otro lugar. Si la evidencia de tiempo de ejecución de un hook de memoria realmente se observó es información de estado que reporta Engines, nunca algo que Shell fuerce lanzando un proceso nativo; ver el [documento 07](07-inicializacion-engram-y-mcp.md).

## Pi, Cursor y motores retirados

`--engine pi` es una ruta heredada para automatización no interactiva. Cursor no es un chat de Shell, aunque Engines puede reportarlo para MCP. Gemini y Antigravity ya no tienen directorios, procesos, autenticación ni selector en Shell.

## Regla para asistentes nuevos

La llegada de un asistente nuevo a Forge614 Engines activa tres capacidades distintas. Primero, si Engines informa `installed` y `supportsMcp: true`, Shell lo descubre y puede ofrecerle el MCP de Engram automáticamente: no hay lista permitida ni cambio de código de Shell. Segundo, poder conversar con él exige siempre un adaptador de chat nuevo (capa que traduce su protocolo a la interfaz): sesión, autenticación, modelos, cancelación, reanudación y una entrada explícita en la lista de adaptadores de Shell. MCP no sustituye ese trabajo.

Tercero, el indicador de herramientas durante el chat solo existe después de tener ese adaptador. Cada protocolo expresa las llamadas de herramientas de una forma propia; se debe investigar en vivo su formato real con Engram configurado antes de escribir la traducción. No existe una detección genérica y segura para todos los asistentes. La regla completa para asistentes de programación está en [`AGENTS.md`](../../AGENTS.md).

## Seguridad de procesos

Los adaptadores rechazan variables de entorno que desvían autenticación o proveedor, como claves API o URL base. Los procesos nativos no imprimen `stderr` sin filtrar porque puede contener ajustes privados. Las aprobaciones y el sandbox dependen del cliente nativo; Shell no promete aislamiento adicional.
