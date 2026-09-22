# Indicador de actividad en segundo plano — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar en Shell, con eventos reales de cada motor (nunca inventados), cuándo hay agentes o procesos en segundo plano — contador en la barra de estado y lista expandible en el panel lateral.

**Architecture:** Un modelo `BackgroundActivity` único en `src/engines/types.ts`. `ClaudeSession` lo alimenta desde los eventos `task_*`/`background_tasks_changed` reales del SDK (campo público). `NativeSession` gana un método opcional del mismo nombre — su sola presencia es la señal de soporte — que `CodexSession` no implementa porque no hay evidencia de que Codex reporte esto hoy. La UI (`ShellSidebar`, `ShellStatusBar`) lee el modelo vía `ShellSnapshot`, reutilizando `ActivityCard` y el punto animado de `composer.ts`.

**Tech Stack:** TypeScript, Bun test runner, `@anthropic-ai/claude-agent-sdk@0.3.274`, `@earendil-works/pi-tui`.

**Spec:** [`docs/superpowers/specs/2026-09-22-background-activity-indicator-design.md`](../specs/2026-09-22-background-activity-indicator-design.md)

## Global Constraints

- Todo texto para personas es bilingüe es/en vía `src/i18n/` — nunca texto suelto en el código de UI.
- Nunca inventar estado: si un motor no reporta actividad en segundo plano de forma distinguible, Shell lo dice explícitamente en vez de mostrar una lista vacía silenciosa.
- `ambient === true` (Claude) se excluye siempre de los indicadores, por instrucción explícita del SDK.
- No se introduce escaneo de `PATH` ni lanzamiento de binarios nativos.
- Sin commits ni push — cada tarea termina en "listo para revisión", el commit lo hace la persona.
- `bun run check` (typecheck + suite completa + build) debe quedar limpio antes de reportar la tarea como terminada.

---

### Task 1: Modelo `BackgroundActivity` y transporte en `ShellSnapshot`

**Files:**
- Modify: `src/engines/types.ts`
- Modify: `src/ui/basic/shell-state.ts`
- Test: `src/ui/basic/shell-state.test.ts`

**Interfaces:**
- Produces: `BackgroundActivity`, `BackgroundActivityKind`, `BackgroundActivityState` (desde `src/engines/types.ts`); `ShellSnapshot.backgroundActivity?: BackgroundActivity[]`; `ShellSnapshot.backgroundActivitySupported?: boolean`; `NativeSession.backgroundActivity?(): BackgroundActivity[]`.

- [ ] **Step 1: Escribir el test que falla**

Añadir a `src/ui/basic/shell-state.test.ts`:

```ts
test("connect() carries background activity and its support flag through to the snapshot", () => {
  const state = new ShellState("claude");
  const activity = { id: "t1", kind: "agent" as const, label: "Investigar X", state: "running" as const, startedAt: Date.now() };
  state.connect({ backgroundActivity: [activity], backgroundActivitySupported: true });
  const snapshot = state.snapshot();
  expect(snapshot.backgroundActivity).toEqual([activity]);
  expect(snapshot.backgroundActivitySupported).toBe(true);
});

test("snapshot omits background activity fields when the engine never reported them", () => {
  const state = new ShellState("codex");
  state.connect({});
  expect(state.snapshot().backgroundActivity).toBeUndefined();
  expect(state.snapshot().backgroundActivitySupported).toBeUndefined();
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `bun test src/ui/basic/shell-state.test.ts`
Expected: FAIL — `ConnectedDetails`/`ShellSnapshot` no tienen esos campos, error de tipos o `undefined` inesperado.

- [ ] **Step 3: Implementación mínima**

En `src/engines/types.ts`, añadir junto a las demás exportaciones de tipos (antes de `NativeEvent`):

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

Y en `NativeSession`, junto a `workModes?`/`workMode?`/`setWorkMode?`:

```ts
  backgroundActivity?(): BackgroundActivity[];
```

En `src/ui/basic/shell-state.ts`, importar el tipo y extender `ConnectedDetails`/`ShellSnapshot`:

```ts
import type { BackgroundActivity } from "../../engines/types.ts";
```

Añadir a `ConnectedDetails` y a `ShellSnapshot`:

```ts
  backgroundActivity?: BackgroundActivity[];
  backgroundActivitySupported?: boolean;
