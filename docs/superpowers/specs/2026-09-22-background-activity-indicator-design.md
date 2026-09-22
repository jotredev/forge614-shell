# Indicador de actividad en segundo plano

**Date:** 2026-09-22
**Status:** Propuesto — pendiente de aprobación antes de implementar.
**Governs:** Mostrar en Shell, de forma honesta y basada solo en lo que cada protocolo de motor realmente reporta, cuándo el asistente activo tiene agentes o procesos corriendo en segundo plano.
**Constrained by:** [`AGENTS.md`](../../../AGENTS.md) (secciones 2 y 3: un adaptador de chat es trabajo separado de la detección MCP; la señal de "tool en uso" es específica de cada protocolo y debe verificarse en vivo, nunca asumirse). No introduce escaneo de PATH ni lanzamiento de binarios nativos.

## 1. Propósito

Hoy Shell no muestra nada mientras Claude Code o Codex tienen trabajo corriendo en segundo plano (subagentes, comandos backgroundeados). La persona no tiene forma de saber que algo sigue vivo. Este documento define una señal visible — un contador en la barra de estado y una lista en el panel lateral — alimentada **únicamente** por eventos reales del protocolo de cada motor. Si un motor no reporta esa información de forma distinguible, Shell lo dice explícitamente en vez de fingir que no hay actividad.

## 2. Alcance

### Dentro de alcance
- Un modelo único `BackgroundActivity` en `src/engines/types.ts`.
- Alimentar ese modelo desde `src/engines/claude/session.ts` usando eventos reales y ya verificados del SDK de Claude Code.
- Documentar, con evidencia real, que `src/engines/codex/session.ts` no tiene hoy ninguna señal distinguible de trabajo en segundo plano — y dejar el mecanismo de detección listo para activarse solo el día que eso cambie (feature-detection, nunca un id de motor hardcodeado).
- Un contador en `ShellStatusBar` y una lista expandible en `ShellSidebar`, reutilizando `ActivityCard` y el punto animado existente de `composer.ts`.
- Textos vía el catálogo i18n (`es`/`en`), con paridad garantizada por `tsc`.
- Pruebas con dobles de sesión para: aparición, transición a hecho/fallido, motor que no reporta, y varias actividades simultáneas.

### Fuera de alcance
- Cualquier lectura de procesos del sistema operativo o del `PATH`. La señal viene solo del protocolo del motor.
- Cancelar o controlar una actividad en segundo plano desde Shell — solo se muestra, no se gestiona.
- Verificación en vivo contra un `codex app-server` real ejecutando trabajo async (ver sección 3.2) — queda como trabajo futuro explícito, no bloquea esta entrega porque la conclusión "Codex no lo reporta hoy" ya es honesta y accionable con la evidencia local disponible.

## 3. Hallazgos reales en los que se basa este diseño

### 3.1 Claude Code (`@anthropic-ai/claude-agent-sdk@0.3.274`)

