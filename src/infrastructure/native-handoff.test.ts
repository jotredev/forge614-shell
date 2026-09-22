import { expect, test } from "bun:test";
import { runInteractiveHandoff } from "./native-handoff.ts";

test("resolves once the child process exits, whatever its exit code", async () => {
  await expect(runInteractiveHandoff("/usr/bin/true", process.cwd(), process.env)).resolves.toBeUndefined();
});

test("rejects with a clear message when the executable does not exist", async () => {
  await expect(runInteractiveHandoff("/definitely/not/a/real/native-client", process.cwd(), process.env))
    .rejects.toThrow("could not be started");
});
