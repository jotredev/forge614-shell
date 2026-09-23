# Ámbito `ecosystem` y selección de grupo en Shell — Plan

> Traspaso: forge614-ai → forge614-shell (Engram 1.6.0). Actas 0022, 0023, 0024, 0013, 0016, 0012, 0003.
> Regla de Git: **ningún commit, merge, tag, push ni publicación**. Este plan se ejecuta solo en este repositorio.

**Meta:** que Shell entienda el bloque `ecosystem` de `startup-context` (lo sanea y lo entrega al asistente como dato), pregunte una sola vez a qué grupo pertenece el proyecto dentro de `init --product engram`, y muestre los avisos de Engram (`DATABASE_MIGRATED`, `PROJECT_REBOUND_FROM_FILE`).

**Arquitectura:** Shell sigue hablando con Engram solo por su CLI pública. Engram escribe y posee `.forge614/project.json`; Shell únicamente comprueba que exista (para decidir si pregunta) y aplica la respuesta con `init --json --directory`, `group-create` y `group-bind`. Los validadores de salidas de otro nodo son guardas escritas a mano que ignoran campos desconocidos y solo exigen lo que Shell usa (R31 / acta 0024).

**Stack:** TypeScript, Bun 1.4.2 (`bun test`), `@earendil-works/pi-tui`. Sin dependencias nuevas.

## Restricciones globales

- Cero commit/push/tag/publicación. `~/Desktop/forge614-ai` y `~/Desktop/forge614-engram` son solo lectura.
- Todo texto para personas sale del catálogo `src/i18n/` (es/en; la paridad la exige el compilador por el tipo `Catalog`). Nada de texto suelto en pantallas ni errores (acta 0016).
- Códigos de error nuevos en `MAYUSCULAS_CON_GUION_BAJO` (acta 0013), mapeados desde el catálogo.
- Nunca mencionar productos externos (acta 0012) ni IA en textos/commits.
- Nunca lanzar binarios nativos de asistentes ni escanear PATH.
- Las pruebas no llaman al Engram real: usan `run` inyectado (stubs) y `FORGE614_HOME` temporal.
- TDD: cada tarea escribe primero la prueba, la ve fallar (o, en la Tarea 1, pasar y se documenta), y luego implementa.

## Decisiones

**D1 — Sin Zod.** Shell no depende de Zod y sus validadores de salidas de otro nodo son guardas manuales que **ya ignoran** campos desconocidos. No se añade la dependencia. Se cumple R31 con una prueba que fija ese comportamiento con la respuesta real de Engram 1.6.0. Nota: R31 no aparece todavía en `STANDARD.md`; solo consta como derivada del acta 0024 y de `10-contexto-de-inicio.md` de Engram ("los consumidores deben ignorar los campos desconocidos").

**D2 — Bloque `ecosystem` inválido = se omite ese bloque, no todo el contexto.** Ausente (Engram viejo) → nada cambia. `{status:"none"}` → nada que inyectar. `{status:"member", group:{id,name}, context}` válido → se inyecta. Presente pero malformado o con `status` desconocido → **no se inyecta** ese bloque (nunca se confía parcialmente), pero `shared` y `project` sí llegan. Coincide con la guía de Engram ("tratar como ausente un bloque `ecosystem` que no entienda"). `group.name` debe cumplir `^[a-z0-9]+(?:-[a-z0-9]+)*$` (1–64); si no, el bloque es inválido.

**D3 — Cupo por ámbito en el resumen.** Hoy el tope de 20 líneas se llena en orden `shared` → `project`. Con tres ámbitos, un `shared` de 18 líneas (caso real de esta máquina) dejaría a `ecosystem` con 2 y a `project` con 0: el ámbito más específico, que es el que manda, quedaría fuera. Cambio: cada ámbito presente recibe un cupo garantizado (`floor(20 / ámbitos presentes)`), los sobrantes se reparten por especificidad (project > ecosystem > shared) y la salida conserva el orden shared → ecosystem → project. Con un solo ámbito presente el resultado es idéntico al actual.