```

`update()`/`connect()`/`snapshot()` ya copian todo `ConnectedDetails` por spread (`...this.details`) — no requieren cambios adicionales.

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `bun test src/ui/basic/shell-state.test.ts`
Expected: PASS

- [ ] **Step 5: Listo para revisión**

No hacer `git add`/`git commit` — Git es de solo lectura para agentes en este repo (ver `AGENTS.md`). Dejar los archivos modificados en el árbol de trabajo; la persona revisa y comitea.

---

### Task 2: `ClaudeSession` interpreta los eventos reales `task_*` del SDK

**Files:**
- Modify: `src/engines/claude/session.ts`
- Test: `src/engines/claude/session.test.ts`

**Interfaces:**
- Consumes: `BackgroundActivity` (Task 1).
- Produces: `ClaudeSession.backgroundActivity: BackgroundActivity[]` (campo público, actualizado durante `send()`).

- [ ] **Step 1: Escribir el test que falla**

Añadir a `src/engines/claude/session.test.ts` (usar el mismo patrón `run: () => (async function* () { yield ... as SDKMessage; })()` que ya usan los tests vecinos de este archivo):

```ts
test("background activity tracks a subagent task from start through its terminal notification", async () => {
  const session = new ClaudeSession({
    cwd: "/tmp", executable: "claude", env: {}, authenticate: async () => {},
    run: () => (async function* () {
      yield { type: "system", subtype: "task_started", task_id: "t1", description: "Investigar X", task_type: "local_agent", is_backgrounded: true, uuid: "u1", session_id: "s" } as SDKMessage;
      yield { type: "system", subtype: "task_updated", task_id: "t1", patch: { status: "running" }, uuid: "u2", session_id: "s" } as SDKMessage;
      yield { type: "system", subtype: "task_notification", task_id: "t1", status: "completed", summary: "Listo", output_file: "/tmp/out", uuid: "u3", session_id: "s" } as SDKMessage;
      yield { type: "result", subtype: "success", session_id: "s", is_error: false } as SDKMessage;
    })(),
  });
  await session.send("hazlo en segundo plano", () => {}, async () => true);
  expect(session.backgroundActivity).toEqual([
    expect.objectContaining({ id: "t1", kind: "agent", label: "Investigar X", state: "done", detail: "Listo" }),
  ]);
});

test("background activity excludes ambient/housekeeping tasks, per the SDK's own guidance", async () => {
  const session = new ClaudeSession({
    cwd: "/tmp", executable: "claude", env: {}, authenticate: async () => {},
    run: () => (async function* () {
      yield { type: "system", subtype: "task_started", task_id: "t1", description: "housekeeping", ambient: true, uuid: "u1", session_id: "s" } as SDKMessage;
      yield { type: "result", subtype: "success", session_id: "s", is_error: false } as SDKMessage;
    })(),
  });
  await session.send("go", () => {}, async () => true);
  expect(session.backgroundActivity).toEqual([]);
});

