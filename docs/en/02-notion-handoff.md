# 02 — Notion handoff

2026-09-19 · Stages 01 and 02 · Revision 13 · [Español](../es/02-traspaso-notion.md) · [Index](../../README.md)

**Status: Local documentation complete and verified (130 tests passing across 34 files, 591 assertions). Notion synchronization for revisions 5 to 13 pending publication.**

## Sources for this delivery

- [README.md](../../README.md): bilingual presentation, stage 02 status, and general index (130 tests passing across 34 files).
- [00-instalacion-y-prueba-local-release.md](../es/00-instalacion-y-prueba-local-release.md): step-by-step beginner guide for public installation and updates on macOS and Linux (revision 6: one-line public `curl | bash` installation, automatic Forge614 Engines v1.0.0 bootstrap, isolated `~/.forge614/shell/bin/` directory, strict PATH isolation, optional Shell usage after setup, and Engines troubleshooting).
- [00-installation-and-local-release-test.md](00-installation-and-local-release-test.md): step-by-step beginner guide for public installation and updates on macOS and Linux (revision 6: one-line public `curl | bash` installation, automatic Forge614 Engines v1.0.0 bootstrap, isolated `~/.forge614/shell/bin/` directory, strict PATH isolation, optional Shell usage after setup, and Engines troubleshooting).
- [01-alcance.md](../es/01-alcance.md): scope and decisions in Spanish (revision 2: updated scope without internal workspace manager).
- [01-scope.md](01-scope.md): equivalent scope in English (revision 2: updated scope).
- [02-traspaso-notion.md](../es/02-traspaso-notion.md) and [02-notion-handoff.md](02-notion-handoff.md): sync instructions and record in ES/EN (revision 13).
- [03-etapa-2-primera-entrega.md](../es/03-etapa-2-primera-entrega.md): first technical delivery for stage 2 in Spanish.
- [03-stage-2-first-delivery.md](03-stage-2-first-delivery.md): first technical delivery for stage 2 in English.
- [04-arquitectura-motores.md](../es/04-arquitectura-motores.md): layered architecture, multi-engine adapters, shared profiles, local /logout, and /login reconnect in Spanish (revision 2 with 130 tests).
- [04-architecture-engines.md](04-architecture-engines.md): layered architecture, multi-engine adapters, shared profiles, local /logout, and /login reconnect in English (revision 2 with 130 tests).
- [05-interfaz-basic-panel-cuotas.md](../es/05-interfaz-basic-panel-cuotas.md): Basic visual interface, contextual sidebar with braille metrics, bottom status bar with project identity and pinned version badge, native work modes via `Shift+Tab`, Codex skill discovery via `$`, grouped command menu, RAM resources, and /refresh quota queries (revision 3 with 130 tests).
- [05-basic-ui-sidebar-quotas.md](05-basic-ui-sidebar-quotas.md): Basic visual interface, contextual sidebar with braille metrics, bottom status bar with project identity and pinned version badge, native work modes via `Shift+Tab`, Codex skill discovery via `$`, grouped command menu, RAM resources, and /refresh quota queries (revision 3 with 130 tests).
- [06-preparacion-release-1.0.0-instalador.md](../es/06-preparacion-release-1.0.0-instalador.md): public release preparation, versioning conventions, standalone bundle builder (`scripts/release-bundle.mjs`), network installer (`scripts/install.sh`), Forge614 Engines bootstrap (schema v1), isolated `~/.forge614/shell/bin` path, `forge614-shell update`, and maintainer workflow (revision 6 with 130 tests, 591 assertions).
- [06-release-1.0.0-bundle-installer.md](06-release-1.0.0-bundle-installer.md): public release preparation, versioning conventions, standalone bundle builder (`scripts/release-bundle.mjs`), network installer (`scripts/install.sh`), Forge614 Engines bootstrap (schema v1), isolated `~/.forge614/shell/bin` path, `forge614-shell update`, and maintainer workflow (revision 6 with 130 tests, 591 assertions).

## Prompt for Notion-connected agent

> Publish and synchronize documentation for stages 01 and 02 of Forge614-Shell inside the Notion workspace under AI Engineer / Librerías / Forge614-Shell.
>
> Maintain the bilingual general index on the main "Forge614-Shell" page and the corresponding child ES/EN pages:
> - "00 — Instalación y actualización pública del release" / "00 — Public release installation and updates" (revision 6: public one-line curl installation, automatic Forge614 Engines v1.0.0 bootstrap, isolated `~/.forge614/shell/bin/` path, PATH isolation, optional native work after setup, and complete troubleshooting).
> - "01 — Alcance y decisiones" / "01 — Scope and decisions" (revision 2).
> - "02 — Traspaso a Notion" / "02 — Notion handoff" (revision 13).
> - "03 — Primera entrega de la etapa 2" / "03 — Stage 2 first delivery" (revision 1).
> - "04 — Arquitectura y motores" / "04 — Architecture and engines" (revision 2, 130 tests).
> - "05 — Interfaz Basic, panel lateral y cuotas" / "05 — Basic UI, sidebar, and quotas" (revision 3: Forge614 styling, contextual sidebar, RAM resources, bottom status bar with project, Git, and pinned version badge, native modes with `Shift+Tab`, Codex skills with `$`, grouped menu, independent scrolling, and /refresh).
> - "06 — Preparación de releases e instalador público" / "06 — Release preparation and public installer bundle" (revision 6: public distribution on GitHub Releases, network installer, Forge614 Engines schema v1 integration and bootstrap, PATH isolation, 3 Shell assets without Engines binaries, and maintainer workflow with 130 tests).
>
> Preserve shared numbers across languages and link each page with its translation and the index. Convert repository relative links to corresponding Notion page links.
>
> Strictly distinguish Shell implementation details from upstream engine CLI capabilities and pending tasks.
>
> Return the index link and each ES/EN page link, publication date, published revision, and any differences from local files.