Verificado leyendo directamente `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (no documentación externa) y `src/engines/claude/session.ts`.

El SDK emite mensajes `type: 'system'`, discriminados por `subtype`, específicamente para tareas en segundo plano:

- **`SDKTaskStartedMessage`** (`subtype: 'task_started'`): `task_id`, `tool_use_id?`, `description`, `subagent_type?`, `is_backgrounded?`, `spawn_depth?`, `task_type?` (conjunto abierto: `local_agent` | `local_bash` | `local_workflow` | `mcp_task` | otros), `workflow_name?`, `prompt?`, `skip_transcript?`, `ambient?`.
- **`SDKTaskUpdatedMessage`** (`subtype: 'task_updated'`): `task_id`, `patch: { status?: 'pending'|'running'|'completed'|'failed'|'killed'|'paused', description?, end_time?, total_paused_ms?, error?, is_backgrounded? }`. El SDK documenta explícitamente: "clients merge into their local task map".
- **`SDKTaskProgressMessage`** (`subtype: 'task_progress'`): `task_id`, `summary?` (línea de estado en vivo), `usage`, `last_tool_name?`.
- **`SDKTaskNotificationMessage`** (`subtype: 'task_notification'`): `task_id`, `status: 'completed'|'failed'|'stopped'`, `summary`, `output_file`, `reason?: 'worker_restart'`, `ambient?`. Es el cierre definitivo de una tarea.
- **`SDKBackgroundTasksChangedMessage`** (`subtype: 'background_tasks_changed'`): `tasks: { task_id, task_type, description, ambient? }[]`. El propio SDK documenta esto como **señal de nivel, con semántica de reemplazo completo** — no de edge — precisamente para que un `task_started`/`task_notification` perdido no deje el indicador atascado en "corriendo". Se resetea a vacío cada vez que el proceso CLI se reinicia; no se emite nada al arrancar salvo que sea una reinicialización de un proceso ya vivo.

**Certeza:** `task_id` correlaciona `task_started` → `task_progress` → `task_updated` → `task_notification`. El propio SDK marca `ambient` como "tareas que no son actividad... los hosts deben excluirlas de los indicadores de actividad" — instrucción explícita, no interpretación nuestra.

**No verificado sin sesión en vivo:** el orden real de llegada entre `background_tasks_changed` y los eventos de edge (el SDK dice que es "unspecified"), y si `ambient`/`is_backgrounded` se pueblan de forma consistente en todas las versiones de CLI instaladas por distintos usuarios ("absent on older CLIs" aparece en varios campos relacionados).

`src/engines/claude/session.ts:154-159` hoy solo intercepta `subtype: 'init'` y `subtype: 'commands_changed'`; todo lo demás — incluidos estos cinco subtypes — se reemite crudo vía `onEvent(event)` sin que Shell lo interprete.

### 3.2 Codex app-server

Verificado leyendo `src/engines/codex/session.ts` completo, sus tests (`session.test.ts`), y buscando en `node_modules` cualquier esquema vendorizado del protocolo real de `codex app-server` (no existe ninguno; los únicos paquetes relacionados son de `@earendil-works/pi-ai`, un adaptador distinto al RPC del app-server).

- `item/started` / `item/completed` llegan como notificaciones JSON-RPC filtradas por `params.threadId` (`session.ts:286-301`).
- `item.type` que el código ya maneja: `mcpToolCall` (con `item.server`/`item.tool`/`item.arguments`, solo en `item/started`), `commandExecution` y `fileChange` (solo en `item/started`), `agentMessage` (solo en `item/completed`).
- **`item/completed` solo se procesa para `agentMessage`.** Para `mcpToolCall`, `commandExecution` y `fileChange`, Shell hoy no sabe cuándo terminan, ni si tuvieron éxito o fallaron — no hay ninguna señal de cierre para esos tipos, sean o no en segundo plano.
- No existe, en código, tests ni tipos locales, ningún `item.type` ni campo (`backgroundTask`, `subtask`, `background: true`, etc.) que distinga trabajo en segundo plano de una llamada síncrona normal.

**Conclusión explícita:** con la evidencia disponible localmente, **Codex app-server no reporta actividad en segundo plano de forma distinguible hoy**. La única confirmación en vivo que existe en este repo es la de `mcpToolCall` (documentada en `AGENTS.md`, fechada 2026-09-20), y no cubre background ni sub-tareas. Confirmar o descartar esto con certeza requeriría repetir esa misma verificación en vivo contra el binario real de `app-server`, ejecutando una tarea que dispare trabajo asíncrono real — eso queda fuera de esta entrega (ver sección 2, "Fuera de alcance") y debe hacerse antes de asumir que Codex sí reporta algo en el futuro.

## 4. Modelo de datos

`src/engines/types.ts`:

```ts
export type BackgroundActivityKind = "agent" | "process";
export type BackgroundActivityState = "running" | "done" | "failed";

