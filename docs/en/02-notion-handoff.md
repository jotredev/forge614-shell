# 02 — Notion handoff

2026-09-18 · Stages 01 and 02 · Revision 11 · [Español](../es/02-traspaso-notion.md) · [Index](../../README.md)

**Status: Local documentation complete and verified (124 tests passing across 32 files, 567 assertions). Notion synchronization for revisions 5, 6, 7, 8, 9, 10, and 11 pending Notion MCP OAuth credential renewal.**

## Sources for this delivery

- [README.md](../../README.md): bilingual presentation, stage 02 status, and general index (124 tests passing across 32 files).
- [00-instalacion-y-prueba-local-release.md](../es/00-instalacion-y-prueba-local-release.md): step-by-step beginner guide for authorized collaborators on macOS and Linux (revision 4: definitive 15-step workflow for private repositories, reference version `1.0.1`, system requirements, what collaborators cannot do yet, SHA-256 validation, and AI tool pre-authentication).
- [00-installation-and-local-release-test.md](00-installation-and-local-release-test.md): step-by-step beginner guide for authorized collaborators on macOS and Linux (revision 4: definitive 15-step workflow for private repositories, reference version `1.0.1`, system requirements, what collaborators cannot do yet, SHA-256 validation, and AI tool pre-authentication).
- [01-alcance.md](../es/01-alcance.md): scope and decisions in Spanish (revision 2: updated scope without internal workspace manager).
- [01-scope.md](01-scope.md): equivalent scope in English (revision 2: updated scope).
- [02-traspaso-notion.md](../es/02-traspaso-notion.md) and [02-notion-handoff.md](02-notion-handoff.md): sync instructions and record in ES/EN (revision 11).
- [03-etapa-2-primera-entrega.md](../es/03-etapa-2-primera-entrega.md): first technical delivery for stage 2 in Spanish.
- [03-stage-2-first-delivery.md](03-stage-2-first-delivery.md): first technical delivery for stage 2 in English.
- [04-arquitectura-motores.md](../es/04-arquitectura-motores.md): layered architecture, multi-engine adapters, shared profiles, local /logout, and /login reconnect in Spanish (revision 2 with 124 tests).
- [04-architecture-engines.md](04-architecture-engines.md): layered architecture, multi-engine adapters, shared profiles, local /logout, and /login reconnect in English (revision 2 with 124 tests).
- [05-interfaz-basic-panel-cuotas.md](../es/05-interfaz-basic-panel-cuotas.md): Basic visual interface, contextual sidebar with braille metrics, bottom status bar with project identity and pinned `v1.0.1` version badge, native work modes via `Shift+Tab`, Codex skill discovery via `$`, grouped command menu, RAM resources, and /refresh quota queries in Spanish (revision 3 with 124 tests).
- [05-basic-ui-sidebar-quotas.md](05-basic-ui-sidebar-quotas.md): Basic visual interface, contextual sidebar with braille metrics, bottom status bar with project identity and pinned `v1.0.1` version badge, native work modes via `Shift+Tab`, Codex skill discovery via `$`, grouped command menu, RAM resources, and /refresh quota queries in English (revision 3 with 124 tests).
- [06-preparacion-release-1.0.0-instalador.md](../es/06-preparacion-release-1.0.0-instalador.md): release preparation, versioning conventions (UI label `v1.0.1`, Git tag `1.0.1`, published release `Forge614 Shell v1.0.1`), standalone bundle builder (`scripts/release-bundle.mjs`), installer with automatic PATH injection (`scripts/install.sh`), versioned layout under `~/.forge614/`, maintainer workflow, and link to collaborator guide (revision 4 with 124 tests, 567 assertions).
- [06-release-1.0.0-bundle-installer.md](06-release-1.0.0-bundle-installer.md): release preparation, versioning conventions (UI label `v1.0.1`, Git tag `1.0.1`, published release `Forge614 Shell v1.0.1`), standalone bundle builder (`scripts/release-bundle.mjs`), installer with automatic PATH injection (`scripts/install.sh`), versioned layout under `~/.forge614/`, maintainer workflow, and link to collaborator guide (revision 4 with 124 tests, 567 assertions).

## Prompt for Notion-connected agent

> Publish and synchronize documentation for stages 01 and 02 of Forge614-Shell inside the Notion workspace under AI Engineer / Librerías / Forge614-Shell.
>
> Maintain the bilingual general index on the main "Forge614-Shell" page and the corresponding child ES/EN pages:
> - "00 — Instalación y prueba local del release" / "00 — Installation and local release test" (revision 4: definitive 15-step workflow for private repositories, reference version `1.0.1`, system requirements, negative scope, SHA-256 validation, and launch with pre-authenticated AI tools).
> - "01 — Alcance y decisiones" / "01 — Scope and decisions" (revision 2).
> - "02 — Traspaso a Notion" / "02 — Notion handoff" (revision 11).
> - "03 — Primera entrega de la etapa 2" / "03 — Stage 2 first delivery" (revision 1).
> - "04 — Arquitectura y motores" / "04 — Architecture and engines" (revision 2, 124 tests).
> - "05 — Interfaz Basic, panel lateral y cuotas" / "05 — Basic UI, sidebar, and quotas" (revision 3: Forge614 styling, contextual sidebar, RAM resources, bottom status bar with project, Git, and pinned `v1.0.1` version badge, native modes with `Shift+Tab`, Codex skills with `$`, grouped menu, independent scrolling, and /refresh).
> - "06 — Preparación del release 1.0.0 e instalador" / "06 — Release 1.0.0 preparation and installer" (revision 4: published private release `Forge614 Shell v1.0.1`, `v1.0.1` UI label vs `1.0.1` Git tag, standalone Node.js bundle, installer with automatic PATH injection into shell profiles, maintainer workflow, and link to collaborator guide).
>
> Preserve shared numbers across languages and link each page with its translation and the index. Convert repository relative links to corresponding Notion page links.
>
> Strictly distinguish Shell implementation details from upstream engine CLI capabilities and pending tasks.
>
> Return the index link and each ES/EN page link, publication date, published revision, and any differences from local files.

## Verification record

| Field | Value |
| --- | --- |
| Notion Index | https://app.notion.com/p/3de21943d129818b9cd6ca4ab12c44ad |
| Page 00 ES / EN | Pending publication in Notion (OAuth token revoked) |
| Page 01 ES / EN | https://app.notion.com/p/3de21943d129819c9bd2ee1d70d04087 / https://app.notion.com/p/3de21943d12981edad3bd48436fec691 |
| Page 02 ES / EN | https://app.notion.com/p/3de21943d1298125a565e14fdcfca893 / https://app.notion.com/p/3de21943d12981bc916ffdd9e2da9e63 |
| Page 03 ES / EN | https://app.notion.com/p/3de21943d1298141a7cee925a5670e49 / https://app.notion.com/p/3de21943d1298152b26be649f7a630e5 |
| Page 04 ES / EN | https://app.notion.com/p/3de21943d12981ddb85dd51594c81217 / https://app.notion.com/p/3de21943d12981fd91a2e3d8b33d8e10 |
| Page 05 ES / EN | Pending publication in Notion (OAuth token revoked) |
| Page 06 ES / EN | Pending publication in Notion (OAuth token revoked) |
| Revision published in Notion | 4 (Pages 01 to 04 synced); Pages 00, 05, 06 and Rev 5-11 pending OAuth renewal |
| Local publication date | 2026-09-18 |
| Differences from repository | Relative links adapted to Notion URLs; master analogy and technical taxonomy added per ai-engineer-docs standard. |
| User review | Pending confirmation |