## Updated sections for Notion synchronization

### 1. Public installation (single command)
The network installation command remains strictly a single line using `curl | bash`:
```bash
curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash
```
No secondary command or manual dependency setup is required.

### 2. Automatic internal dependency (Forge614 Engines)
When installing or updating Shell via `forge614-shell update`:
1. The installer or updater checks for the internal binary at `~/.forge614/engines/bin/forge614-engines`.
2. It executes `forge614-engines detect` and verifies the JSON contract (`schemaVersion: 1` and array of agents).
3. **Reuse:** If Engines is already installed and compatible, it is reused without unnecessary downloads.
4. **Automatic bootstrap:** If Engines is missing or incompatible, Shell autonomously downloads and executes the official Engines installer (`v1.0.0`).
5. **Non-interactive:** The user never installs, updates, or executes `forge614-engines` manually.

### 3. Installed filesystem layout
Both components coexist cleanly and decoupled under the base directory `~/.forge614/`:
```text
~/.forge614/
├─ shell/
│  └─ bin/forge614-shell
└─ engines/
   └─ bin/forge614-engines
```

### 4. PATH configuration (Strict Isolation)
- The installer injects **only** `~/.forge614/shell/bin` into shell profile files (`~/.zshrc`, `~/.bashrc`).
- `~/.forge614/engines/bin` is **never added to PATH**, guaranteeing internal binaries do not pollute the user's interactive shell or collide with system tools.

### 5. Security and Atomicity Guarantees
- Engines cryptographically and functionally verifies its own binary and contract.
- If Engines cannot be downloaded, installed, or validated, Shell installation or update immediately aborts. Shell is never activated nor left in a partially installed state; during updates, the previous working version is safely preserved.

### 6. Daily workflow (Shell is Optional after Setup)
- Forge614 Shell is used for initial setup, profile configuration, fixing discrepancies, status inspections, and confirmations.
- Once setup is complete, the user is completely free to close Shell and work directly in their preferred native editor or client (ADE Orca, Claude Code, OpenAI Codex, or other native clients). Shell empowers setup without constraining daily habits.

### 7. Troubleshooting
| Scenario / Error | Root Cause | System Action / Resolution |
| --- | --- | --- |
| Failed to download Engines installer | Network drop or GitHub Releases unreachable. | Shell install aborts atomically; Shell is neither activated nor partially installed. Retry once network connectivity is restored. |
| Incompatible or corrupted Engines binary | The binary does not return `schemaVersion: 1`. | Shell invokes the official Engines installer to activate a compatible stable release, then validates the contract. |
| Compatible Engines detected | `schemaVersion: 1` validated successfully. | Shell reuses the binary instantly, skipping redundant downloads. |
| `forge614-engines: command not found` on terminal | User attempts to invoke the internal binary directly. | Expected behavior: Engines is an internal component not exposed in `PATH`. Shell manages it automatically; use Shell for setup or a configured native AI client for daily work. |

### 8. Maintainer guidelines
- **3 Official Shell Assets:** Shell publishes exclusively `forge614-shell-<version>.tar.gz`, `forge614-shell-<version>.tar.gz.sha256`, and `install.sh`.
- **Zero bundled Engines binaries:** Engines binaries are never copied or packaged inside Shell's release bundle; Shell fetches the official Engines installer over the network.
- **Release Precondition:** A compatible stable release of Forge614 Engines must already be published before publishing a Shell release that depends on it.
- **Next stable release:** This bootstrap behavior is integrated into the local code and will ship in the next stable Shell release.

## Verification record

| Field | Value |
| --- | --- |
| Notion Index | https://app.notion.com/p/3de21943d129818b9cd6ca4ab12c44ad |
| Page 00 ES / EN | Pending publication in Notion |
| Page 01 ES / EN | https://app.notion.com/p/3de21943d129819c9bd2ee1d70d04087 / https://app.notion.com/p/3de21943d12981edad3bd48436fec691 |
| Page 02 ES / EN | https://app.notion.com/p/3de21943d1298125a565e14fdcfca893 / https://app.notion.com/p/3de21943d12981bc916ffdd9e2da9e63 |
| Page 03 ES / EN | https://app.notion.com/p/3de21943d1298141a7cee925a5670e49 / https://app.notion.com/p/3de21943d1298152b26be649f7a630e5 |
| Page 04 ES / EN | https://app.notion.com/p/3de21943d12981ddb85dd51594c81217 / https://app.notion.com/p/3de21943d12981fd91a2e3d8b33d8e10 |
| Page 05 ES / EN | Pending publication in Notion |
| Page 06 ES / EN | Pending publication in Notion |
| Revision published in Notion | 4 (Pages 01 to 04 synced); Pages 00, 05, 06 and Rev 5-13 pending publication |
| Local publication date | 2026-09-19 |
| Differences from repository | Relative links adapted to Notion URLs; master analogy and technical taxonomy added per ai-engineer-docs standard. |
| User review | Pending confirmation |