export interface BackgroundActivity {
  id: string;
  kind: BackgroundActivityKind;
  label: string;
  state: BackgroundActivityState;
  startedAt: number;
  endedAt?: number;
  detail?: string;
}
```

`NativeSession` gana un método **opcional** (mismo patrón ya usado por `workModes?()`/`workMode?()`/`setWorkMode?()`: su sola presencia es la señal de "este motor sabe reportar esto"):

```ts
backgroundActivity?(): BackgroundActivity[];
```

`CodexSession` **no implementa este método** — omitirlo es la forma honesta de decir "no lo sé" sin inventar un array vacío que parecería "sé que no hay nada corriendo". `src/ui/basic/native.ts` (el runner genérico de Codex) detecta la ausencia con `typeof session.backgroundActivity === "function"` y por eso nunca hardcodea el id del motor — el día que Codex app-server pruebe en vivo que sí reporta esto, alcanza con añadir el método a `CodexSession` para que la UI lo recoja automáticamente.

`ClaudeSession` no implementa `NativeSession` (tiene su propia UI dedicada en `src/ui/basic/claude.ts`, como ya establece `AGENTS.md` sección 2). Ahí `backgroundActivity` es un campo público plano, igual que `usage`/`context`/`commands`, actualizado dentro del bucle de `send()`.

### Decisiones de mapeo (Claude)

- Se excluye toda tarea con `ambient === true`, siguiendo la instrucción explícita del propio SDK.
- `kind`: `task_type === 'local_bash'` → `"process"`; cualquier otro valor (`local_agent`, `local_workflow`, `mcp_task`, desconocido) → `"agent"`, porque es trabajo dirigido por el modelo, no un proceso de SO crudo.
- `label`: `description`; si falta, `subagent_type` o `task_id` como último recurso.
- `state`: `task_updated.patch.status` — `pending`/`running`/`paused` → `"running"`; `completed` → `"done"`; `failed`/`killed` → `"failed"` (el tipo del task solo admite tres estados; `killed` se trata como fallo porque no terminó con éxito). `task_notification.status` — `completed` → `"done"`; `failed`/`stopped` → `"failed"` (detenida antes de completar no es un éxito).
- `background_tasks_changed` se usa como reconciliación de nivel: cualquier `task_id` que desaparezca de esa lista sin haber recibido un cierre explícito (`task_updated`/`task_notification`) se marca `"done"` en ese momento — así un bookend perdido nunca deja una fila atascada en "corriendo", tal como el propio SDK recomienda.
- `detail`: `task_notification.summary`, o `task_updated.patch.error` si la tarea falló y no hay `summary` todavía.

## 5. Interfaz

- **Barra de estado** (`ShellStatusBar`): un segmento nuevo, solo visible cuando hay ≥1 actividad activa (`state === "running"`), con el conteo y el punto animado existente (`composer.ts` `SPINNER_FRAMES`, exportado como `spinnerFrame(active: boolean)`).
- **Panel lateral** (`ShellSidebar`): una sección nueva (mismo patrón `heading()` que el resto de secciones) que siempre se muestra mientras la cuenta está conectada:
  - Si el motor no soporta esto (`backgroundActivitySupported === false`): una línea, "este motor no informa actividad en segundo plano".
  - Si lo soporta y no hay actividad: una línea de estado vacío.
  - Si hay actividad: una fila por `BackgroundActivity`, reutilizando `ActivityCard` (`new ActivityCard(label, "<estado> · <transcurrido>", detail, expanded)`), con clic para expandir/colapsar y ver `detail` cuando el motor lo entregó. El estado de expansión se rastrea en `ShellSidebar` por `id`, igual que ya rastrea `refreshRow` para el clic de refrescar cuota.

## 6. Textos (i18n)

Nuevo namespace `backgroundActivity` en `Catalog` (`src/i18n/types.ts`, con `es.ts`/`en.ts`): `heading`, `running`, `done`, `failed`, `idle`, `notReportedByEngine`, `elapsedSeconds({seconds})`, `elapsedMinutes({minutes})`, `statusBarCount({count})`.

## 7. Impacto en el procedimiento de agentes

**Sí.** `AGENTS.md` sección 3 ya establece que la señal de "tool en uso" es específica de cada protocolo y debe verificarse en vivo por motor. Este documento añade la misma regla para "actividad en segundo plano": un asistente nuevo (o una nueva versión de uno existente) debe declarar explícitamente, con evidencia real citada, si su protocolo reporta trabajo en segundo plano de forma distinguible — nunca se asume por analogía con Claude o Codex. Se debe añadir una entrada a la sección 3 de `AGENTS.md` señalando esto como regla general, una vez este plan se implemente.
