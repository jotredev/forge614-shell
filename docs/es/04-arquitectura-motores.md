# 04 — Arquitectura y motores actuales

Piensa en una central telefónica: Shell atiende y muestra la conversación; Engines identifica qué líneas existen; cada cliente de IA transporta su propia llamada.

## Capas

| Capa | Responsabilidad actual |
| --- | --- |
| CLI (`src/cli.ts`) | Expone ayuda, versión, `update`, `uninstall`, `init` e inicio interactivo. |
| App y UI | Pide el estilo visual y el asistente; renderiza chat, estado y confirmaciones. |
| Infraestructura | Ejecuta los contratos públicos de Engines, Engram, actualización y procesos nativos. |
| Adaptadores | Claude Code, Codex y Antigravity traducen sus protocolos a la interfaz de Shell. |

## Detección y chat

Al iniciar de forma interactiva, Shell ejecuta `~/.forge614/engines/bin/forge614-engines detect` y exige `schemaVersion: 1` (versión del formato de respuesta). Solo muestra `claude-code`, `codex` y `antigravity`, porque son los identificadores con adaptador de chat. Con `--engine claude|codex|antigravity`, Shell consulta `detect` y `capabilities --agent <id>` antes de crear una terminal, elegir idioma o guardar preferencias. Si Engines falta o no responde, Shell muestra `engines-unavailable`; un id no compatible (incluido `pi`), un adaptador ausente o cualquier valor distinto de `fullySupported: true` muestra `engine-not-fully-supported`. No realiza una segunda detección en `PATH` (la lista de programas que el sistema puede ejecutar).

Claude Code usa su flujo oficial de suscripción, Codex usa `app-server` con inicio de sesión ChatGPT y Antigravity usa ACP (`agy acp`, JSON-RPC 2.0 sobre stdio) con suscripción de Google (`agy acp --login`). Todos conservan las credenciales administradas por su cliente nativo y rechazan claves API. `/login` (Claude Code) o `/f614:login` (Codex y Antigravity) reutiliza la cuenta existente o abre el flujo oficial; `/logout` borra únicamente el estado de la sesión de Shell.

## Mecanismos de inicio

Shell tiene tres adaptadores de chat para la conversación interactiva: Claude Code (SDK oficial de Anthropic con una consulta abierta durante toda la conversación), Codex (JSON-RPC sobre `app-server`) y Antigravity (JSON-RPC 2.0 sobre `agy acp`, con catálogo de modelos y niveles de razonamiento `thought_level`, modos de trabajo `default`/`accept-edits`/`auto`/`plan`, streaming, historial/reanudación, tarjetas MCP de Engram `🧠` e inyección de memoria una sola vez vía `_meta.antigravity.systemPrompt.append` solo cuando el hook `SessionStart` no está activo). Shell nunca lanza el binario real de un cliente nativo entregándole la terminal durante `init --product engram` ni para la verificación del hook de memoria; solo delega el inicio de sesión interactivo cuando la persona lo solicita explícitamente (`/login` en Claude Code, `/f614:login` en Antigravity). Si la evidencia de tiempo de ejecución de un hook de memoria realmente se observó es información de estado que reporta Engines, nunca algo que Shell fuerce lanzando un proceso nativo; ver el [documento 07](07-inicializacion-engram-y-mcp.md).

## Qué asistentes lista Shell

Toda lista de asistentes que muestra Shell contiene solo los asistentes que Engines informa como de soporte completo (`fullySupported: true` en `capabilities --agent <id>`); hoy Claude Code, Codex y Antigravity. Decide Engines, nunca Shell. Pi ya no es un motor de chat de Shell; `pi-tui` sigue como biblioteca de interfaz de terminal y `pi-coding-agent` solo se usa para miniaturas. Gemini CLI no tiene directorios, procesos, autenticación ni selector en Shell.

## Regla para asistentes nuevos

La llegada de un asistente nuevo a Forge614 Engines activa tres capacidades distintas. Primero, si Engines lo informa `installed` y `fullySupported: true`, Shell lo descubre y puede ofrecerle la configuración de Engram automáticamente: no hay lista permitida ni cambio de código de Shell. Si `capabilities` no trae `fullySupported` como booleano, el Engines instalado es demasiado viejo y Shell pide `forge614-shell update`; si la llamada misma falla, ese asistente simplemente no se lista. Segundo, poder conversar con él exige siempre un adaptador de chat nuevo (capa que traduce su protocolo a la interfaz): sesión, autenticación, modelos, cancelación, reanudación y una entrada explícita en la lista de adaptadores de Shell; el selector de chat exige el adaptador y el soporte completo. MCP no sustituye ese trabajo.

Tercero, el indicador de herramientas durante el chat solo existe después de tener ese adaptador. Cada protocolo expresa las llamadas de herramientas de una forma propia; se debe investigar en vivo su formato real con Engram configurado antes de escribir la traducción. No existe una detección genérica y segura para todos los asistentes. La regla completa para asistentes de programación está en [`AGENTS.md`](../../AGENTS.md).

## Seguridad de procesos

Los adaptadores rechazan variables de entorno que desvían autenticación o proveedor, como claves API o URL base. Los procesos nativos no imprimen `stderr` sin filtrar porque puede contener ajustes privados. Las aprobaciones y el sandbox dependen del cliente nativo; Shell no promete aislamiento adicional.