**D4 — La pantalla de grupo va DESPUÉS de aplicar `init`, no antes.** Dos razones: (a) `runInitCommand` garantiza "ninguna llamada a Engram antes de la confirmación"; (b) `group-list` necesita la base ya inicializada. Orden: intro → PostgreSQL → refuerzo → resumen (confirmar) → `init` → **pantalla de grupo** → integración con asistentes → resultado. Esc en la pantalla de grupo = "preguntar después": no se vincula nada ni se escribe archivo, y el flujo continúa.

**D5 — Cuándo se muestra (decidido por la persona, 2026-09-23):** solo si `.forge614/project.json` **no existe** en la raíz del proyecto y la carpeta es un proyecto. Un archivo existente con `ecosystem: null` NO vuelve a preguntar (acta 0023 §4: "si existe el archivo, nunca se pregunta"). Límite conocido: un proyecto cuyo archivo Engram ya creó con `ecosystem: null` (por ejemplo tras un chat) no se vuelve a preguntar; se cambia con los comandos de Engram. Del mismo modo, si `group-bind` falla después de que Engram escribió el archivo, el proyecto queda sin grupo y no se vuelve a preguntar.
- "Es un proyecto" = raíz de Git (`git rev-parse --show-toplevel`; `.git` como carpeta o archivo de worktree) **o** un manifiesto en la carpeta (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `composer.json`, `Gemfile`, `forge614.node.json`).
- Raíz del proyecto = raíz de Git si existe, si no la carpeta actual. Es la misma ruta que se lee y la que se pasa a `--directory`.
- Shell solo comprueba **si el archivo existe** (cualquier cosa en esa ruta cuenta como existente); nunca lee su contenido y nunca lo escribe. Un archivo inválido lo reporta Engram (`PROJECT_FILE_INVALID`, D9).

**D6 — Aplicar la respuesta (solo CLI de Engram).** Proyecto suelto → `init --json --directory <raíz>` (Engram escribe el archivo con `ecosystem: null`, así queda "preguntado una vez"). Grupo existente → `init --json --directory <raíz>` y luego `group-bind --project-id <id> --group <id-del-grupo>` (por `id`, nunca por nombre, para evitar `GROUP_AMBIGUOUS`). Grupo nuevo → `init --directory`, `group-create --name`, `group-bind`. Un fallo aquí se informa en la pantalla de resultado y **no** vuelve fallido un `init` que ya se aplicó (mismo criterio que la integración con asistentes).

**D7 — `--yes` no existe; sin TTY `init` se rechaza de entrada.** `init` no acepta `--yes` y no se inventa un modo no interactivo. "`--yes`/sin TTY no pregunta y no vincula grupo" se cumple porque, sin terminal real, `init` se niega a arrancar. **Hallazgo durante la verificación en terminal real:** `cli.ts` pasaba siempre un objeto `terminal` a `runInitCommand`, y eso lo hacía contar como "interactivo" aunque stdin fuera un pipe: arrancaba las pantallas y moría después por stdin cerrado, contra lo documentado. Se corrigió en `cli.ts` pasando `interactive` según los TTY reales (prueba real por subproceso en `src/cli.test.ts`). Además hay guarda explícita en `resolveGroupPrompt` (`interactive:false` → nunca pregunta).

**D8 — Avisos de Engram.** Se muestran solo `DATABASE_MIGRATED` (con la ruta del respaldo si existe) y `PROJECT_REBOUND_FROM_FILE`, con texto del catálogo (nunca el `message` de Engram), sin bloquear. "Una sola vez": Engram ya avisa una sola vez y Shell además deduplica por `code+backup` dentro del proceso. Se leen de tres fuentes: `project.notices` de `startup-context` (chat) y `notices` de los resultados de `init --directory`, `group-create` y `group-bind` (init; la primera creación de grupo es justo la que migra la base). Los demás códigos (`PROJECT_FILE_CREATED`, `PROJECT_FILE_NOT_WRITTEN`) no se muestran. La ruta del respaldo se limpia de caracteres de control antes de pintarla.

