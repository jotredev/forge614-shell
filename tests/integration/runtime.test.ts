import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = process.env.FORGE614_TEST_CLI ?? fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

// This exercises the installed Pi and real extension loader without a model request.
// Dropping our extension or leaking the ambient Pi profile must fail this test.
test("real Pi loads Shell branding and keeps sessions outside the user's Pi profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-runtime-"));
  const project = join(root, "project with spaces");
  const ambient = join(root, "unrelated-pi");
  const profile = join(root, "shell-profile");
  await mkdir(project);
  await mkdir(ambient);
  const sentinel = '{"defaultProvider":"unrelated-provider"}\n';
  await writeFile(join(ambient, "settings.json"), sentinel);
  const skillDir = join(profile, "agent", "skills", "unrequested-skill");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), "---\nname: unrequested-skill\ndescription: Test fixture for resource isolation\n---\nDo not load automatically.\n");

  const child = spawn("node", [cli, "--engine", "pi", "--mode", "rpc"], {
    cwd: project,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMPDIR: process.env.TMPDIR,
      FORGE614_SHELL_HOME: profile,
      PI_CODING_AGENT_DIR: ambient,
      PI_CODING_AGENT_SESSION_DIR: join(ambient, "sessions"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  let buffer = "";
  const events: Record<string, any>[] = [];
  child.stderr.on("data", data => { stderr += String(data); });
  let nextId = 0;
  const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  child.stdout.on("data", data => {
    buffer += String(data);
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const event = JSON.parse(line);
        events.push(event);
        if (event.type === "response" && pending.has(event.id)) {
          pending.get(event.id)!.resolve(event);
          pending.delete(event.id);
        }
      } catch { /* Startup diagnostics are asserted through stderr/exit below. */ }
    }
  });
  const exited = new Promise<void>(resolve => {
    child.once("close", code => {
      for (const waiter of pending.values()) waiter.reject(new Error(`Pi exited ${code}: ${stderr}`));
      pending.clear();
      resolve();
    });
  });
  child.on("error", error => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  const request = (type: string, extra: Record<string, unknown> = {}): Promise<any> => {
    const id = String(++nextId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${type}: ${stderr}`));
      }, 15_000);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      child.stdin.write(JSON.stringify({ type, id, ...extra }) + "\n");
    });
  };

  try {
    const state = await request("get_state");
    expect(state.success).toBe(true);
    expect(state.data.sessionFile.startsWith(join(profile, "agent", "sessions"))).toBe(true);
    expect(dirname(state.data.sessionFile)).not.toBe(join(profile, "agent", "sessions"));
    const commands = await request("get_commands");
    expect(commands.success).toBe(true);
    expect(commands.data.commands.some((command: any) => command.name === "forge614-status")).toBe(true);
    expect(commands.data.commands.some((command: any) => command.source === "skill")).toBe(false);
    expect(events.some(event => event.type === "extension_ui_request" && event.method === "setTitle" && event.title === "Forge614-Shell")).toBe(true);
    expect(await readFile(join(ambient, "settings.json"), "utf8")).toBe(sentinel);
    expect(stderr).not.toContain("Failed to load extension");
    expect(events.some(event => event.type === "agent_start")).toBe(false);
    const status = await request("prompt", { message: "/forge614-status" });
    expect(status.success).toBe(true);
    expect(events.some(event => event.method === "notify" && event.message.includes(project) && event.message.includes("/login"))).toBe(true);
  } finally {
    child.kill();
    await exited;
    await rm(root, { recursive: true, force: true });
  }
}, 25_000);
