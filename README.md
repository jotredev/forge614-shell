# Forge614-Shell

Forge614-Shell is a terminal workspace with AI-assisted programming chat. Think of it as a workshop reception desk: it gives people one visible place to choose and use an installed assistant, while specialised tools do their own jobs behind the counter.

Shell is a TypeScript application run with Bun and Node.js 22.19+. It is the human-facing product in the Forge614 ecosystem. Forge614 Engines (the internal, non-interactive component that detects installed assistants) supplies discovery and safe configuration plans. Forge614 Engram (the separate persistent-memory product) is optional for chat, but Shell can initialize it and offer to register its MCP server (a local standard connection that lets an AI client call a tool) after initialization.

## Boundaries

- Interactive chat adapters exist for Claude Code and OpenAI Codex. Pi remains a legacy non-interactive path only.
- Cursor can be configured with Engram MCP when Engines reports MCP support, but Shell has no Cursor chat adapter.
- Gemini and Antigravity are not supported by Shell.
- Shell never falls back to scanning `PATH` itself when Forge614 Engines is missing or incompatible.
- Shell does not store subscription credentials, revoke external accounts, create projects during Engram initialization, or display MCP configuration-file contents.

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
| 07 | [Inicialización de Engram y MCP](docs/es/07-inicializacion-engram-y-mcp.md) | [Engram initialization and MCP](docs/en/07-engram-initialization-and-mcp.md) |
| 08 | [Diagnóstico y límites operativos](docs/es/08-diagnostico-y-limites.md) | [Troubleshooting and operational limits](docs/en/08-troubleshooting-and-limits.md) |

The local-to-Notion correspondence, version, and content fingerprints (short change-detection hashes) live in [`docs/notion-map.json`](docs/notion-map.json).
