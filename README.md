# Forge614-Shell

Forge614-Shell is a terminal workspace with AI-assisted programming chat. Think of it as a workshop reception desk: it gives people one visible place to choose and use an installed assistant, while specialised tools do their own jobs behind the counter.

Shell is a TypeScript application run with Bun and Node.js 22.19+. It is the human-facing product in the Forge614 ecosystem. Forge614 Engines (the internal, non-interactive component that detects installed assistants) supplies discovery and safe configuration plans. Forge614 Engram (the separate persistent-memory product) is optional for chat, but Shell can initialize it and then offer each detected assistant Engram's full memory integration: its MCP server (a local standard connection that lets an AI client call a tool) plus Engram's universal memory instructions, planned, applied, and verified through Forge614 Engines.

## Boundaries

- Interactive chat adapters exist for Claude Code and OpenAI Codex.
- Every assistant list Shell shows contains only the assistants Forge614 Engines reports as fully supported (`fullySupported`); today that is Claude Code and Codex. Engines decides, never Shell, and Shell asks you to run `forge614-shell update` if the installed Engines is too old to say.
- Gemini and Antigravity are not supported by Shell.
- Shell never falls back to scanning `PATH` itself when Forge614 Engines is missing or incompatible.
- Shell does not store subscription credentials, revoke external accounts, create projects during Engram initialization, or display MCP configuration-file contents.

## Installation / Instalación

Supported platforms: **macOS**, **Linux**, and **Windows x64**.
Prerequisites: **Node.js 22.19+** for installation and execution.

### macOS / Linux
Requires `curl` and `shasum` or `sha256sum`:
```bash
curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash
```

### Windows x64
Requires Windows 10 version 1803+ or Windows 11, PowerShell (5.1 or `pwsh`), and `tar.exe`. The download command below also uses `curl.exe`; the installer itself uses PowerShell to fetch assets. Download the official `install.ps1` script as a file and execute it with `-Latest` (never pipe remote scripts directly to `iex`):
```powershell
curl.exe -fsSL -o install.ps1 https://github.com/jotredev/forge614-shell/releases/latest/download/install.ps1
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Latest
Remove-Item install.ps1
```
The gatekeeper verifies `install.mjs` and `forge614.node.json` against the release's GNU-format `SHA256SUMS`. It places Forge614 Shell under `%USERPROFILE%\.forge614\shell\<version>\forge614-shell-<version>`, ensures compatible Forge614 Engines, and adds the `forge614-shell.cmd` launcher to the user `Path`. Releases use `vX.Y.Z` tags. Version 1.17.0 also publishes `forge614-shell-1.17.0.tar.gz.sha256` once for compatibility with the bundled 1.16.0 updater; the next release removes it.

`forge614-shell --version --json` prints the common version object. `forge614-shell update [--version X.Y.Z|vX.Y.Z] [--json]` updates Shell through the verified release gatekeeper, then updates Engines and Engram when installed. `forge614-shell uninstall` asks for confirmation before removing Shell, its preferences, and history; `uninstall --json` skips the prompt, and `uninstall --self` reports that Shell has no integrations of its own to remove.

## Documentation / Documentación

| No. | Español | English |
| --- | --- | --- |
| 00 | [Instalación, actualización y comandos](docs/es/00-instalacion-y-prueba-local-release.md) | [Installation, updates, and commands](docs/en/00-installation-and-local-release-test.md) |
| 01 | [Propósito, límites y ecosistema](docs/es/01-alcance.md) | [Purpose, boundaries, and ecosystem](docs/en/01-scope.md) |
| 02 | [Mapa de publicación y trazabilidad](docs/es/02-traspaso-notion.md) | [Publication map and traceability](docs/en/02-notion-handoff.md) |
| 03 | [Registro histórico: primera entrega](docs/es/03-etapa-2-primera-entrega.md) | [Historical record: first delivery](docs/en/03-stage-2-first-delivery.md) |
| 04 | [Arquitectura y motores actuales](docs/es/04-arquitectura-motores.md) | [Current architecture and engines](docs/en/04-architecture-engines.md) |
| 05 | [Interfaz Basic y chat](docs/es/05-interfaz-basic-panel-cuotas.md) | [Basic interface and chat](docs/en/05-basic-ui-sidebar-quotas.md) |
| 06 | [Releases, seguridad y mantenimiento](docs/es/06-preparacion-release-1.0.0-instalador.md) | [Releases, security, and maintenance](docs/en/06-release-1.0.0-bundle-installer.md) |
| 07 | [Inicialización de Engram e integración de memoria](docs/es/07-inicializacion-engram-y-mcp.md) | [Engram initialization and memory integration](docs/en/07-engram-initialization-and-mcp.md) |
| 08 | [Diagnóstico y límites operativos](docs/es/08-diagnostico-y-limites.md) | [Troubleshooting and operational limits](docs/en/08-troubleshooting-and-limits.md) |
| 09 | [Idioma y configuración regional](docs/es/09-idioma-y-configuracion-regional.md) | [Language and locale](docs/en/09-language-and-locale.md) |

The local-to-Notion correspondence, version, and content fingerprints (short change-detection hashes) live in [`docs/notion-map.json`](docs/notion-map.json).
