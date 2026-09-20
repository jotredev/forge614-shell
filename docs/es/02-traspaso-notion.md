# 02 — Traspaso a Notion

2026-09-19 · Etapas 01 y 02 · Revisión 14 · [English](../en/02-notion-handoff.md) · [Índice](../../README.md)

**Estado: Documentación local completa y verificada (133 pruebas pasando en 35 archivos, 597 aserciones). Sincronización en Notion de las revisiones 5 a 14 pendiente de publicación.**

## Fuentes de esta entrega

- [README.md](../../README.md): presentación bilingüe, estado de la etapa 02 e índice general (133 pruebas pasando en 35 archivos, 597 aserciones).
- [00-instalacion-y-prueba-local-release.md](00-instalacion-y-prueba-local-release.md): guía paso a paso desde cero para instalación y actualización pública en macOS y Linux (revisión 7: flujo público de un comando vía `curl | bash`, bootstrap automático de Forge614 Engines v1.0.0, ruta aislada en `~/.forge614/shell/bin/`, aislamiento del PATH, selector de arranque gobernado por Engines con schema v1, Claude Code y Codex disponibles, Cursor oculto por falta de adaptador, exclusión de Antigravity, regla de no-fallback y resolución de incidencias).
- [00-installation-and-local-release-test.md](../en/00-installation-and-local-release-test.md): step-by-step beginner guide for public installation and updates on macOS and Linux (revision 7: one-line public `curl | bash` installation, automatic Forge614 Engines v1.0.0 bootstrap, isolated `~/.forge614/shell/bin/` directory, strict PATH isolation, Engines-driven startup selector with schema v1, Claude Code and Codex active, Cursor hidden, Antigravity excluded, no-fallback rule, and troubleshooting).
- [01-alcance.md](01-alcance.md): alcance y decisiones en español (revisión 2: alcance actualizado sin gestor interno de proyectos/worktrees).
- [01-scope.md](../en/01-scope.md): alcance equivalente en inglés (revision 2: updated scope).
- [02-traspaso-notion.md](02-traspaso-notion.md) y [02-notion-handoff.md](../en/02-notion-handoff.md): instrucciones y registro de sincronización ES/EN (revisión 14).
- [03-etapa-2-primera-entrega.md](03-etapa-2-primera-entrega.md): primera entrega técnica de la etapa 2 en español.
- [03-stage-2-first-delivery.md](../en/03-stage-2-first-delivery.md): primera entrega técnica de la etapa 2 en inglés.
- [04-arquitectura-motores.md](04-arquitectura-motores.md): arquitectura en capas, integración real con Forge614 Engines (`forge614-engines detect`, `schemaVersion: 1`), adaptadores de chat para Claude Code y Codex, perfiles compartidos, desconexión local /logout, reconexión /login y regla estricta de no-fallback ante fallos de Engines (revisión 3 con 133 tests en 35 archivos, 597 aserciones).
- [04-architecture-engines.md](../en/04-architecture-engines.md): layered architecture, real Forge614 Engines integration (`forge614-engines detect`, `schemaVersion: 1`), chat adapters for Claude Code and Codex, shared profiles, local /logout, /login reconnect, and strict no-fallback rule on Engines failure (revision 3 with 133 tests across 35 files, 597 assertions).
- [05-interfaz-basic-panel-cuotas.md](05-interfaz-basic-panel-cuotas.md): interfaz visual Basic, panel contextual lateral con métricas braille, barra de estado inferior con identidad de proyecto y fijación de versión, modos de trabajo nativos con `Shift+Tab`, descubrimiento de habilidades Codex con `$`, menú de comandos agrupado, recursos de RAM y refresco de cuotas /refresh (revisión 3 con 133 tests).
- [05-basic-ui-sidebar-quotas.md](../en/05-basic-ui-sidebar-quotas.md): Basic visual interface, contextual sidebar with braille metrics, bottom status bar with project identity and pinned version badge, native work modes via `Shift+Tab`, Codex skill discovery via `$`, grouped command menu, RAM resources, and /refresh quota queries (revision 3 with 133 tests).
- [06-preparacion-release-1.0.0-instalador.md](06-preparacion-release-1.0.0-instalador.md): preparación del release público, convención de versiones, generador de bundle autónomo (`scripts/release-bundle.mjs`), instalador por red (`scripts/install.sh`), bootstrap de Forge614 Engines (schema v1), ruta aislada `~/.forge614/shell/bin`, subcomando `forge614-shell update` y flujo para mantenedores (revisión 7 con 133 tests en 35 archivos, 597 aserciones).
- [06-release-1.0.0-bundle-installer.md](../en/06-release-1.0.0-bundle-installer.md): public release preparation, versioning conventions, standalone bundle builder (`scripts/release-bundle.mjs`), network installer (`scripts/install.sh`), Forge614 Engines bootstrap (schema v1), isolated `~/.forge614/shell/bin` path, `forge614-shell update`, and maintainer workflow (revision 7 with 133 tests across 35 files, 597 assertions).

