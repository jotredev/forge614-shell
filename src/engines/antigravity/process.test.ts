import { expect, test } from "bun:test";
import { antigravityEnvironment, antigravityLogin, antigravityLoginState, checkAntigravityAccountMode, runAntigravity } from "./process.ts";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";


test("login check uses a CLI-local quota query and does not confuse outages with signed-out accounts", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-agy-check-"));
  try {
    const check = (run: Parameters<typeof antigravityLoginState>[4]) => antigravityLoginState("agy", root, { HOME: root }, undefined, run);
    expect(await check(async (_file, args) => {
      expect(args).toEqual(["-p", "/usage"]);
      return { stdout: "Gemini Models\tWeekly Limit Remaining\t0%\t2026-09-24T00:00:00Z\n" };
    })).toBe("connected");
    expect(await check(async () => { throw { stderr: "authentication required" }; })).toBe("required");
    expect(await check(async () => { throw { stderr: "network timeout" }; })).toBe("unknown");
    expect(await check(async () => ({ stdout: "some unrelated success" }))).toBe("unknown");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.skipIf(process.platform === "win32")("native login cancellation waits until a SIGTERM-resistant child is terminated", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-agy-login-"));
  const executable = join(root, "agy"); const marker = join(root, "pid");
  const control = new AbortController(); let pid: number | undefined;
  try {
    await writeFile(executable, `#!${process.execPath}\nconst fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`, { mode: 0o755 });
    const pending = antigravityLogin(executable, root, { HOME: root }, control.signal).catch(error => error);
    for (let i = 0; i < 100 && !pid; i++) {
      try { pid = Number(await readFile(marker, "utf8")); } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
    }
    expect(pid).toBeGreaterThan(0);
    control.abort();
    const result = await pending;
    expect(result).toBeInstanceOf(Error);
    expect(() => process.kill(pid!, 0)).toThrow();
  } finally {
    control.abort();
    if (pid) { try { process.kill(pid, "SIGKILL"); } catch {} }
    await rm(root, { recursive: true, force: true });
  }
});

test("Antigravity refuses API settings even when no API key is in the environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-agy-config-"));
  try {
    const folder = join(root, ".gemini", "antigravity-cli");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "settings.json"), JSON.stringify({ modelProvider: "gemini" }));
    await expect(checkAntigravityAccountMode({ HOME: root })).rejects.toThrow("API billing");
    await writeFile(join(folder, "settings.json"), "{}");
    await expect(checkAntigravityAccountMode({ HOME: root })).resolves.toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Antigravity rejects alternate billing routes without leaking secrets", () => {
  expect(() => antigravityEnvironment({ GEMINI_API_KEY: "secret-value" })).toThrow("GEMINI_API_KEY");
  expect(() => antigravityEnvironment({ GOOGLE_GEMINI_BASE_URL: "secret-value" })).toThrow("GOOGLE_GEMINI_BASE_URL");
  expect(antigravityEnvironment({ PATH: "/bin" })).toEqual({ PATH: "/bin" });
});

test("Antigravity transport sends one JSON prompt and drains the final result before exit", async () => {
  const events: any[] = [];
  const script = `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const p=JSON.parse(input);if(p.event!=='user'||p.message.content!=='hello')process.exit(2);process.stdout.write(JSON.stringify({event:'result',result:{status:'SUCCESS',response:'ok'}})+'\\n');});`;
  await runAntigravity(process.execPath, ["-e", script], "hello", process.cwd(), {}, event => events.push(event), new AbortController().signal);
  expect(events).toEqual([{ event: "result", result: { status: "SUCCESS", response: "ok" } }]);
});

test("Antigravity transport rejects malformed output and abort terminates a pending process", async () => {
  await expect(runAntigravity(process.execPath, ["-e", "console.log('invalid')"], "hi", process.cwd(), {}, () => {}, new AbortController().signal)).rejects.toThrow("protocol");
  const control = new AbortController();
  const pending = runAntigravity(process.execPath, ["-e", "setInterval(()=>{},1000)"], "hi", process.cwd(), {}, () => {}, control.signal);
  control.abort();
  await expect(pending).rejects.toThrow("cancelled");
});