**D9 — `PROJECT_FILE_INVALID` visible.** Un `project.json` inválido hace fallar `startup-context` (salida 1, sin ningún contexto). Hoy Shell lo trata como "sin memoria" en silencio. Ahora `getStartupContext` conserva el `code` del error de Engram y el chat muestra una advertencia del catálogo ("no se pudo leer `.forge614/project.json`; la memoria no se cargó; corrige o borra el archivo") una sola vez.

**D10 — Recepción sin proyecto (punto 5) DIFERIDA (decidido por la persona, 2026-09-23).** No existe en Shell ninguna lista de "proyectos recientes" (`grep` sin resultados; el acta 0003 la declara pendiente). Construirla es una entrega propia. Se deja listo el dato (parser tolerante de `group-list` con proyectos por grupo) y se reporta como pendiente. No se inventa pantalla.

**D11 — Códigos de error.** Los códigos existentes de Shell son kebab-case (deuda documentada en el acta 0013, migración 1:1 en su alineación; no se renombran: acta 0024). Los nuevos van en MAYÚSCULAS dentro del mismo `ShellErrorCode`: `GROUP_NAME_INVALID`, `GROUP_NAME_TAKEN`, `ENGRAM_GROUP_LIST_INVALID`, `ENGRAM_GROUP_RESULT_INVALID`. Los errores propios de Engram (`GROUP_EXISTS`, etc.) pasan literales, sin traducir ni envolver (regla existente).

**D12 — Bun.** `engines.bun >=1.3.9` y `packageManager: bun@1.4.2` en `package.json`. Shell **no tiene** carpeta `.github/` ni workflows, así que no hay `bun-version` que fijar aquí (se reporta). El paquete de release (`scripts/release-bundle.mjs`) es un bundle para Node y no incluye binario de Bun. `@types/bun` sigue en 1.3.8 (solo tipos; subirlo exige `bun install` y cambia `bun.lock`: se deja para el traspaso de release, se reporta).

**D13 — `notion-map.json`.** Guarda huellas del contenido ya sincronizado con Notion y `reviewedVersion`; ambas las actualiza el agente de sincronización tras publicar (historial: `acc2132`, `3c4dbe1`, `87a7eed`). Yo no publico en Notion, así que no toco huellas ni versión. Las páginas 05 y 07 (es/en) quedan **pendientes de sincronizar** y se listan en el reporte. No existe `CONTRACT.md` en Shell (`FORGE614_ECOSYSTEM_CONTRACT.md` es la copia del contrato del ecosistema, ajena a este cambio).

## Revisión enfocada (casos que la especificación no nombra)

1. Respuesta real de Engram 1.6.0 con campos extra en raíz, bloque, proyecto e ítem → no debe rechazarse (Tarea 1).
2. `shared` de 18 líneas + `ecosystem` + `project` → las tres capas llegan al asistente (D3, Tarea 2).
3. Contenido de `ecosystem` con etiqueta de cierre `</forge614-engram-memory>`, marcadores `<|...|>` o "ignore previous instructions" → saneado igual que `shared` (Tarea 2).
4. Carpeta que es subcarpeta de un repo Git con `project.json` en la raíz → no pregunta (Tarea 6).
5. Nombre de grupo nuevo repetido (ya existe) o con mayúsculas/espacios/guion doble o >64 → se vuelve a pedir con mensaje claro, sin llamar a Engram (Tarea 7).
6. `group-bind` o `group-create` falla a mitad (p. ej. `GROUP_EXISTS` por carrera) → resultado con el error de Engram y `init` sigue siendo éxito (Tarea 8).
7. Stdin se cierra mientras la pantalla de grupo espera → se aborta como las otras pantallas, sin más llamadas a Engram (Tarea 8).