## Mensaje para la IA conectada a Notion

> Publica y sincroniza la documentación de las etapas 01 y 02 de Forge614-Shell en el espacio de Notion bajo AI Engineer / Librerías / Forge614-Shell.
>
> Mantén el índice general bilingüe en la página principal “Forge614-Shell” y las páginas subordinadas ES/EN correspondientes:
> - «00 — Instalación y actualización pública del release» / «00 — Public release installation and updates» (revisión 7: instalación pública con un comando curl, bootstrap automático de Forge614 Engines v1.0.0, ruta aislada en `~/.forge614/shell/bin/`, aislamiento estricto de PATH, selector gobernado por Engines detect con schema v1, Claude Code y Codex activos, Cursor oculto, Antigravity excluido, regla de no-fallback y troubleshooting completo).
> - «01 — Alcance y decisiones» / «01 — Scope and decisions» (revisión 2).
> - «02 — Traspaso a Notion» / «02 — Notion handoff» (revisión 14).
> - «03 — Primera entrega de la etapa 2» / «03 — Stage 2 first delivery» (revisión 1).
> - «04 — Arquitectura y motores» / «04 — Architecture and engines» (revisión 3: integración con Forge614 Engines detect schema v1, adaptadores de chat para Claude Code y Codex, perfiles compartidos, /logout y /login local, diagnóstico sin fallback, 133 tests).
> - «05 — Interfaz Basic, panel lateral y cuotas» / «05 — Basic UI, sidebar, and quotas» (revisión 3: diseño Forge614, sidebar contextual, recursos RAM, barra de estado con proyecto, Git y versión fija, modos nativos con `Shift+Tab`, habilidades Codex con `$`, menú agrupado, scroll independiente y refresco /refresh).
> - «06 — Preparación de releases e instalador público» / «06 — Release preparation and public installer bundle» (revisión 7: distribución pública en GitHub Releases, instalador de red, integración y bootstrap de Forge614 Engines schema v1, aislamiento de PATH, 3 assets de Shell sin binarios de Engines y flujo de publicación para mantenedores con 133 tests).
>
> Conserva los números compartidos entre idiomas y enlaza cada página con su traducción y con el índice. Convierte los enlaces relativos del repositorio en enlaces a las páginas correspondientes de Notion.
>
> Distingue estrictamente lo implementado por Shell de lo heredado nativamente de los CLIs/motores upstream y de las tareas pendientes.
>
> Devuelve el enlace del índice y de cada página ES/EN, fecha de publicación, revisión documental publicada y cualquier diferencia respecto de los archivos recibidos.

## Secciones actualizadas para sincronización en Notion

### 1. Instalación pública (un solo comando)
El comando de instalación por red se mantiene estrictamente en una sola línea mediante `curl | bash`:
```bash
curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash
```
No se requiere un segundo comando ni pasos adicionales para dependencias.

### 2. Dependencia interna automática (Forge614 Engines)
Al instalar o actualizar Shell mediante `forge614-shell update`:
1. El instalador o actualizador revisa la presencia del binario interno en `~/.forge614/engines/bin/forge614-engines`.
2. Ejecuta `forge614-engines detect` y valida el contrato JSON (`schemaVersion: 1` y arreglo de agentes).
3. **Reutilización:** Si Engines ya está instalado y es compatible, se reutiliza sin realizar descargas innecesarias.
4. **Bootstrap automático:** Si Engines falta o es incompatible, Shell descarga y ejecuta de forma autónoma el instalador oficial de Engines (`v1.0.0`).
5. **No interactivo:** La persona usuaria nunca instala, actualiza ni ejecuta `forge614-engines` manualmente.

### 3. Estructura instalada en el disco
Ambos componentes coexisten de manera desacoplada bajo el directorio base `~/.forge614/`:
```text
~/.forge614/
├─ shell/
│  └─ bin/forge614-shell
└─ engines/
   └─ bin/forge614-engines
```

### 4. Configuración del PATH (Aislamiento Estricto)
- El instalador inyecta **única y exclusivamente** `~/.forge614/shell/bin` en los archivos de perfil (`~/.zshrc`, `~/.bashrc`).
- `~/.forge614/engines/bin` **nunca se agrega al PATH** del usuario, garantizando que los binarios internos no colisionen con comandos del sistema ni puedan ser invocados accidentalmente.

