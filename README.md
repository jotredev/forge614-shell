# Forge614-Shell

## Español

Entorno de terminal con chat para programación asistida por IA con soporte multimotor (Claude Code, OpenAI Codex, Antigravity CLI, Google Gemini CLI y Pi heredado) bajo arquitectura en capas. Se ejecuta dentro de la terminal o IDE del usuario (como Orca, Ghostty, iTerm o tmux), manteniendo una sesión activa aislada por cada ruta o worktree de trabajo. Utiliza los perfiles y credenciales nativas compartidas del sistema, ofreciendo desconexión local de sesión mediante `/logout` sin revocar cuentas externas.

**Estado:** Etapa 02 en curso (interfaz Basic con chat y sidebar contextual, métricas braille, barra de estado inferior con identidad de proyecto y fijación de versión `v1.0.0`, modos de trabajo nativos con `Shift+Tab`, descubrimiento de habilidades Codex con `$`, refresco de cuotas `/refresh`, scroll independiente, arquitectura en capas, adaptadores multimotor, perfiles compartidos, desconexión local `/logout`, reconexión `/login` y preparación del release 1.0.0 con bundle autónomo e instalador local; 124 pruebas pasando en 32 archivos). La etapa 2 no está completada; restan interfaz Full estilo Orca/worktrees, distribución remota de releases, motores locales e integración de memoria Engram diferida al final.

### Índice de documentación

| Nº | Español | English |
| --- | --- | --- |
| 01 | [Alcance y decisiones](docs/es/01-alcance.md) | [Scope and decisions](docs/en/01-scope.md) |
| 02 | [Traspaso a Notion](docs/es/02-traspaso-notion.md) | [Notion handoff](docs/en/02-notion-handoff.md) |
| 03 | [Primera entrega de la etapa 2](docs/es/03-etapa-2-primera-entrega.md) | [Stage 2 first delivery](docs/en/03-stage-2-first-delivery.md) |
| 04 | [Arquitectura y motores](docs/es/04-arquitectura-motores.md) | [Architecture and engines](docs/en/04-architecture-engines.md) |
| 05 | [Interfaz Basic, panel lateral y cuotas](docs/es/05-interfaz-basic-panel-cuotas.md) | [Basic UI, sidebar, and quotas](docs/en/05-basic-ui-sidebar-quotas.md) |
| 06 | [Preparación del release 1.0.0 e instalador](docs/es/06-preparacion-release-1.0.0-instalador.md) | [Release 1.0.0 preparation and installer](docs/en/06-release-1.0.0-bundle-installer.md) |

Cada par ES/EN comparte un número estable. Los archivos usan `NN-tema.md`; este README es el índice general. Notion conserva la misma numeración.

El desarrollo avanza por etapas pequeñas: acordar alcance, implementar, verificar, revisar y documentar en español e inglés. La integración opcional con Forge614-Engram se abordará al final.

## English

A multi-engine terminal workspace for AI-assisted programming (Claude Code, OpenAI Codex, Antigravity CLI, Google Gemini CLI, and legacy Pi) built on a layered architecture. It runs inside the user's terminal or IDE (such as Orca, Ghostty, iTerm, or tmux), maintaining an isolated active session for each working path or worktree. It shares existing native system profiles and credentials, providing local session disconnect via `/logout` without revoking external accounts.

**Status:** Stage 02 in progress (Basic split interface with contextual sidebar, braille context ring, bottom status bar with project identity and pinned `v1.0.0` version, native work modes via `Shift+Tab`, Codex skill discovery via `$`, `/refresh` quota queries, independent scrolling, layered architecture, multi-engine adapters, shared profiles, local `/logout`, `/login` reconnect, and 1.0.0 release preparation with standalone bundle and local installer; 124 passing tests across 32 files). Stage 2 is not completed; Full Orca-style workspace manager, remote release distribution, local inference engines, and Engram memory integration remain deferred.

The bilingual documentation index above links every document and its translation. Each ES/EN pair shares a stable number. Files use `NN-topic.md`; this README is the main index. Notion preserves the same numbering.

Development proceeds in small stages: agree on scope, implement, verify, review, and document in Spanish and English. Optional Forge614-Engram integration will be addressed last.