## Mapa de archivos

| Archivo | Cambio |
|---|---|
| `package.json` | `engines.bun`, `packageManager` |
| `src/infrastructure/forge614-engram.ts` | tipos y guarda de `ecosystem`, cupo por ámbito, avisos, `code` de error, envoltorios de grupos |
| `src/infrastructure/engram-notices.ts` (nuevo) | parseo tolerante de `notices`, deduplicación, texto por catálogo |
| `src/infrastructure/project-identity.ts` (nuevo) | ¿es proyecto?, raíz, lectura de solo lectura de `.forge614/project.json`, decisión de preguntar |
| `src/ui/startup/group-picker.ts` (nuevo) | lista de grupos + divisor + acciones; pantalla de nombre |
| `src/contracts/engram-group.ts` (nuevo) | `EngramGroup`, `GroupChoice` |
| `src/app/init-engram.ts` | paso de grupo tras `init`, avisos en el resultado, opción `cwd` |
| `src/engines/claude/session.ts`, `src/engines/codex/session.ts`, `src/ui/basic/claude.ts`, `src/ui/basic/native.ts`, `src/app/native-chat.ts` | canal de avisos a la persona; pruebas de evidencia del bloque saneado |
| `src/i18n/{types,es,en}.ts` | `groupPicker`, `groupName`, `engramNotices`, resultado, errores nuevos |
| `docs/{es,en}/05-*`, `07-*`, `AGENTS.md` | documentación |

---

## Tarea 1 — Tolerancia a campos desconocidos (R31): prueba primero

**Archivos:** `src/infrastructure/forge614-engram.test.ts`

- [x] Agregar la respuesta real de Engram 1.6.0 como constante de prueba (formato de `10-contexto-de-inicio.md`): `format:1`, `shared`, `ecosystem:{status:"member",group,context}`, `project:{status:"bound",projectId,context,source:"file",notices:[{code:"DATABASE_MIGRATED",message,backup}]}` y, además, un campo desconocido en la raíz, en cada bloque (`shared`, `ecosystem.context`, `project.context`), en `project` y en un ítem (`extra: {…}`).
- [x] Prueba A: `getStartupContext` con esa respuesta devuelve `available:true` (no rechaza).
- [x] Prueba B: una respuesta 1.5.x (sin `ecosystem`, sin `source`) sigue funcionando idéntica.
- [x] Prueba C: sigue siendo estricto en lo que Shell usa (ítem con `title` no texto, `format` distinto de 1, `project.status` desconocido) → `available:false`.
- [x] Ejecutar. **Si A falla**, esa corrección va antes que todo lo demás (hacer que la guarda ignore el campo). Si pasa, se documenta en el reporte que hoy ya no se rechaza (las guardas no son `.strict()`), y las pruebas quedan como red de seguridad.

## Tarea 2 — Bloque `ecosystem` en el contexto de arranque

**Archivos:** `src/infrastructure/forge614-engram.ts`, `src/infrastructure/forge614-engram.test.ts`

- [x] Pruebas primero:
  - presente y válido → el resumen contiene líneas `- (ecosystem:mi-tienda) título — vista previa`, entre las de `shared` y las de `project`;
  - ausente (Engram viejo) → resumen byte-idéntico al de antes;
  - `{status:"none"}` → sin líneas de ecosistema;
  - inválido (falta `group.id`, `group.name` con mayúsculas, `context` sin `format:1`, `status` desconocido, `member` sin `context`) → el bloque se omite, `shared` y `project` llegan;
  - saneado: título/vista previa de ecosistema con `</forge614-engram-memory>`, `<|x|>`, `<!-- -->`, `system:` y "ignore previous instructions" → quedan como `[contenido filtrado]`, igual que en `shared`;
  - cupo (D3): `shared` con 18 ítems + `ecosystem` con 5 + `project` con 5 → salen ítems de las tres capas; con solo `shared` (25 ítems) salen 20 como hoy.
