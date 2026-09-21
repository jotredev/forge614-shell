import { expect, spyOn, test } from "bun:test";
import { runUpdateCommand } from "./update-command.ts";

function captureLogs(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
  return { logs, restore: () => spy.mockRestore() };
}

function okShellSpawn() {
  return (_command: string, _args: string[]) => ({ status: 0, stderr: "" }) as never;
}

test("Engines is installed and gets updated: all three components report independently", async () => {
  const { logs, restore } = captureLogs();
  process.exitCode = 0;
  await runUpdateCommand({
    home: "/Users/tester",
    installer: "/tmp/release/install.sh",
    spawn: okShellSpawn(),
    engramBinaryExists: () => true,
    enginesRun: async () => ({
      status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: true, currentVersion: "1.3.0", latestVersion: "1.4.0" } }), stderr: "",
    }),
    engramRun: async () => ({ status: 0, stdout: JSON.stringify({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" }), stderr: "" }),
  });
  try {
    expect(logs).toEqual([
      "Forge614 Shell: updated",
      "Forge614 Engines: updated (1.3.0 → 1.4.0)",
      "Forge614 Engram: updated (1.3.0 → 1.4.0)",
    ]);
    expect(process.exitCode as number | undefined).not.toBe(1);
  } finally { restore(); process.exitCode = 0; }
});

test("Engram is installed and already up to date using JSON", async () => {
  const { logs, restore } = captureLogs();
  process.exitCode = 0;
  await runUpdateCommand({
    home: "/Users/tester",
    installer: "/tmp/release/install.sh",
    spawn: okShellSpawn(),
    engramBinaryExists: () => true,
    enginesRun: async () => ({
      status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: false, currentVersion: "1.4.0", latestVersion: "1.4.0" } }), stderr: "",
    }),
    engramRun: async () => ({ status: 0, stdout: JSON.stringify({ updated: false, previousVersion: "1.4.0", installedVersion: "1.4.0" }), stderr: "" }),
  });
  try {
    expect(logs).toContain("Forge614 Engines: already up to date (1.4.0)");
    expect(logs).toContain("Forge614 Engram: already up to date (1.4.0)");
  } finally { restore(); process.exitCode = 0; }
});

test("Engram is not installed: it is skipped without an error, and no Engram command is ever sent", async () => {
  const { logs, restore } = captureLogs();
  process.exitCode = 0;
  const engramCalls: string[][] = [];
  await runUpdateCommand({
    home: "/Users/tester",
    installer: "/tmp/release/install.sh",
    spawn: okShellSpawn(),
    engramBinaryExists: () => false,
    enginesRun: async () => ({
      status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: true, currentVersion: "1.3.0", latestVersion: "1.4.0" } }), stderr: "",
    }),
    engramRun: async (command, args) => { engramCalls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; },
  });
  try {
    expect(logs).toContain("Forge614 Engram: not installed, skipped");
    expect(engramCalls).toEqual([]);
    expect(process.exitCode as number | undefined).not.toBe(1);
  } finally { restore(); process.exitCode = 0; }
});