test("a task_id missing from a background_tasks_changed snapshot without an explicit close is marked done", async () => {
  const session = new ClaudeSession({
    cwd: "/tmp", executable: "claude", env: {}, authenticate: async () => {},
    run: () => (async function* () {
      yield { type: "system", subtype: "task_started", task_id: "t1", description: "bash job", task_type: "local_bash", uuid: "u1", session_id: "s" } as SDKMessage;
      yield { type: "system", subtype: "background_tasks_changed", tasks: [], uuid: "u2", session_id: "s" } as SDKMessage;
      yield { type: "result", subtype: "success", session_id: "s", is_error: false } as SDKMessage;
    })(),
  });
  await session.send("go", () => {}, async () => true);
  expect(session.backgroundActivity).toEqual([
    expect.objectContaining({ id: "t1", kind: "process", state: "done" }),
  ]);
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `bun test src/engines/claude/session.test.ts`
Expected: FAIL — `session.backgroundActivity` es `undefined` (el campo no existe todavía).

- [ ] **Step 3: Implementación mínima**

En `src/engines/claude/session.ts`, añadir el campo público junto a los demás (`usage`, `context`, etc., cerca de la línea 55):

```ts
  backgroundActivity: BackgroundActivity[] = [];
```

Y su import junto a los tipos del SDK ya importados en la línea 2:

```ts
import type { BackgroundActivity } from "../types.ts";
```

Añadir un helper privado antes de la clase `ClaudeSession` (después de `wrapStartupContext`):

```ts
function backgroundKind(taskType: string | undefined): BackgroundActivityKind {
  return taskType === "local_bash" ? "process" : "agent";
}

function applyTaskEvent(tasks: Map<string, BackgroundActivity>, event: SDKMessage): void {
  if (event.type !== "system") return;
  if (event.subtype === "task_started") {
    if (event.ambient) return;
    tasks.set(event.task_id, {
      id: event.task_id, kind: backgroundKind(event.task_type),
      label: event.description || event.subagent_type || event.task_id,
      state: "running", startedAt: Date.now(),
    });
    return;
  }
  if (event.subtype === "task_updated") {
    const task = tasks.get(event.task_id);
    if (!task) return;
    const status = event.patch.status;
    if (status === "completed") { task.state = "done"; task.endedAt = Date.now(); }
    else if (status === "failed" || status === "killed") { task.state = "failed"; task.endedAt = Date.now(); task.detail ??= event.patch.error; }
    return;
  }
  if (event.subtype === "task_notification") {
    const task = tasks.get(event.task_id);
    if (!task) return;
    task.state = event.status === "completed" ? "done" : "failed";
    task.endedAt = Date.now();
    task.detail = event.summary;
    return;
  }
  if (event.subtype === "background_tasks_changed") {
    const stillRunning = new Set(event.tasks.filter(entry => !entry.ambient).map(entry => entry.task_id));
    for (const task of tasks.values()) {
      if (task.state === "running" && !stillRunning.has(task.id)) { task.state = "done"; task.endedAt = Date.now(); }
    }
  }
}
```

En `send()`, junto al bucle existente (líneas ~154-158), mantener un `Map` local y volcarlo al campo público en cada iteración:

```ts
      const tasks = new Map<string, BackgroundActivity>();
      for await (const event of run({ prompt, options })) {
        if (event.type === "system" && event.subtype === "init") this.sessionId = event.session_id;
        if (event.type === "system" && event.subtype === "commands_changed") this.commands = event.commands;
        if (event.type === "result") resultSeen = true;
        applyTaskEvent(tasks, event);
        this.backgroundActivity = [...tasks.values()];
        onEvent(event);
      }
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `bun test src/engines/claude/session.test.ts`
Expected: PASS

- [ ] **Step 5: Listo para revisión**

No hacer `git add`/`git commit` — Git es de solo lectura para agentes en este repo (ver `AGENTS.md`). Dejar los archivos modificados en el árbol de trabajo; la persona revisa y comitea.

---

### Task 3: Documentar y fijar con un test que Codex no reporta esto hoy

**Files:**
- Test: `src/engines/codex/session.test.ts`

**Interfaces:**
- Consumes: `CodexSession` (sin cambios de código en este task — es intencional, ver spec sección 3.2).

- [ ] **Step 1: Escribir el test que fija el hallazgo**

Añadir a `src/engines/codex/session.test.ts`:

```ts
test("Codex reports no background activity today — no session emits it until a live app-server probe proves otherwise (see docs/superpowers/specs/2026-09-22-background-activity-indicator-design.md §3.2)", async () => {
  const rpc = codexFixture();
  const session = new CodexSession(rpc, "/project", () => {}, async () => false);
  expect(typeof (session as unknown as { backgroundActivity?: () => unknown }).backgroundActivity).toBe("undefined");
});
```

- [ ] **Step 2: Ejecutar y confirmar que pasa de inmediato**

Run: `bun test src/engines/codex/session.test.ts`
Expected: PASS de inmediato — no requiere cambios de implementación, porque `CodexSession` nunca declaró ese método. Este test existe para que un cambio futuro que añada un `backgroundActivity()` falso (sin evidencia real) rompa la suite y fuerce releer la spec.

- [ ] **Step 3: Listo para revisión**

No hacer `git add`/`git commit` — Git es de solo lectura para agentes en este repo (ver `AGENTS.md`). Dejar el archivo modificado en el árbol de trabajo; la persona revisa y comitea.

---

### Task 4: `spinnerFrame` reutilizable desde `composer.ts`

**Files:**
- Modify: `src/ui/basic/composer.ts`
- Test: `src/ui/basic/composer.ts` no tiene test propio hoy para `statusDot`; añadir cobertura mínima en `src/ui/basic/workspace-chrome.test.ts`, que ya prueba el punto de estado.

**Interfaces:**
- Produces: `spinnerFrame(active: boolean): string` (exportado desde `composer.ts`).

- [ ] **Step 1: Escribir el test que falla**

Añadir a `src/ui/basic/workspace-chrome.test.ts`:

```ts
test("spinnerFrame exposes the same animated dot the composer status uses", () => {
  expect(spinnerFrame(false)).toBe("●");
  const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  expect(SPINNER_FRAMES).toContain(spinnerFrame(true));
});
```

Y su import junto a los demás de ese archivo:

```ts
import { spinnerFrame } from "./composer.ts";
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `bun test src/ui/basic/workspace-chrome.test.ts`
Expected: FAIL — `spinnerFrame` no está exportado desde `composer.ts`.

- [ ] **Step 3: Implementación mínima**

En `src/ui/basic/composer.ts`, junto a la definición actual de `SPINNER_FRAMES`/`statusDot` (línea ~69-73), exportar el helper genérico sin cambiar el comportamiento existente:

```ts
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/** A live-moving dot while active — a static label reads as frozen once the person stares at it. */
export function spinnerFrame(active: boolean): string {
  return active ? SPINNER_FRAMES[Math.floor(Date.now() / 120) % SPINNER_FRAMES.length]! : "●";
}
/** A live-moving dot while busy — a static label reads as frozen once the person stares at it. */
function statusDot(status: string): string {
  return spinnerFrame(isWorkingStatus(status));
}
```

(Se elimina la declaración anterior, no exportada, de `SPINNER_FRAMES` y de `statusDot`, reemplazándolas por estas.)

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `bun test src/ui/basic/workspace-chrome.test.ts`
Expected: PASS

- [ ] **Step 5: Listo para revisión**

No hacer `git add`/`git commit` — Git es de solo lectura para agentes en este repo (ver `AGENTS.md`). Dejar los archivos modificados en el árbol de trabajo; la persona revisa y comitea.

---

### Task 5: Textos i18n (`backgroundActivity`)

**Files:**
- Modify: `src/i18n/types.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/es.ts`

**Interfaces:**
- Produces: `Catalog.backgroundActivity` con: `heading`, `running`, `done`, `failed`, `idle`, `notReportedByEngine`, `elapsedSeconds({seconds})`, `elapsedMinutes({minutes})`, `statusBarCount({count})`.

- [ ] **Step 1: Añadir el bloque a la interfaz (esto ya actúa como "test que falla": `tsc` rompe hasta que ambos catálogos lo implementen)**

En `src/i18n/types.ts`, dentro de `Catalog`, junto a `statusBar`:

```ts
  backgroundActivity: {
    heading: string;
    running: string;
    done: string;
    failed: string;
    idle: string;
    notReportedByEngine: string;
    elapsedSeconds: (params: { seconds: number }) => string;
    elapsedMinutes: (params: { minutes: number }) => string;
    statusBarCount: (params: { count: number }) => string;
  };
```

- [ ] **Step 2: Ejecutar el typecheck y confirmar que falla**

Run: `bun run typecheck` (o `tsc --noEmit`, según `package.json`)
Expected: FAIL en `src/i18n/en.ts` y `src/i18n/es.ts` — falta la propiedad `backgroundActivity`.

- [ ] **Step 3: Implementar ambos catálogos**

En `src/i18n/en.ts`, junto a `statusBar`:

```ts
  backgroundActivity: {
    heading: "Background activity",
    running: "running",
    done: "done",
    failed: "failed",
    idle: "Nothing running in the background right now.",
    notReportedByEngine: "This engine doesn't report background activity.",
    elapsedSeconds: ({ seconds }) => `${seconds}s`,
    elapsedMinutes: ({ minutes }) => `${minutes}m`,
    statusBarCount: ({ count }) => `${count} background`,
  },
```

En `src/i18n/es.ts`, junto a `statusBar`:

```ts
  backgroundActivity: {
    heading: "Actividad en segundo plano",
    running: "corriendo",
    done: "hecho",
    failed: "fallido",
    idle: "Nada corriendo en segundo plano por ahora.",
    notReportedByEngine: "Este motor no informa actividad en segundo plano.",
    elapsedSeconds: ({ seconds }) => `${seconds}s`,
    elapsedMinutes: ({ minutes }) => `${minutes}m`,
    statusBarCount: ({ count }) => `${count} en segundo plano`,
  },
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `bun run typecheck && bun test src/i18n/index.test.ts`
Expected: PASS

- [ ] **Step 5: Listo para revisión**

No hacer `git add`/`git commit` — Git es de solo lectura para agentes en este repo (ver `AGENTS.md`). Dejar los archivos modificados en el árbol de trabajo; la persona revisa y comitea.

---

### Task 6: `ShellSidebar` muestra la lista de actividad en segundo plano

**Files:**
- Modify: `src/ui/basic/sidebar.ts`
- Test: `src/ui/basic/sidebar.test.ts`

**Interfaces:**
- Consumes: `ShellSnapshot.backgroundActivity`, `ShellSnapshot.backgroundActivitySupported` (Task 1); `ActivityCard` (`./transcript.ts`, ya existente); `Catalog.backgroundActivity` (Task 5).
- Produces: `ShellSidebar` expone el nuevo bloque en `render()`; clic en una fila alterna expansión (mismo patrón que `refreshRow`/`handleMouse`).

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `src/ui/basic/sidebar.test.ts` (seguir el patrón existente del archivo: construir `ShellSidebar` con un `getSnapshot` fijo y `render(width)`):

```ts
test("sidebar lists running and finished background activity with elapsed time", () => {
  const now = Date.now();
  const sidebar = new ShellSidebar(() => ({
    account: "connected", provider: "Claude",
    backgroundActivitySupported: true,
    backgroundActivity: [
      { id: "t1", kind: "agent", label: "Investigar X", state: "running", startedAt: now - 12_000 },
      { id: "t2", kind: "process", label: "build.sh", state: "failed", startedAt: now - 90_000, endedAt: now - 30_000, detail: "exit 1" },
    ],
  }));
  const lines = sidebar.render(60).join("\n");
  expect(lines).toContain("Investigar X");
  expect(lines).toContain("build.sh");
});

test("sidebar tells the person plainly when the engine doesn't report background activity", () => {
  const sidebar = new ShellSidebar(() => ({ account: "connected", provider: "Codex", backgroundActivitySupported: false }));
  const lines = sidebar.render(60).join("\n");
  expect(lines).toContain("Este motor no informa actividad en segundo plano.");
});

test("clicking a background activity row expands it to show the engine's own result", () => {
  const now = Date.now();
  const sidebar = new ShellSidebar(() => ({
    account: "connected", provider: "Claude",
    backgroundActivitySupported: true,
    backgroundActivity: [{ id: "t1", kind: "agent", label: "Investigar X", state: "done", startedAt: now - 5000, endedAt: now, detail: "Encontré 3 archivos" }],
  }));
  sidebar.render(60);
  const rowIndex = sidebar.render(60).findIndex(line => line.includes("Investigar X"));
  sidebar.handleMouse({ type: "click", button: "left", x: 0, y: rowIndex, width: 60, height: 1 } as any);
  const expanded = sidebar.render(60).join("\n");
  expect(expanded).toContain("Encontré 3 archivos");
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `bun test src/ui/basic/sidebar.test.ts`
Expected: FAIL — la sección no existe todavía en `render()`.

- [ ] **Step 3: Implementación mínima**

En `src/ui/basic/sidebar.ts`, importar lo necesario junto a los imports existentes:

```ts
import { ActivityCard } from "./transcript.ts";
```

Añadir estado y helpers a la clase `ShellSidebar` (junto a `refreshRow`/`expandedActivityIds`):

```ts
  private expandedActivityIds = new Set<string>();
  private activityRows = new Map<number, string>();
```

Ampliar `handleMouse` (antes del `if (this.refreshRow < 0 ...)` existente, como una comprobación adicional que no reemplaza la del refresco):

```ts
  handleMouse(event: TuiMouseEvent) {
    const activityId = this.activityRows.get(event.y);
    if (activityId !== undefined && event.type === "click" && event.button === "left" && event.x >= 0) {
      if (this.expandedActivityIds.has(activityId)) this.expandedActivityIds.delete(activityId);
      else this.expandedActivityIds.add(activityId);
      this.repaint();
      return { handled: true, render: true };
    }
    if (this.refreshRow < 0 || event.y !== this.refreshRow || event.x < 0 || event.type !== "click" || event.button !== "left") return undefined;
    void this.refreshUsage(); return { handled: true, render: true };
  }
```

Añadir el helper de formato de tiempo transcurrido y el bloque de render, dentro de `render(width)` justo antes del `return lines;` final:

```ts
    this.activityRows = new Map();
    if (snapshot.backgroundActivitySupported !== undefined) {
      lines.push("", ...heading(t.headingBackgroundActivity ?? getCatalog(this.locale).backgroundActivity.heading));
      if (!snapshot.backgroundActivitySupported) {
        lines.push(line(muted(getCatalog(this.locale).backgroundActivity.notReportedByEngine)));
      } else if (!snapshot.backgroundActivity?.length) {
        lines.push(line(muted(getCatalog(this.locale).backgroundActivity.idle)));
      } else {
        const ba = getCatalog(this.locale).backgroundActivity;
        for (const activity of snapshot.backgroundActivity) {
          const elapsedMs = (activity.endedAt ?? Date.now()) - activity.startedAt;
          const elapsed = elapsedMs < 60_000 ? ba.elapsedSeconds({ seconds: Math.max(0, Math.floor(elapsedMs / 1000)) }) : ba.elapsedMinutes({ minutes: Math.floor(elapsedMs / 60_000) });
          const stateLabel = activity.state === "running" ? ba.running : activity.state === "done" ? ba.done : ba.failed;
          const card = new ActivityCard(activity.label, `${stateLabel} · ${elapsed}`, activity.detail ?? "", this.expandedActivityIds.has(activity.id));
          const cardLines = card.render(width);
          this.activityRows.set(lines.length + 1, activity.id);
          lines.push(...cardLines);
        }
      }
    }
```

Nota: usar directamente `getCatalog(this.locale).backgroundActivity` en vez de desestructurar `t` (que sigue apuntando a `getCatalog(this.locale).sidebar`), para no tocar el resto del método.

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `bun test src/ui/basic/sidebar.test.ts`
Expected: PASS

- [ ] **Step 5: Listo para revisión**

No hacer `git add`/`git commit` — Git es de solo lectura para agentes en este repo (ver `AGENTS.md`). Dejar los archivos modificados en el árbol de trabajo; la persona revisa y comitea.

---

### Task 7: Contador animado en `ShellStatusBar`

**Files:**
- Modify: `src/ui/basic/status-bar.ts`
- Test: `src/ui/basic/workspace-chrome.test.ts` (ya cubre `ShellStatusBar`, seguir su patrón)

**Interfaces:**
- Consumes: `ShellSnapshot.backgroundActivity` (Task 1), `spinnerFrame` (Task 4), `Catalog.backgroundActivity.statusBarCount` (Task 5).

- [ ] **Step 1: Escribir el test que falla**

Añadir a `src/ui/basic/workspace-chrome.test.ts`, junto a los tests existentes de `ShellStatusBar`:

```ts
test("status bar shows a running-count segment with the animated dot only while something is running", () => {
  const running = [{ id: "t1", kind: "agent" as const, label: "x", state: "running" as const, startedAt: Date.now() }];
  const bar = new ShellStatusBar(() => ({ account: "connected", provider: "Claude", backgroundActivity: running }), "/proj");
  expect(bar.render(80).join("\n")).toContain("1 en segundo plano");

  const idle = new ShellStatusBar(() => ({ account: "connected", provider: "Claude", backgroundActivity: [] }), "/proj");
  expect(idle.render(80).join("\n")).not.toContain("en segundo plano");
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `bun test src/ui/basic/workspace-chrome.test.ts`
Expected: FAIL — el segmento no existe todavía.

- [ ] **Step 3: Implementación mínima**

En `src/ui/basic/status-bar.ts`, importar `spinnerFrame` junto a los demás imports:

```ts
import { spinnerFrame } from "./composer.ts";
```

Añadir un helper junto a `contextPercent`:

```ts
function backgroundActivityLabel(snapshot: ShellSnapshot, locale: Locale): string | undefined {
  const running = snapshot.backgroundActivity?.filter(activity => activity.state === "running").length ?? 0;
  if (!running) return undefined;
  return `${spinnerFrame(true)} ${getCatalog(locale).backgroundActivity.statusBarCount({ count: running })}`;
}
```

Y su import de `getCatalog`/`Locale` ya existe en el archivo; añadirlo a la lista `details` dentro de `render()`:

```ts
    const details = snapshot.account === "connected"
      ? [snapshot.provider, snapshot.model, snapshot.reasoning, contextPercent(snapshot), backgroundActivityLabel(snapshot, this.locale)].filter((part): part is string => Boolean(part))
      : snapshot.account === "checking" ? [t.checkingAccount] : [snapshot.account === "unknown" ? t.accountUnverified : t.disconnected, "/login"];
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `bun test src/ui/basic/workspace-chrome.test.ts`
Expected: PASS

- [ ] **Step 5: Listo para revisión**

No hacer `git add`/`git commit` — Git es de solo lectura para agentes en este repo (ver `AGENTS.md`). Dejar los archivos modificados en el árbol de trabajo; la persona revisa y comitea.

---

### Task 8: Conectar `ClaudeSession`/`CodexSession` a `ShellState` en cada motor

**Files:**
- Modify: `src/ui/basic/claude.ts`
- Modify: `src/ui/basic/native.ts`
- Test: ampliar los tests de integración ya existentes en `src/ui/basic/claude.test.ts` y `src/ui/basic/native.test.ts`

**Interfaces:**
- Consumes: `ClaudeSession.backgroundActivity` (Task 2, campo público), `NativeSession.backgroundActivity?()` (Task 1, método opcional).
- Produces: `shellState.connect({ ...backgroundActivity, backgroundActivitySupported })` en cada `refresh()`.

- [ ] **Step 1: Escribir los tests que fallan**

En `src/engines/claude/session.test.ts` ya se probó el modelo; aquí el test de integración vive donde ya se prueba `refresh()`/`shellState` en `claude.test.ts` y `native.test.ts`. Añadir, siguiendo el patrón de sesión falsa que ya usan esos archivos:

`src/ui/basic/claude.test.ts`:
```ts
test("Claude UI forwards background activity into the shared snapshot as supported", async () => {
  // usar la sesión falsa ya presente en el archivo, añadiendo backgroundActivity: [...] tras un send()
  // y comprobar que shellState.snapshot().backgroundActivitySupported === true
});
```

`src/ui/basic/native.test.ts`:
```ts
test("native (Codex) UI reports backgroundActivitySupported as false when the session has no such method", async () => {
  // sesión falsa sin backgroundActivity(); comprobar shellState.snapshot().backgroundActivitySupported === false
});
```

(Adaptar exactamente a las factories de sesión falsa que ya existen en cada archivo — ambos ya construyen una sesión mínima para probar `refresh()`; seguir esa forma en vez de una nueva.)

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `bun test src/ui/basic/claude.test.ts src/ui/basic/native.test.ts`
Expected: FAIL — `shellState.connect()` no recibe todavía estos campos.

- [ ] **Step 3: Implementación mínima**

En `src/ui/basic/claude.ts`, dentro de `refresh()` (~línea 172), añadir al objeto pasado a `shellState.connect({...})`:

```ts
        backgroundActivity: session.backgroundActivity,
        backgroundActivitySupported: true,
```

En `src/ui/basic/native.ts`, dentro de `refresh()` (~línea 81, en la rama `shellState.connect({...})`):

```ts
        backgroundActivity: session.backgroundActivity?.() ?? [],
        backgroundActivitySupported: typeof session.backgroundActivity === "function",
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `bun test src/ui/basic/claude.test.ts src/ui/basic/native.test.ts`
Expected: PASS

- [ ] **Step 5: Listo para revisión**

No hacer `git add`/`git commit` — Git es de solo lectura para agentes en este repo (ver `AGENTS.md`). Dejar los archivos modificados en el árbol de trabajo; la persona revisa y comitea.

---

### Task 9: Documentación (docs 05 es/en) y `AGENTS.md`

**Files:**
- Modify: `docs/es/05-interfaz-basic-panel-cuotas.md`
- Modify: `docs/en/05-basic-ui-sidebar-quotas.md`
- Modify: `AGENTS.md`
- Modify: `docs/notion-map.json`

**Interfaces:** Ninguna — solo documentación.

- [ ] **Step 1: Leer ambos documentos completos primero**

Leer `docs/es/05-interfaz-basic-panel-cuotas.md` y `docs/en/05-basic-ui-sidebar-quotas.md` enteros para igualar el tono y la estructura de encabezados (`## Métricas del sidebar` / `## Sidebar metrics` es la sección hermana más cercana).

- [ ] **Step 2: Añadir una sección nueva a cada documento**

En `docs/es/05-interfaz-basic-panel-cuotas.md`, después de `## Métricas del sidebar`, añadir:

```markdown
## Actividad en segundo plano

Cuando el motor activo reporta trabajo en segundo plano (subagentes de Claude Code, procesos backgroundeados), el panel lateral muestra una fila por actividad con su estado (corriendo, hecho, fallido) y el tiempo transcurrido; un clic la expande para ver el resultado si el motor lo entregó. La barra de estado añade un contador con el punto animado mientras haya actividad corriendo. Si el motor no reporta esto de forma distinguible, el panel lo dice explícitamente en vez de mostrar una lista vacía silenciosa — ver `docs/superpowers/specs/2026-09-22-background-activity-indicator-design.md`.
```

En `docs/en/05-basic-ui-sidebar-quotas.md`, después de `## Sidebar metrics`, añadir el equivalente en inglés con la misma referencia al spec.

- [ ] **Step 3: Recalcular el fingerprint en `docs/notion-map.json`**

Run: `shasum -a 256 docs/es/05-interfaz-basic-panel-cuotas.md docs/en/05-basic-ui-sidebar-quotas.md`

Actualizar el campo `fingerprint` de ambas entradas en `docs/notion-map.json` con el hash resultante (SHA-256 en hex, sin prefijo). No tocar `notionUrl` ni `reviewedVersion`.

- [ ] **Step 4: Añadir la regla al `AGENTS.md`**

En la sección 3 de `AGENTS.md`, añadir un párrafo final (después del bullet de Codex, antes de "### Rule of thumb"):

```markdown
- **Actividad en segundo plano** (agentes/procesos corriendo sin bloquear el turno): la misma regla aplica — un asistente nuevo debe declarar, con evidencia real citada, si su protocolo la reporta de forma distinguible. Ver `docs/superpowers/specs/2026-09-22-background-activity-indicator-design.md` para el precedente en Claude Code (sí, vía `task_started`/`task_updated`/`task_notification`/`background_tasks_changed`) y Codex (no, sin evidencia local — requiere probar `app-server` en vivo antes de asumir lo contrario).
```

- [ ] **Step 5: No sincronizar Notion desde esta sesión**

La sincronización de estos dos documentos a Notion la ejecuta el agente dedicado a esa tarea, no esta sesión — dejar los `.md` y el `fingerprint` listos y entregar, al terminar el plan, el prompt de sincronización para ese agente (mismo patrón ya usado en sesiones anteriores de este repo).

- [ ] **Step 6: Listo para revisión**

No hacer `git add`/`git commit` — Git es de solo lectura para agentes en este repo (ver `AGENTS.md`). Dejar los archivos modificados en el árbol de trabajo; la persona revisa y comitea.

---

### Task 10: Verificación final

**Files:** Ninguno (solo comandos).

- [ ] **Step 1: Suite completa, typecheck y build**

Run: `bun run check`
Expected: PASS sin errores — si `check` no existe como script único, ejecutar por separado `bun run typecheck`, `bun test`, `bun run build`.

- [ ] **Step 2: No hacer commit ni push de nada**

Todos los archivos de las tareas 1-9 quedan modificados sin comitear en el árbol de trabajo (`git status` los debe mostrar como cambios pendientes). No ejecutar `git add`, `git commit` ni `git push` bajo ninguna circunstancia — Git es de solo lectura para agentes en este flujo (ver `AGENTS.md`); la persona revisa el diff completo y decide cómo comitear.

---

## Reporte para revisión (a entregar al terminar la ejecución)

- Eventos reales encontrados por motor, con su forma exacta — ya documentados en la sección 3 del spec; el reporte final debe citarlos de nuevo junto al archivo:línea donde quedaron implementados.
- Archivos tocados y tests añadidos (lista de `git status`/`git diff --stat` antes del primer commit).
- Render de texto del panel lateral y la barra de estado con ≥2 actividades simultáneas (capturado desde un test, no inventado).
- Sección "Impacto en el procedimiento de agentes": Sí, ya redactada en la sección 7 del spec y aplicada en `AGENTS.md` (Task 9, Step 4).