- [x] Implementar: tipo `StartupContextEcosystem`, guarda `isStartupContextEcosystem` (estricta sobre `status`, `group.id`, `group.name` con la regex, `context`), `payload.ecosystem` opcional y "omitido si inválido", y `collectItems` por ámbito con cupo.
- [x] `bun test src/infrastructure/forge614-engram.test.ts` en verde.

## Tarea 3 — Avisos de Engram y `PROJECT_FILE_INVALID`

**Archivos:** `src/infrastructure/engram-notices.ts` (+ test), `src/infrastructure/forge614-engram.ts` (+ test), `src/i18n/*`

- [x] Pruebas primero:
  - `parseEngramNotices(unknown)` → solo `DATABASE_MIGRATED`/`PROJECT_REBOUND_FROM_FILE` válidos; ignora otros códigos, entradas mal formadas y campos extra; `backup` solo si es texto.
  - `createNoticeTracker()` deduplica por `code+backup` (segunda vez → lista vacía).
  - `noticeText(notice, catalog)` usa el catálogo (es/en) y limpia caracteres de control de `backup`.
  - `getStartupContext` devuelve `notices` desde `project.notices` (y `[]` si no hay).
  - salida 1 con stderr `{"code":"PROJECT_FILE_INVALID",...}` → `{available:false, code:"PROJECT_FILE_INVALID"}`; cualquier otro fallo, sin `code` (comportamiento actual).
- [x] Implementar y hacer pasar.

## Tarea 4 — Catálogo i18n (es/en)

**Archivos:** `src/i18n/types.ts`, `es.ts`, `en.ts`

- [x] Agregar al tipo `Catalog` (el compilador exige ambos idiomas): `groupPicker` (título "Este repositorio aún no pertenece a ningún grupo.", encabezado "Grupos existentes", "Crear un grupo nuevo…", "Es un proyecto suelto (sin grupo)", pista de teclas, descripción de proyectos, "sin proyectos"), `groupName` (título, indicaciones, errores en línea), `engramNotices` (`databaseMigrated`, `projectReboundFromFile`, `projectFileInvalid`), líneas de resultado del paso de grupo (`groupBound`, `groupCreated`, `groupLoose`, `groupSkipped`, `groupFailed`) y los errores `GROUP_NAME_INVALID`, `GROUP_NAME_TAKEN`, `ENGRAM_GROUP_LIST_INVALID`, `ENGRAM_GROUP_RESULT_INVALID` en `ShellErrorCode` y `errors`.
- [x] `bun run typecheck` valida la paridad (si falta una clave en un idioma, no compila).

## Tarea 5 — Envoltorios de la CLI de Engram para grupos

**Archivos:** `src/infrastructure/forge614-engram.ts` (+ test), `src/contracts/engram-group.ts`

- [x] Pruebas primero (con `run` inyectado, verificando `args` exactos):
  - `listEngramGroups` → `["group-list"]`; parsea `{schemaVersion:1, groups:[{id,name,projects:[{projectId,name}]}]}` tolerando campos extra; forma inválida → `ShellError("ENGRAM_GROUP_LIST_INVALID")`; sin `groups` o `id` no texto → inválido; `projects` ausente → `[]`.
  - `bindEngramFolder(dir)` → `["init","--json","--directory",dir]`; extrae `project.projectId` y avisos; sin `projectId` → `ENGRAM_GROUP_RESULT_INVALID`.
  - `createEngramGroup(name)` → `["group-create","--name",name]`; extrae `group.id`/`group.name` y avisos.
  - `bindEngramGroup(projectId, groupId)` → `["group-bind","--project-id",id,"--group",gid]`; extrae avisos.
  - un fallo de Engram (`status:1`, stderr `{"code":"GROUP_EXISTS","error":"…"}`) → mensaje literal de Engram (mismo camino que hoy: `engram-command-failed`).
