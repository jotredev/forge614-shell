# 02 — Notion handoff

2026-09-18 · Stages 01 and 02 · Revision 7 · [Español](../es/02-traspaso-notion.md) · [Index](../../README.md)

**Status: Local documentation complete and verified (124 tests passing across 32 files). Notion synchronization for revisions 5, 6, and 7 pending Notion MCP OAuth credential renewal.**

## Sources for this delivery

- [README.md](../../README.md): bilingual presentation, stage 02 status, and general index (124 tests passing across 32 files).
- [01-alcance.md](../es/01-alcance.md): scope and decisions in Spanish (revision 2: updated scope without internal workspace manager).
- [01-scope.md](01-scope.md): equivalent scope in English (revision 2: updated scope).
- [02-traspaso-notion.md](../es/02-traspaso-notion.md) and [02-notion-handoff.md](02-notion-handoff.md): sync instructions and record in ES/EN (revision 7).
- [03-etapa-2-primera-entrega.md](../es/03-etapa-2-primera-entrega.md): first technical delivery for stage 2 in Spanish.
- [03-stage-2-first-delivery.md](03-stage-2-first-delivery.md): first technical delivery for stage 2 in English.
- [04-arquitectura-motores.md](../es/04-arquitectura-motores.md): layered architecture, multi-engine adapters, shared profiles, local /logout, and /login reconnect in Spanish (revision 2 with 124 tests).
- [04-architecture-engines.md](04-architecture-engines.md): layered architecture, multi-engine adapters, shared profiles, local /logout, and /login reconnect in English (revision 2 with 124 tests).
- [05-interfaz-basic-panel-cuotas.md](../es/05-interfaz-basic-panel-cuotas.md): Basic visual interface, contextual sidebar with braille metrics, bottom status bar with project identity and pinned `v1.0.0` version badge, native work modes via `Shift+Tab`, Codex skill discovery via `$`, grouped command menu, RAM resources, and /refresh quota queries in Spanish (revision 3 with 124 tests).
- [05-basic-ui-sidebar-quotas.md](05-basic-ui-sidebar-quotas.md): Basic visual interface, contextual sidebar with braille metrics, bottom status bar with project identity and pinned `v1.0.0` version badge, native work modes via `Shift+Tab`, Codex skill discovery via `$`, grouped command menu, RAM resources, and /refresh quota queries in English (revision 3 with 124 tests).
- [06-preparacion-release-1.0.0-instalador.md](../es/06-preparacion-release-1.0.0-instalador.md): release 1.0.0 local preparation, versioning conventions (UI label `v1.0.0`, Git tag `1.0.0`), standalone bundle builder (`scripts/release-bundle.mjs`), archive installer (`scripts/install.sh`), versioned layout under `~/.forge614/`, SHA-256 checksums, and roadmap in Spanish (revision 1 with 124 tests).
- [06-release-1.0.0-bundle-installer.md](06-release-1.0.0-bundle-installer.md): release 1.0.0 local preparation, versioning conventions (UI label `v1.0.0`, Git tag `1.0.0`), standalone bundle builder (`scripts/release-bundle.mjs`), archive installer (`scripts/install.sh`), versioned layout under `~/.forge614/`, SHA-256 checksums, and roadmap in English (revision 1 with 124 tests).

## Prompt for Notion-connected agent

> Publish and synchronize documentation for stages 01 and 02 of Forge614-Shell inside the Notion workspace under AI Engineer / Librerías / Forge614-Shell.
>
> Maintain the bilingual general index on the main "Forge614-Shell" page and the corresponding child ES/EN pages:
> - "01 — Alcance y decisiones" / "01 — Scope and decisions" (revision 2).
> - "02 — Traspaso a Notion" / "02 — Notion handoff" (revision 7).
> - "03 — Primera entrega de la etapa 2" / "03 — Stage 2 first delivery" (revision 1).
> - "04 — Arquitectura y motores" / "04 — Architecture and engines" (revision 2, 124 tests).
> - "05 — Interfaz Basic, panel lateral y cuotas" / "05 — Basic UI, sidebar, and quotas" (revision 3: Forge614 styling, contextual sidebar, RAM resources, bottom status bar with project, Git, and pinned `v1.0.0` version badge, native modes with `Shift+Tab`, Codex skills with `$`, grouped menu, independent scrolling, and /refresh).
> - "06 — Preparación del release 1.0.0 e instalador" / "06 — Release 1.0.0 preparation and installer" (revision 1: `v1.0.0` UI label vs `1.0.0` Git tag, standalone Node.js bundle, local `install.sh` installer, `~/.forge614/` layout, SHA-256 digests, and three-tier distribution roadmap).
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
| Page 01 ES / EN | https://app.notion.com/p/3de21943d129819c9bd2ee1d70d04087 / https://app.notion.com/p/3de21943d12981edad3bd48436fec691 |
| Page 02 ES / EN | https://app.notion.com/p/3de21943d1298125a565e14fdcfca893 / https://app.notion.com/p/3de21943d12981bc916ffdd9e2da9e63 |
| Page 03 ES / EN | https://app.notion.com/p/3de21943d1298141a7cee925a5670e49 / https://app.notion.com/p/3de21943d1298152b26be649f7a630e5 |
| Page 04 ES / EN | https://app.notion.com/p/3de21943d12981ddb85dd51594c81217 / https://app.notion.com/p/3de21943d12981fd91a2e3d8b33d8e10 |
| Page 05 ES / EN | Pending publication in Notion (OAuth token revoked) |
| Page 06 ES / EN | Pending publication in Notion (OAuth token revoked) |
| Revision published in Notion | 4 (Pages 01 to 04 synced); Pages 05, 06 and Rev 5-7 pending OAuth renewal |
| Local publication date | 2026-09-18 |
| Differences from repository | Relative links adapted to Notion URLs; master analogy and technical taxonomy added per ai-engineer-docs standard. |
| User review | Pending confirmation |
