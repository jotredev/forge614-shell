# 02 — Traspaso a Notion

2026-09-18 · Etapas 01 y 02 · Revisión 10 · [English](../en/02-notion-handoff.md) · [Índice](../../README.md)

**Estado: Documentación local completa y verificada (124 pruebas pasando en 32 archivos, 567 aserciones). Sincronización en Notion de las revisiones 5, 6, 7, 8, 9 y 10 pendiente por renovación de credenciales OAuth del MCP de Notion.**

## Fuentes de esta entrega

- [README.md](../../README.md): presentación bilingüe, estado de la etapa 02 e índice general (124 pruebas pasando en 32 archivos).
- [00-instalacion-y-prueba-local-release.md](00-instalacion-y-prueba-local-release.md): guía paso a paso desde cero para probar la instalación local en macOS (revisión 3: configuración automática del PATH sin comandos manuales, flujo de descarga de 3 assets desde GitHub Releases para colaboradores, y política de parches inmutables 1.0.1).
- [00-installation-and-local-release-test.md](../en/00-installation-and-local-release-test.md): step-by-step beginner guide for macOS local installation testing (revision 3: automatic PATH configuration with zero manual commands, collaborator 3-asset download workflow from GitHub Releases, and immutable patch policy for 1.0.1).
- [01-alcance.md](01-alcance.md): alcance y decisiones en español (revisión 2: alcance actualizado sin gestor interno de proyectos/worktrees).
- [01-scope.md](../en/01-scope.md): alcance equivalente en inglés (revision 2: updated scope).
- [02-traspaso-notion.md](02-traspaso-notion.md) y [02-notion-handoff.md](../en/02-notion-handoff.md): instrucciones y registro de sincronización ES/EN (revisión 10).
- [03-etapa-2-primera-entrega.md](03-etapa-2-primera-entrega.md): primera entrega técnica de la etapa 2 en español.
- [03-stage-2-first-delivery.md](../en/03-stage-2-first-delivery.md): primera entrega técnica de la etapa 2 en inglés.
- [04-arquitectura-motores.md](04-arquitectura-motores.md): arquitectura en capas, adaptadores multimotor, perfiles compartidos, desconexión local /logout y reconexión /login en español (revisión 2 con 124 tests).
- [04-architecture-engines.md](../en/04-architecture-engines.md): layered architecture, multi-engine adapters, shared profiles, local /logout, and /login reconnect in English (revision 2 with 124 tests).
- [05-interfaz-basic-panel-cuotas.md](05-interfaz-basic-panel-cuotas.md): interfaz visual Basic, panel contextual lateral con métricas braille, barra de estado inferior con identidad de proyecto y fijación de versión `v1.0.0`, modos de trabajo nativos con `Shift+Tab`, descubrimiento de habilidades Codex con `$`, menú de comandos agrupado, recursos de RAM y refresco de cuotas /refresh (revisión 3 con 124 tests).
- [05-basic-ui-sidebar-quotas.md](../en/05-basic-ui-sidebar-quotas.md): Basic visual interface, contextual sidebar with braille metrics, bottom status bar with project identity and pinned `v1.0.0` version badge, native work modes via `Shift+Tab`, Codex skill discovery via `$`, grouped command menu, RAM resources, and /refresh quota queries (revision 3 with 124 tests).
- [06-preparacion-release-1.0.0-instalador.md](06-preparacion-release-1.0.0-instalador.md): preparación del release local 1.0.0, convención de versiones (etiqueta UI `v1.0.0`, tag Git `1.0.0`, release publicado `Forge614 Shell v1.0.0`), generador de bundle autónomo (`scripts/release-bundle.mjs`), instalador con inyección automática de PATH (`scripts/install.sh`), layout versionado en `~/.forge614/`, flujo de descarga y verificación SHA-256 para colaboradores, política de inmutabilidad y flujo de 6 pasos para publicar el parche 1.0.1 (revisión 3 con 124 tests, 567 aserciones).
- [06-release-1.0.0-bundle-installer.md](../en/06-release-1.0.0-bundle-installer.md): release 1.0.0 local preparation, versioning conventions (UI label `v1.0.0`, Git tag `1.0.0`, published release `Forge614 Shell v1.0.0`), standalone bundle builder (`scripts/release-bundle.mjs`), installer with automatic PATH injection (`scripts/install.sh`), versioned layout under `~/.forge614/`, collaborator download and SHA-256 verification workflow, immutability policy, and 6-step patch release workflow for 1.0.1 (revision 3 with 124 tests, 567 assertions).