- [x] Implementar reutilizando `runEngramCommand`.

## Tarea 6 — ¿Hay que preguntar el grupo?

**Archivos:** `src/infrastructure/project-identity.ts` (+ test)

- [x] Pruebas primero, con carpetas temporales y `git` real solo donde haga falta:
  - carpeta sin Git ni manifiesto → no es proyecto → no pregunta;
  - Git sin archivo → pregunta; manifiesto sin archivo → pregunta;
  - archivo existente con `ecosystem` con grupo → no pregunta;
  - archivo existente con `ecosystem: null` → **no** pregunta (D5);
  - archivo ilegible o no-JSON → no pregunta;
  - subcarpeta de un repo con archivo en la raíz → no pregunta;
  - `interactive:false` → nunca pregunta.
- [x] Implementar `resolveGroupPrompt({cwd, interactive}) → {ask:false} | {ask:true, root}`; Shell jamás escribe en `.forge614/`.

## Tarea 7 — Pantalla de selección de grupo

**Archivos:** `src/ui/startup/group-picker.ts` (+ test), `src/contracts/engram-group.ts`

- [x] Pruebas primero con `TestTerminal` (estilo de `engram-init.test.ts`):
  - con grupos: texto exacto del título, "Grupos existentes", cada grupo con sus proyectos, línea divisoria, "Crear un grupo nuevo…", "Es un proyecto suelto (sin grupo)"; ↑/↓ y Enter; Enter en un grupo → `{kind:"existing", group}`;
  - sin grupos: la primera sección **no** aparece; quedan las dos acciones;
  - "Es un proyecto suelto" → `{kind:"loose"}`; Esc/Ctrl+C/Ctrl+D → `undefined`; señal abortada → `undefined` sin mostrar nada más;
  - "Crear un grupo nuevo…" → pide nombre; rechaza vacío, mayúsculas, espacios, `--` doble, guion inicial/final, >64; rechaza nombre ya existente (sin distinguir mayúsculas, lista recibida); acepta `mi-tienda` → `{kind:"new", name}`; Esc vuelve a la lista;
  - una línea larga (muchos proyectos) se recorta con `…` a 80 columnas.
- [x] Implementar componente propio (patrón de `multi-select.ts`) y `chooseGroup(groups, screen, locale, signal)`.

## Tarea 8 — Integración en `init --product engram`

**Archivos:** `src/app/init-engram.ts` (+ test)

- [x] Pruebas primero (con `run` stub y `TestTerminal`; ampliar `RunInitOptions` con `cwd`):
  - grupos + proyecto sin archivo: se llama `group-list`, se elige uno existente → secuencia exacta `init --json --directory` → `group-bind`; resultado con línea "vinculado al grupo";
  - sin grupos → primera sección ausente; "grupo nuevo" → `init --directory` → `group-create` → `group-bind`;
  - "proyecto suelto" → solo `init --json --directory`, sin `group-*`;
  - archivo ya presente → no se llama `group-list`, no aparece la pantalla;
  - carpeta que no es proyecto → no aparece;
  - sin TTY (`interactive:false`) → error `requiresInteractiveTerminal` y **cero** llamadas a Engram (D7);
  - Esc en la pantalla → sin vinculación, el flujo continúa a asistentes;
  - fallo de `group-bind` → línea de error con el texto de Engram; `process.exitCode` no cambia; el resto del flujo continúa;
  - `DATABASE_MIGRATED` en `group-create` → aparece una vez en el resultado, con la ruta del respaldo, en es y en en;
  - Shell nunca escribe: el árbol de la carpeta de prueba es idéntico antes/después salvo lo que haga el stub de Engram (que no escribe nada);
  - stdin cerrado durante la pantalla → aborta sin más llamadas.
