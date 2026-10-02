import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeSession } from "./session.ts";
import { fakeAssistant, fakeInit, fakeResult, fakeSdk, settle, taskNotification, taskStarted } from "./fake-query.ts";
import type { FakeQuery, FakeQueryConfig } from "./fake-query.ts";

/**
 * Background tasks (subagents, long processes) live INSIDE the Claude Code process. With the one open query they go on between messages: they stay in the list and the count after a turn's `result`,
 * their notifications and the automatic turn Claude Code starts by itself arrive with no message of the person, and only a closed or dead process ends them — as «interrupted». These tests drive a
 * session over `fakeSdk`, a stand-in with the behavior measured with SDK 0.3.274 on 2026-10-02.
 */

type Dependencies = ConstructorParameters<typeof ClaudeSession>[0];

/** The SDK's `background_tasks_changed`: the whole set of tasks alive (a level, replaced each time). */
const tasksChanged = (ids: string[]) => ({ type: "system", subtype: "background_tasks_changed", tasks: ids.map(id => ({ task_id: id, description: id, task_type: "local_agent", is_backgrounded: true })), uuid: randomUUID(), session_id: "fake-session" }) as unknown as SDKMessage;
const taskUpdated = (id: string, status: string) => ({ type: "system", subtype: "task_updated", task_id: id, patch: { status }, uuid: randomUUID(), session_id: "fake-session" }) as unknown as SDKMessage;

/** A turn that launches one background task (and says so) and ends: the shape of a message that starts a subagent. */
const launchesTask = (id = "t1", description = "Investigar X", extra: object = {}): FakeQueryConfig["turn"] => (message, fake) => {
  fake.emit(fakeInit(), taskStarted(id, description, extra), tasksChanged([id]), fakeAssistant("Lo lancé en segundo plano"), fakeResult([message.uuid!]));
};

function liveSession(config: FakeQueryConfig = {}, extra: Partial<Dependencies> = {}) {
  const sdk = fakeSdk(config);
  const events: SDKMessage[] = [];
  const session = new ClaudeSession({ cwd: "/tmp/project", executable: "/bin/claude", env: {}, connect: sdk.connect, authenticate: async () => {}, ...extra });
  session.attach({ onEvent: event => { events.push(event); }, approve: async () => true });
  return { sdk, session, events };
}
const fieldsOf = (session: ClaudeSession) => session.backgroundActivity.map(activity => [activity.id, activity.kind, activity.label, activity.state]);

test("a background task is still running, in the list and in the count, after the result of the turn that launched it", async () => {
  const h = liveSession({ turn: launchesTask() });
  await h.session.send("hazlo en segundo plano");
  expect(h.session.busy).toBe(false);
  expect(fieldsOf(h.session)).toEqual([["t1", "agent", "Investigar X", "running"]]);
  expect(h.session.runningTasks()).toBe(1);
});

test("its notification arrives with no message of the person, closes it with its summary, and the automatic turn that follows is Working until its own result", async () => {
  const h = liveSession({ turn: launchesTask() });
  await h.session.send("hazlo en segundo plano");
  const fake = h.sdk.opened[0]!;
  const before = h.events.length;
  fake.emit(taskUpdated("t1", "completed"), taskNotification("t1", "completed", "Resultado de X"));
  await settle();
  expect(h.session.backgroundActivity[0]).toMatchObject({ id: "t1", state: "done", detail: "Resultado de X" });
  expect(h.session.runningTasks()).toBe(0);
  // The notification alone is not a turn.
  expect(h.session.busy).toBe(false);
  // Then Claude Code wakes itself up: init, the assistant speaks, and a result with no uuid of the person's.
  fake.emit(fakeInit(), fakeAssistant("Terminé lo de X"));
  await settle();
  expect(h.session.busy).toBe(true);
  fake.emit(fakeResult([]));
  await settle();
  expect(h.session.busy).toBe(false);
  // All of it reached the screen's handler, in order, with nobody having sent anything.
  expect(h.events.slice(before).map(event => event.type === "system" ? `system:${(event as { subtype: string }).subtype}` : event.type)).toEqual(["system:task_updated", "system:task_notification", "system:init", "assistant", "result"]);
  expect(fake.sent).toHaveLength(1);
});

test("a message sent during an automatic turn waits for its own result: the automatic result does not end it", async () => {
  let messages = 0;
  const first = launchesTask()!;
  // Only the first message is answered at once; the second one is left for the test to answer.
  const h = liveSession({ turn: (message, fake: FakeQuery) => { if (++messages === 1) first(message, fake); else fake.lifecycle(message.uuid!, "queued"); } });
  await h.session.send("hazlo en segundo plano");
  const fake = h.sdk.opened[0]!;
  fake.emit(taskNotification("t1", "completed", "ok"), fakeInit(), fakeAssistant("Terminé"));
  await settle();
  expect(h.session.busy).toBe(true);
  let done = false;
  const second = h.session.send("y ahora esto").then(() => { done = true; });
  await settle();
  fake.emit(fakeResult([]));
  await settle();
  expect(done).toBe(false);
  expect(h.session.busy).toBe(true);
  fake.answer([fake.sent[1]!.uuid!]);
  await second;
  expect(done).toBe(true);
  expect(h.session.busy).toBe(false);
});