## Mensaje para la IA conectada a Notion

> Publica y sincroniza la documentación de las etapas 01 y 02 de Forge614-Shell en el espacio de Notion bajo AI Engineer / Librerías / Forge614-Shell.
>
> Mantén el índice general bilingüe en la página principal “Forge614-Shell” y las páginas subordinadas ES/EN correspondientes:
> - «00 — Instalación y prueba local del release» / «00 — Installation and local release test» (revisión 3: guía paso a paso para principiantes en macOS, empaquetado, instalación con inyección automática de PATH sin comandos manuales, descarga de assets desde GitHub Releases para colaboradores, y política de parches inmutables 1.0.1).
> - «01 — Alcance y decisiones» / «01 — Scope and decisions» (revisión 2).
> - «02 — Traspaso a Notion» / «02 — Notion handoff» (revisión 10).
> - «03 — Primera entrega de la etapa 2» / «03 — Stage 2 first delivery» (revisión 1).
> - «04 — Arquitectura y motores» / «04 — Architecture and engines» (revisión 2, 124 tests).
> - «05 — Interfaz Basic, panel lateral y cuotas» / «05 — Basic UI, sidebar, and quotas» (revisión 3: diseño Forge614, sidebar contextual, recursos RAM, barra de estado con proyecto, Git y versión fija `v1.0.0`, modos nativos con `Shift+Tab`, habilidades Codex con `$`, menú agrupado, scroll independiente y refresco /refresh).
> - «06 — Preparación del release 1.0.0 e instalador» / «06 — Release 1.0.0 preparation and installer» (revisión 3: release privado publicado `Forge614 Shell v1.0.0`, convención `v1.0.0` en UI vs `1.0.0` en Git tag, bundle autónomo Node.js, instalador con inyección automática del PATH en shell profiles, descarga para colaboradores con verificación SHA-256, inmutabilidad de tags publicados y flujo de 6 pasos para publicar el parche 1.0.1).
>
> Conserva los números compartidos entre idiomas y enlaza cada página con su traducción y con el índice. Convierte los enlaces relativos del repositorio en enlaces a las páginas correspondientes de Notion.
>
> Distingue estrictamente lo implementado por Shell de lo heredado nativamente de los CLIs/motores upstream y de las tareas pendientes.
>
> Devuelve el enlace del índice y de cada página ES/EN, fecha de publicación, revisión documental publicada y cualquier diferencia respecto de los archivos recibidos.

## Registro de confirmación

| Campo | Valor |
| --- | --- |
| Índice de Notion | https://app.notion.com/p/3de21943d129818b9cd6ca4ab12c44ad |
| Página 00 ES / EN | Pendiente de publicación en Notion (OAuth token revoked) |
| Página 01 ES / EN | https://app.notion.com/p/3de21943d129819c9bd2ee1d70d04087 / https://app.notion.com/p/3de21943d12981edad3bd48436fec691 |
| Página 02 ES / EN | https://app.notion.com/p/3de21943d1298125a565e14fdcfca893 / https://app.notion.com/p/3de21943d12981bc916ffdd9e2da9e63 |
| Página 03 ES / EN | https://app.notion.com/p/3de21943d1298141a7cee925a5670e49 / https://app.notion.com/p/3de21943d1298152b26be649f7a630e5 |
| Página 04 ES / EN | https://app.notion.com/p/3de21943d12981ddb85dd51594c81217 / https://app.notion.com/p/3de21943d12981fd91a2e3d8b33d8e10 |
| Página 05 ES / EN | Pendiente de publicación en Notion (OAuth token revoked) |
| Página 06 ES / EN | Pendiente de publicación en Notion (OAuth token revoked) |
| Revisión publicada en Notion | 4 (Páginas 01 a 04 sincronizadas); Páginas 00, 05, 06 y Rev 5-10 pendientes de reconexión OAuth |
| Fecha de publicación local | 2026-09-18 |
| Diferencias con el repositorio | Enlaces relativos adaptados a URLs de Notion; analogía maestra e indexación técnica añadidas según estándar ai-engineer-docs. |
| Revisión del usuario | Pendiente de confirmación |

