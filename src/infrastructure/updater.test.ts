import { expect, test } from "bun:test";
import { updateInstalledShell } from "./updater.ts";

test("runs the bundled installer with --latest", async () => {
  const calls: string[][] = [];
  await updateInstalledShell({ installer: "/tmp/release/install.sh", spawn: ((command: string, args: string[]) => {
    calls.push([command, ...args]);
    return { status: 0, stderr: "" } as never;
  }) as never });
  expect(calls).toEqual([["bash", "/tmp/release/install.sh", "--latest"]]);
});

test("reports installer diagnostics", async () => {
  await expect(updateInstalledShell({ installer: "/tmp/release/install.sh", spawn: (() => ({ status: 69, stderr: "Node.js is required" }) as never) as never })).rejects.toThrow("Node.js is required");
});
