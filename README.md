# Forge614-Shell

## Español

Entorno de terminal con chat para programación asistida por IA con soporte multimotor (Claude Code, OpenAI Codex, Antigravity CLI, Google Gemini CLI y Pi heredado) bajo arquitectura en capas. Se apoya en Forge614 Engines como dependencia interna no interactiva para detección y validación de clientes de IA locales. Se ejecuta dentro de la terminal o IDE del usuario (como Orca, Ghostty, iTerm o tmux), manteniendo una sesión activa aislada por cada ruta o worktree de trabajo. Tras completar el setup o configuración en Shell, el usuario es libre de cerrar Shell y trabajar directamente en ADE Orca, Claude Code, Codex u otro cliente nativo. Utiliza los perfiles y credenciales nativas compartidas del sistema, ofreciendo desconexión local de sesión mediante `/logout` sin revocar cuentas externas.

**Estado:** Etapa 02 en curso (interfaz Basic con chat y sidebar contextual, métricas braille, barra de estado inferior con identidad de proyecto y fijación de versión, modos de trabajo nativos con `Shift+Tab`, descubrimiento de habilidades Codex con `$`, refresco de cuotas `/refresh`, scroll independiente, arquitectura en capas, adaptadores multimotor, perfiles compartidos, desconexión local `/logout`, reconexión `/login`, instalador público de un comando vía `curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash`, actualización manual mediante `forge614-shell update` con protección de rollback, bootstrap y validación automática de Forge614 Engines en `~/.forge614/engines/`, ruta aislada de Shell en `~/.forge614/shell/bin/` como única entrada añadida al PATH, e independencia para trabajar en clientes nativos tras el setup; 130 pruebas pasando en 34 archivos). La integración de bootstrap con Engines y la ruta aislada de Shell están preparadas localmente para el próximo release estable de Shell (sin alterar la versión publicada actual). La etapa 2 no está completada; restan interfaz Full estilo Orca/worktrees, instalador para Windows, distribución vía paquetes nativos/dominio web propio, motores locales e integración de memoria Engram diferida al final.

### Índice de documentación

| Nº | Español | English |
| --- | --- | --- |
| 00 | [Instalación y actualización pública del release](docs/es/00-instalacion-y-prueba-local-release.md) | [Public release installation and updates](docs/en/00-installation-and-local-release-test.md) |
| 01 | [Alcance y decisiones](docs/es/01-alcance.md) | [Scope and decisions](docs/en/01-scope.md) |
| 02 | [Traspaso a Notion](docs/es/02-traspaso-notion.md) | [Notion handoff](docs/en/02-notion-handoff.md) |
| 03 | [Primera entrega de la etapa 2](docs/es/03-etapa-2-primera-entrega.md) | [Stage 2 first delivery](docs/en/03-stage-2-first-delivery.md) |
| 04 | [Arquitectura y motores](docs/es/04-arquitectura-motores.md) | [Architecture and engines](docs/en/04-architecture-engines.md) |
| 05 | [Interfaz Basic, panel lateral y cuotas](docs/es/05-interfaz-basic-panel-cuotas.md) | [Basic UI, sidebar, and quotas](docs/en/05-basic-ui-sidebar-quotas.md) |
| 06 | [Preparación de releases e instalador público](docs/es/06-preparacion-release-1.0.0-instalador.md) | [Release preparation and public installer bundle](docs/en/06-release-1.0.0-bundle-installer.md) |

Cada par ES/EN comparte un número estable. Los archivos usan `NN-tema.md`; este README es el índice general. Notion conserva la misma numeración.

El desarrollo avanza por etapas pequeñas: acordar alcance, implementar, verificar, revisar y documentar en español e inglés. La integración opcional con Forge614-Engram se abordará al final.

## English

A multi-engine terminal workspace for AI-assisted programming (Claude Code, OpenAI Codex, Antigravity CLI, Google Gemini CLI, and legacy Pi) built on a layered architecture. It relies on Forge614 Engines as an internal non-interactive dependency for local AI engine discovery and validation. It runs inside the user's terminal or IDE (such as Orca, Ghostty, iTerm, or tmux), maintaining an isolated active session for each working path or worktree. After completing setup or configuration in Shell, the user is free to close Shell and work directly in ADE Orca, Claude Code, Codex, or another native client. It shares existing native system profiles and credentials, providing local session disconnect via `/logout` without revoking external accounts.

**Status:** Stage 02 in progress (Basic split interface with contextual sidebar, braille context ring, bottom status bar with project identity and pinned version badge, native work modes via `Shift+Tab`, Codex skill discovery via `$`, `/refresh` quota queries, independent scrolling, layered architecture, multi-engine adapters, shared profiles, local `/logout`, `/login` reconnect, one-line public curl installer via `curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash`, manual CLI updater via `forge614-shell update` with rollback safety, automatic bootstrap and verification of Forge614 Engines under `~/.forge614/engines/`, isolated Shell path under `~/.forge614/shell/bin/` as the only entry added to PATH, and full freedom to work in native clients after setup; 130 passing tests across 34 files). The automatic Engines bootstrap and isolated Shell PATH are prepared locally for the next stable Shell release (without altering the current published release). Stage 2 is not completed; Full Orca-style workspace manager, Windows installer, package manager/custom domain distribution, local inference engines, and Engram memory integration remain deferred.

The bilingual documentation index above links every document and its translation. Each ES/EN pair shares a stable number. Files use `NN-topic.md`; this README is the main index. Notion preserves the same numbering.

Development proceeds in small stages: agree on scope, implement, verify, review, and document in Spanish and English. Optional Forge614-Engram integration will be addressed last.