test("an Engines failure is reported and does not prevent Engram's own result from being shown", async () => {
  const { logs, restore } = captureLogs();
  process.exitCode = 0;
  await runUpdateCommand({
    home: "/Users/tester",
    installer: "/tmp/release/install.sh",
    spawn: okShellSpawn(),
    engramBinaryExists: () => true,
    enginesRun: async () => ({
      status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "UPDATE_ASSET_MISSING", message: "The latest release has no Forge614 Engines asset for darwin-arm64" } }), stderr: "",
    }),
    engramRun: async () => ({ status: 0, stdout: JSON.stringify({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" }), stderr: "" }),
  });
  try {
    expect(logs).toContain("Forge614 Engines: update failed — The latest release has no Forge614 Engines asset for darwin-arm64");
    expect(logs).toContain("Forge614 Engram: updated (1.3.0 → 1.4.0)");
    expect(process.exitCode).toBe(1);
  } finally { restore(); process.exitCode = 0; }
});

test("an Engram failure is reported and does not prevent Engines' own result from being shown, or hide as success", async () => {
  const { logs, restore } = captureLogs();
  process.exitCode = 0;
  await runUpdateCommand({
    home: "/Users/tester",
    installer: "/tmp/release/install.sh",
    spawn: okShellSpawn(),
    engramBinaryExists: () => true,
    enginesRun: async () => ({
      status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: true, currentVersion: "1.3.0", latestVersion: "1.4.0" } }), stderr: "",
    }),
    engramRun: async () => ({ status: 1, stdout: "", stderr: JSON.stringify({ code: "UPDATE_FAILED", error: "No se pudo actualizar Forge614 Engram." }) }),
  });
  try {
    expect(logs).toContain("Forge614 Engines: updated (1.3.0 → 1.4.0)");
    expect(logs).toContain("Forge614 Engram: update failed — forge614-engram update failed: No se pudo actualizar Forge614 Engram.");
    expect(logs.some(line => line.startsWith("Forge614 Engram: updated"))).toBe(false);
    expect(process.exitCode).toBe(1);
  } finally { restore(); process.exitCode = 0; }
});

test("a Shell self-update failure is reported and Engines/Engram are still attempted and shown", async () => {
  const { logs, restore } = captureLogs();
  process.exitCode = 0;
  await runUpdateCommand({
    home: "/Users/tester",
    installer: "/tmp/release/install.sh",
    spawn: (() => ({ status: 69, stderr: "Node.js is required" }) as never) as never,
    engramBinaryExists: () => true,
    enginesRun: async () => ({
      status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: true, currentVersion: "1.3.0", latestVersion: "1.4.0" } }), stderr: "",
    }),
    engramRun: async () => ({ status: 0, stdout: JSON.stringify({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" }), stderr: "" }),
  });
  try {
    expect(logs).toContain("Forge614 Shell: update failed — Node.js is required");
    expect(logs).toContain("Forge614 Engines: updated (1.3.0 → 1.4.0)");
    expect(logs).toContain("Forge614 Engram: updated (1.3.0 → 1.4.0)");
    expect(process.exitCode).toBe(1);
  } finally { restore(); process.exitCode = 0; }
});

test("never sends any command to Engines or Engram other than update / update --json", async () => {
  const { restore } = captureLogs();
  process.exitCode = 0;
  const enginesCalls: string[][] = [];
  const engramCalls: string[][] = [];
  await runUpdateCommand({
    home: "/Users/tester",
    installer: "/tmp/release/install.sh",
    spawn: okShellSpawn(),
    engramBinaryExists: () => true,
    enginesRun: async (command, args) => {
      enginesCalls.push([command, ...args]);
      return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: false, currentVersion: "1.4.0", latestVersion: "1.4.0" } }), stderr: "" };
    },
    engramRun: async (command, args) => {
      engramCalls.push([command, ...args]);
      return { status: 0, stdout: JSON.stringify({ updated: false, previousVersion: "1.4.0", installedVersion: "1.4.0" }), stderr: "" };
    },
  });
  try {
    expect(enginesCalls).toEqual([["/Users/tester/.forge614/engines/bin/forge614-engines", "update"]]);
    expect(engramCalls).toEqual([["/Users/tester/.forge614/engram/bin/forge614-engram", "update", "--json"]]);
  } finally { restore(); process.exitCode = 0; }
});

test("checks Engram's binary at its canonical path, never assuming PATH", async () => {
  const { restore } = captureLogs();
  process.exitCode = 0;
  const checkedPaths: string[] = [];
  await runUpdateCommand({
    home: "/Users/tester",
    installer: "/tmp/release/install.sh",
    spawn: okShellSpawn(),
    engramBinaryExists: (path: string) => { checkedPaths.push(path); return false; },
    enginesRun: async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: false, currentVersion: "1.4.0", latestVersion: "1.4.0" } }), stderr: "" }),
  });
  try {
    expect(checkedPaths).toEqual(["/Users/tester/.forge614/engram/bin/forge614-engram"]);
  } finally { restore(); process.exitCode = 0; }
});