test("a task started by a subagent is told apart from the ones of the top level", async () => {
  const h = liveSession({ turn: (message, fake: FakeQuery) => {
    fake.emit(fakeInit(), taskStarted("top", "Agente principal"), taskStarted("inner", "Tarea del subagente", { owned_by_subagent: true }), fakeResult([message.uuid!]));
  } });
  await h.session.send("go");
  expect(h.session.ownedBySubagent("inner")).toBe(true);
  expect(h.session.ownedBySubagent("top")).toBe(false);
  // A task the session never saw start (the notification of one that was cut before) is a top-level one.
  expect(h.session.ownedBySubagent("never-seen")).toBe(false);
  expect(h.session.runningTasks()).toBe(2);
});

test("the owned-by-subagent mark is read from any task event: a notification or an update that carries it marks the task, and a notice of one never seen is judged by its own mark", async () => {
  const h = liveSession({ turn: (message, fake: FakeQuery) => {
    fake.emit(fakeInit(), taskStarted("late-update", "Marcada después"), taskStarted("late-notice", "Marcada en el aviso"), fakeResult([message.uuid!]));
  } });
  await h.session.send("go");
  expect(h.session.ownedBySubagent("late-update")).toBe(false);
  h.sdk.opened[0]!.emit({ ...taskUpdated("late-update", "running"), owned_by_subagent: true } as unknown as SDKMessage, taskNotification("late-notice", "completed", "ok", { owned_by_subagent: true }));
  await settle();
  expect(h.session.ownedBySubagent("late-update")).toBe(true);
  expect(h.session.ownedBySubagent("late-notice")).toBe(true);
});

test("when the process dies the running tasks are marked interrupted — not done, not deleted — and the finished ones stay as they were", async () => {
  const h = liveSession({ turn: (message, fake: FakeQuery) => {
    fake.emit(fakeInit(), taskStarted("a", "Sigue corriendo"), taskStarted("b", "Ya terminó"), taskUpdated("b", "completed"), tasksChanged(["a"]), fakeResult([message.uuid!]));
  } });
  await h.session.send("go");
  expect(fieldsOf(h.session)).toEqual([["a", "agent", "Sigue corriendo", "running"], ["b", "agent", "Ya terminó", "done"]]);
  h.sdk.opened[0]!.die(new Error("Claude Code process exited with code 1"));
  await settle();
  expect(fieldsOf(h.session)).toEqual([["a", "agent", "Sigue corriendo", "interrupted"], ["b", "agent", "Ya terminó", "done"]]);
  expect(typeof h.session.backgroundActivity[0]!.endedAt).toBe("number");
  expect(h.session.runningTasks()).toBe(0);
});

test("closing the query marks the running tasks interrupted too", async () => {
  const h = liveSession({ turn: launchesTask() });
  await h.session.send("go");
  h.session.close();
  expect(fieldsOf(h.session)).toEqual([["t1", "agent", "Investigar X", "interrupted"]]);
  expect(h.session.runningTasks()).toBe(0);
});

test("the tasks that ended before the next message starts a turn are forgotten; the ones still running stay", async () => {
  let turn = 0;
  const h = liveSession({ turn: (message, fake: FakeQuery) => {
    turn++;
    if (turn === 1) fake.emit(fakeInit(), taskStarted("a", "Termina"), taskStarted("b", "Sigue"), taskUpdated("a", "completed"), fakeResult([message.uuid!]));
    else fake.emit(fakeInit(), fakeResult([message.uuid!]));
  } });
  await h.session.send("one");
  expect(fieldsOf(h.session)).toEqual([["a", "agent", "Termina", "done"], ["b", "agent", "Sigue", "running"]]);
  await h.session.send("two");
  expect(fieldsOf(h.session)).toEqual([["b", "agent", "Sigue", "running"]]);
});

test("a stop kills the tasks together with the turn (Claude Code does it) and each ends as the SDK reports it", async () => {
  const h = liveSession({ hold: true });
  const turn = h.session.send("go").catch(() => {});
  await settle();
  const fake = h.sdk.opened[0]!;
  fake.emit(taskStarted("t1", "Investigar X"), tasksChanged(["t1"]));
  await settle();
  expect(h.session.runningTasks()).toBe(1);
  h.session.stop();
  await turn;
  await settle();
  expect(h.session.runningTasks()).toBe(0);
  expect(h.session.backgroundActivity[0]).toMatchObject({ id: "t1", state: "failed", detail: "Stopped" });
});

test("a task that Claude Code reports as ambient (housekeeping) is never listed", async () => {
  const h = liveSession({ turn: launchesTask("amb", "limpieza", { ambient: true }) });
  await h.session.send("go");
  expect(h.session.backgroundActivity).toEqual([]);
  expect(h.session.runningTasks()).toBe(0);
});
