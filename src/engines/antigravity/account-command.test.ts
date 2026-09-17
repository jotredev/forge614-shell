import { expect, test } from "bun:test";
import { runAccountCommand } from "./account-command.ts";

test("account commands capture output without owning a terminal", async () => {
  const result = await runAccountCommand(process.execPath, ["-e", "console.log('account status')"], { cwd: process.cwd(), env: {} });
  expect(result.stdout.trim()).toBe("account status");
  if (process.platform !== "win32") {
    const result = await runAccountCommand(process.execPath, ["-e", "try { require('fs').openSync('/dev/tty','r'); process.exit(1) } catch { console.log('no controlling terminal') }"], { cwd: process.cwd(), env: {} });
    expect(result.stdout.trim()).toBe("no controlling terminal");
  }
});

test("account commands bound execution and return private stderr only to the account checker", async () => {
  await expect(runAccountCommand(process.execPath, ["-e", "console.error('authentication required');process.exit(1)"], { cwd: process.cwd(), env: {} })).rejects.toMatchObject({ stderr: "authentication required\n" });
  await expect(runAccountCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], { cwd: process.cwd(), env: {}, timeout: 20 })).rejects.toThrow("stopped");
  const control = new AbortController(); control.abort();
  await expect(runAccountCommand(process.execPath, [], { cwd: process.cwd(), env: {}, signal: control.signal })).rejects.toThrow();
});
