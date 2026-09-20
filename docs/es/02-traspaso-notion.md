# 02 — Traspaso a Notion

2026-09-19 · Etapas 01 y 02 · Revisión 13 · [English](../en/02-notion-handoff.md) · [Índice](../../README.md)

**Estado: Documentación local completa y verificada (130 pruebas pasando en 34 archivos, 591 aserciones). Sincronización en Notion de las revisiones 5 a 13 pendiente de publicación.**

## Fuentes de esta entrega

- [README.md](../../README.md): presentación bilingüe, estado de la etapa 02 e índice general (130 pruebas pasando en 34 archivos).
- [00-instalacion-y-prueba-local-release.md](00-instalacion-y-prueba-local-release.md): guía paso a paso desde cero para instalación y actualización pública en macOS y Linux (revisión 6: flujo público de un comando vía `curl | bash`, bootstrap automático de Forge614 Engines v1.0.0, ruta aislada en `~/.forge614/shell/bin/`, aislamiento del PATH, uso opcional de Shell para trabajo diario tras setup y resolución de incidencias de Engines).
- [00-installation-and-local-release-test.md](../en/00-installation-and-local-release-test.md): step-by-step beginner guide for public installation and updates on macOS and Linux (revision 6: one-line public `curl | bash` installation, automatic Forge614 Engines v1.0.0 bootstrap, isolated `~/.forge614/shell/bin/` directory, strict PATH isolation, optional Shell usage after setup, and Engines troubleshooting).
- [01-alcance.md](01-alcance.md): alcance y decisiones en español (revisión 2: alcance actualizado sin gestor interno de proyectos/worktrees).
- [01-scope.md](../en/01-scope.md): alcance equivalente en inglés (revision 2: updated scope).
- [02-traspaso-notion.md](02-traspaso-notion.md) y [02-notion-handoff.md](../en/02-notion-handoff.md): instrucciones y registro de sincronización ES/EN (revisión 13).
- [03-etapa-2-primera-entrega.md](03-etapa-2-primera-entrega.md): primera entrega técnica de la etapa 2 en español.
- [03-stage-2-first-delivery.md](../en/03-stage-2-first-delivery.md): primera entrega técnica de la etapa 2 en inglés.
- [04-arquitectura-motores.md](04-arquitectura-motores.md): arquitectura en capas, adaptadores multimotor, perfiles compartidos, desconexión local /logout y reconexión /login en español (revisión 2 con 130 tests).
- [04-architecture-engines.md](../en/04-architecture-engines.md): layered architecture, multi-engine adapters, shared profiles, local /logout, and /login reconnect in English (revision 2 with 130 tests).
- [05-interfaz-basic-panel-cuotas.md](05-interfaz-basic-panel-cuotas.md): interfaz visual Basic, panel contextual lateral con métricas braille, barra de estado inferior con identidad de proyecto y fijación de versión, modos de trabajo nativos con `Shift+Tab`, descubrimiento de habilidades Codex con `$`, menú de comandos agrupado, recursos de RAM y refresco de cuotas /refresh (revisión 3 con 130 tests).
- [05-basic-ui-sidebar-quotas.md](../en/05-basic-ui-sidebar-quotas.md): Basic visual interface, contextual sidebar with braille metrics, bottom status bar with project identity and pinned version badge, native work modes via `Shift+Tab`, Codex skill discovery via `$`, grouped command menu, RAM resources, and /refresh quota queries (revision 3 with 130 tests).
- [06-preparacion-release-1.0.0-instalador.md](06-preparacion-release-1.0.0-instalador.md): preparación del release público, convención de versiones, generador de bundle autónomo (`scripts/release-bundle.mjs`), instalador por red (`scripts/install.sh`), bootstrap de Forge614 Engines (schema v1), ruta aislada `~/.forge614/shell/bin`, subcomando `forge614-shell update` y flujo para mantenedores (revisión 6 con 130 tests, 591 aserciones).
- [06-release-1.0.0-bundle-installer.md](../en/06-release-1.0.0-bundle-installer.md): public release preparation, versioning conventions, standalone bundle builder (`scripts/release-bundle.mjs`), network installer (`scripts/install.sh`), Forge614 Engines bootstrap (schema v1), isolated `~/.forge614/shell/bin` path, `forge614-shell update`, and maintainer workflow (revision 6 with 130 tests, 591 assertions).

## Mensaje para la IA conectada a Notion

> Publica y sincroniza la documentación de las etapas 01 y 02 de Forge614-Shell en el espacio de Notion bajo AI Engineer / Librerías / Forge614-Shell.
>
> Mantén el índice general bilingüe en la página principal “Forge614-Shell” y las páginas subordinadas ES/EN correspondientes:
> - «00 — Instalación y actualización pública del release» / «00 — Public release installation and updates» (revisión 6: instalación pública con un comando curl, bootstrap automático de Forge614 Engines v1.0.0, ruta aislada en `~/.forge614/shell/bin/`, aislamiento de PATH, trabajo nativo opcional tras setup y troubleshooting completo).
> - «01 — Alcance y decisiones» / «01 — Scope and decisions» (revisión 2).
> - «02 — Traspaso a Notion» / «02 — Notion handoff» (revisión 13).
> - «03 — Primera entrega de la etapa 2» / «03 — Stage 2 first delivery» (revisión 1).
> - «04 — Arquitectura y motores» / «04 — Architecture and engines» (revisión 2, 130 tests).
> - «05 — Interfaz Basic, panel lateral y cuotas» / «05 — Basic UI, sidebar, and quotas» (revisión 3: diseño Forge614, sidebar contextual, recursos RAM, barra de estado con proyecto, Git y versión fija, modos nativos con `Shift+Tab`, habilidades Codex con `$`, menú agrupado, scroll independiente y refresco /refresh).
> - «06 — Preparación de releases e instalador público» / «06 — Release preparation and public installer bundle» (revisión 6: distribución pública en GitHub Releases, instalador de red, integración y bootstrap de Forge614 Engines schema v1, aislamiento de PATH, 3 assets de Shell sin binarios de Engines y flujo de publicación para mantenedores con 130 tests).
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
| Página 00 ES / EN | Pendiente de publicación en Notion |
| Página 01 ES / EN | https://app.notion.com/p/3de21943d129819c9bd2ee1d70d04087 / https://app.notion.com/p/3de21943d12981edad3bd48436fec691 |
| Página 02 ES / EN | https://app.notion.com/p/3de21943d1298125a565e14fdcfca893 / https://app.notion.com/p/3de21943d12981bc916ffdd9e2da9e63 |
| Página 03 ES / EN | https://app.notion.com/p/3de21943d1298141a7cee925a5670e49 / https://app.notion.com/p/3de21943d1298152b26be649f7a630e5 |
| Página 04 ES / EN | https://app.notion.com/p/3de21943d12981ddb85dd51594c81217 / https://app.notion.com/p/3de21943d12981fd91a2e3d8b33d8e10 |
| Página 05 ES / EN | Pendiente de publicación en Notion |
| Página 06 ES / EN | Pendiente de publicación en Notion |
| Revisión publicada en Notion | 4 (Páginas 01 a 04 sincronizadas); Páginas 00, 05, 06 y Rev 5-13 pendientes de publicación |
| Fecha de publicación local | 2026-09-19 |
| Diferencias con el repositorio | Enlaces relativos adaptados a URLs de Notion; analogía maestra e indexación técnica añadidas según estándar ai-engineer-docs. |
| Revisión del usuario | Pendiente de confirmación |