- [x] Implementar `runGroupStep` y sus líneas de resultado; insertarlo entre `applyEngramInit` y `runMemorySetupStep`.

## Tarea 9 — Sesiones de chat: avisos y evidencia del bloque saneado

**Archivos:** `src/engines/claude/session.ts`, `src/engines/codex/session.ts`, `src/ui/basic/claude.ts`, `src/ui/basic/native.ts`, `src/app/native-chat.ts` (+ tests)

- [x] Pruebas primero, con `getStartupContext` real sobre un `run` stub que devuelve la respuesta 1.6.0 con contenido malicioso en `ecosystem`:
  - Claude: el `append` del `systemPrompt` contiene las líneas de ecosistema **dentro** de `<forge614-engram-memory>…</forge614-engram-memory>`, con la etiqueta de cierre falsificada ya neutralizada, y una sola etiqueta de cierre;
  - Codex: el primer `turn/start` lleva el mismo bloque delimitado como dato;
  - Engram viejo (sin `ecosystem`): ambos idénticos a hoy;
  - avisos: al primer envío cada sesión entrega los avisos una sola vez (una segunda conversación con el mismo aviso no lo repite); `PROJECT_FILE_INVALID` genera advertencia una sola vez; el chat sigue funcionando sin memoria.
- [x] Implementar `notify` opcional en las dependencias de ambas sesiones, cableado desde la raíz de composición (`claude.ts`, `native-chat.ts`/`native.ts`) al `write` de la transcripción, con texto del catálogo.

## Tarea 10 — Bun y documentación

**Archivos:** `package.json` (+ prueba), `docs/{es,en}/05-*.md`, `docs/{es,en}/07-*.md`, `AGENTS.md`

- [x] Prueba primero (`tests/integration/package-engines.test.ts`): `engines.bun === ">=1.3.9"` y `packageManager === "bun@1.4.2"`.
- [x] Editar `package.json`.
- [x] Doc 07 (es/en): pantalla de grupo (cuándo aparece y cuándo no, orden del flujo, qué comandos aplica, "Shell nunca escribe `project.json`"), avisos, `PROJECT_FILE_INVALID`, límite conocido (D5) y que las memorias de grupo aún no se replican a PostgreSQL (llega en Engram 1.7.0).
- [x] Doc 05 (es/en): los tres ámbitos en el chat, avisos y advertencia dentro de la transcripción; recepción sin proyecto = pendiente.
- [x] `AGENTS.md`: viñeta corta en la sección 2 — todo adaptador de chat debe inyectar `shared`, `ecosystem` y `project` (vía `getStartupContext`) y entregar los avisos.
- [x] No tocar `docs/notion-map.json` (D13).

## Tarea 11 — Verificación

- [x] `bun test` completo, `bun run typecheck`, `bun run build` (`bun run check`), pegando la salida real en el reporte.
- [x] Verificación PTY real: `FORGE614_HOME` temporal con el binario real de Engram enlazado, carpeta Git temporal, tres capturas de la pantalla (con grupos, sin grupos, nombre de grupo nuevo con error de validación) y comprobación de que solo Engram escribió `.forge614/project.json`.
- [x] Evidencia del bloque `ecosystem` saneado llegando al asistente (salida de las pruebas de la Tarea 9).
- [x] Reporte con prefijo "Shell:", archivos, pruebas, render, evidencia y "Impacto en el procedimiento de agentes: Sí".

---

## Estado al cierre (2026-09-23)

Todas las tareas ejecutadas. Sin commit, merge, tag, push ni publicación. Pendiente fuera de este plan: recepción sin proyecto (D10), sincronización de las páginas 05 y 07 en Notion (D13), subir `@types/bun` a 1.4.2 en el traspaso de release (D12).
