import { expect, spyOn, test } from "bun:test";
import { runUpdateCommand, type ShellSpawn } from "./update-command.ts";

function captureLogs(): { logs: string[]; errors: string[]; restore: () => void } {
  const logs: string[] = [];
  const errors: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
  const errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
  return { logs, errors, restore: () => { logSpy.mockRestore(); errorSpy.mockRestore(); } };
}

function okShellSpawn(): ShellSpawn {
  return (_command, _args) => ({ status: 0, stderr: "" });
}

test("Engines is installed and gets updated: all three components report independently", async () => {
  const { logs, restore } = captureLogs();
  process.exitCode = 0;
  try {
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
  try {
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
    expect(logs).toContain("Forge614 Engines: already up to date (1.4.0)");
    expect(logs).toContain("Forge614 Engram: already up to date (1.4.0)");
  } finally { restore(); process.exitCode = 0; }
});

test("Engram is not installed: it is skipped without an error, and no Engram command is ever sent", async () => {
  const { logs, restore } = captureLogs();
  process.exitCode = 0;
  const engramCalls: string[][] = [];
  try {
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
    expect(logs).toContain("Forge614 Engram: not installed, skipped");
    expect(engramCalls).toEqual([]);
    expect(process.exitCode as number | undefined).not.toBe(1);
  } finally { restore(); process.exitCode = 0; }
});

test("an Engines failure is reported to stderr and does not prevent Engram's own result from being shown", async () => {
  const { logs, errors, restore } = captureLogs();
  process.exitCode = 0;
  try {
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
    expect(errors).toContain("Forge614 Engines: update failed — The latest release has no Forge614 Engines asset for darwin-arm64");
    expect(logs).toContain("Forge614 Engram: updated (1.3.0 → 1.4.0)");
    expect(process.exitCode).toBe(1);
  } finally { restore(); process.exitCode = 0; }
});

test("an Engram failure is reported to stderr and does not prevent Engines' own result from being shown, or hide as success", async () => {
  const { logs, errors, restore } = captureLogs();
  process.exitCode = 0;
  try {
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
    expect(logs).toContain("Forge614 Engines: updated (1.3.0 → 1.4.0)");
    expect(errors).toContain("Forge614 Engram: update failed — forge614-engram update failed: No se pudo actualizar Forge614 Engram.");
    expect(logs.some(line => line.startsWith("Forge614 Engram: updated"))).toBe(false);
    expect(process.exitCode).toBe(1);
  } finally { restore(); process.exitCode = 0; }
});

test("a Shell self-update failure is reported to stderr and Engines/Engram are still attempted and shown", async () => {
  const { logs, errors, restore } = captureLogs();
  process.exitCode = 0;
  const failingSpawn: ShellSpawn = () => ({ status: 69, stderr: "Node.js is required" });
  try {
    await runUpdateCommand({
      home: "/Users/tester",
      installer: "/tmp/release/install.sh",
      spawn: failingSpawn,
      engramBinaryExists: () => true,
      enginesRun: async () => ({
        status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: true, currentVersion: "1.3.0", latestVersion: "1.4.0" } }), stderr: "",
      }),
      engramRun: async () => ({ status: 0, stdout: JSON.stringify({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" }), stderr: "" }),
    });
    expect(errors).toContain("Forge614 Shell: update failed — Node.js is required");
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
  try {
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
    expect(enginesCalls).toEqual([["/Users/tester/.forge614/engines/bin/forge614-engines", "update"]]);
    expect(engramCalls).toEqual([["/Users/tester/.forge614/engram/bin/forge614-engram", "update", "--json"]]);
  } finally { restore(); process.exitCode = 0; }
});

test("checks Engram's binary at its canonical path, never assuming PATH", async () => {
  const { restore } = captureLogs();
  process.exitCode = 0;
  const checkedPaths: string[] = [];
  try {
    await runUpdateCommand({
      home: "/Users/tester",
      installer: "/tmp/release/install.sh",
      spawn: okShellSpawn(),
      engramBinaryExists: (path: string) => { checkedPaths.push(path); return false; },
      enginesRun: async () => ({ status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: false, currentVersion: "1.4.0", latestVersion: "1.4.0" } }), stderr: "" }),
    });
    expect(checkedPaths).toEqual(["/Users/tester/.forge614/engram/bin/forge614-engram"]);
  } finally { restore(); process.exitCode = 0; }
});

test("passes FORGE614_HOME through to both dependency lookups when given", async () => {
  const { restore } = captureLogs();
  process.exitCode = 0;
  const checkedPaths: string[] = [];
  const enginesCalls: string[][] = [];
  try {
    await runUpdateCommand({
      home: "/Users/tester",
      env: { FORGE614_HOME: "/custom/forge" } as NodeJS.ProcessEnv,
      installer: "/tmp/release/install.sh",
      spawn: okShellSpawn(),
      engramBinaryExists: (path: string) => { checkedPaths.push(path); return false; },
      enginesRun: async (command, args) => {
        enginesCalls.push([command, ...args]);
        return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, result: { updated: false, currentVersion: "1.4.0", latestVersion: "1.4.0" } }), stderr: "" };
      },
    });
    expect(enginesCalls[0]![0]).toBe("/custom/forge/engines/bin/forge614-engines");
    expect(checkedPaths).toEqual(["/custom/forge/engram/bin/forge614-engram"]);
  } finally { restore(); process.exitCode = 0; }
});

test("with locale: \"es\", every outcome (success and failure) reports in Spanish, product names and versions kept literal", async () => {
  const { logs, errors, restore } = captureLogs();
  process.exitCode = 0;
  try {
    await runUpdateCommand({
      home: "/Users/tester",
      locale: "es",
      installer: "/tmp/release/install.sh",
      spawn: okShellSpawn(),
      engramBinaryExists: () => true,
      enginesRun: async () => ({
        status: 1, stdout: JSON.stringify({ schemaVersion: 1, error: { code: "UPDATE_ASSET_MISSING", message: "no asset for darwin-arm64" } }), stderr: "",
      }),
      engramRun: async () => ({ status: 0, stdout: JSON.stringify({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" }), stderr: "" }),
    });
    expect(logs).toContain("Forge614 Shell: actualizado");
    expect(logs).toContain("Forge614 Engram: actualizado (1.3.0 → 1.4.0)");
    expect(errors).toContain("Forge614 Engines: falló la actualización — no asset for darwin-arm64");
    expect(process.exitCode).toBe(1);
  } finally { restore(); process.exitCode = 0; }
});