### 5. Flujo de Inicio y Consulta del Contrato Público (`schemaVersion: 1`)
- Al arrancar `forge614-shell`, el selector “Choose your AI engine” consulta programáticamente:
  `~/.forge614/engines/bin/forge614-engines detect`
- Shell **ya no utiliza su detector local en PATH** para poblar ese selector.
- El contrato actual de Engines utiliza `schemaVersion: 1`.
- Shell muestra **únicamente** los agentes detectados con `installed: true` para los que ya dispone de un adaptador de chat interactivo: **Claude Code** y **OpenAI Codex**.
- **Cursor:** Puede ser detectado por Engines (`id: "cursor"`), pero no aparece aún en el selector porque Shell todavía no tiene un adaptador de chat para Cursor.
- **Antigravity CLI:** Ya no figura en el selector inicial; pertenecía a la detección local en PATH heredada.

### 6. Garantía de Integridad: Regla de No-Fallback ante Fallos de Engines
- Si Engines no está disponible (`status !== 0`), falla o devuelve un esquema incompatible (`schemaVersion !== 1` o JSON inválido), **Shell no realiza fallback a detección local**.
- Shell interrumpe el arranque de inmediato con un mensaje explícito:
  `Forge614 Engines is unavailable. Reinstall Forge614 Shell to repair its required dependency.` o
  `Forge614 Engines is incompatible with this Shell version. Reinstall Forge614 Shell to repair its required dependency.`.
- El usuario repara el entorno reinstalando Forge614 Shell con el instalador curl oficial.

### 7. Flujo de Trabajo Diario (Shell es Opcional tras el Setup)
- Forge614 Shell se utiliza para el setup inicial, configuración de perfiles, resolución de discrepancias, inspección de estado y confirmaciones.
- Una vez finalizada la configuración, la persona es completamente libre de cerrar Shell y trabajar directamente en su editor o cliente preferido (ADE Orca, Claude Code, OpenAI Codex u otro cliente nativo). Shell no sustituye a esos clientes.

### 8. Resolución de Incidencias (Troubleshooting)
| Escenario / Error | Causa Raíz | Acción del Sistema / Solución |
| --- | --- | --- |
| Falla al descargar el instalador de Engines | Pérdida de conexión a red o bloqueo de GitHub Releases. | La instalación de Shell se aborta atómicamente; no se activa ni altera el estado previo. Reintentar cuando se restablezca la red. |
| Engines ausente al arrancar Shell | `~/.forge614/engines/bin/forge614-engines` ausente o sin permisos. | Error fatal: `Forge614 Engines is unavailable...`. Shell no hace fallback local. Solución: reinstalar Shell con el comando curl oficial. |
| Engines incompatible o JSON corrupto al arrancar | `schemaVersion !== 1` o salida malformada. | Error fatal: `Forge614 Engines is incompatible...` o `invalid detection result`. Shell no hace fallback local. Solución: reinstalar Shell con el comando curl oficial. |
| Engines compatible detectado | `schemaVersion: 1` validado satisfactoriamente. | Shell reutiliza el binario existente al instante, omitiendo descargas redundantes. |
| `forge614-engines: command not found` al invocarlo | El usuario intenta ejecutar el binario directamente en su terminal. | Comportamiento previsto: Engines es un componente interno no expuesto en el `PATH`. Shell lo administra automáticamente; usar Shell para setup o un cliente nativo configurado para el trabajo diario. |

### 9. Directrices para Mantenedores (Maintainers Workflow)
- **3 Assets oficiales de Shell:** Shell publica exclusivamente `forge614-shell-<version>.tar.gz`, `forge614-shell-<version>.tar.gz.sha256` e `install.sh`.
- **Cero binarios de Engines empaquetados:** No se copian ni empaquetan binarios de Engines dentro del bundle o release de Shell; Shell consume el instalador oficial de Engines en red.
- **Precondición de Release:** Antes de publicar una versión de Shell que requiera una versión de Engines, debe existir publicado un release estable y verificado de Forge614 Engines.
- **Próximo release estable:** Este comportamiento está integrado en el código local y formará parte del próximo release estable de Shell (133 tests passing).

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
| Revisión publicada en Notion | 4 (Páginas 01 a 04 sincronizadas); Páginas 00, 05, 06 y Rev 5-14 pendientes de publicación |
| Fecha de publicación local | 2026-09-19 |
| Diferencias con el repositorio | Enlaces relativos adaptados a URLs de Notion; analogía maestra e indexación técnica añadidas según estándar ai-engineer-docs. |
| Revisión del usuario | Pendiente de confirmación |
