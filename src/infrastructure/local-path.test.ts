import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLocalPath, resolveLocalPath } from "./local-path.ts";

let root = "";
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), "forge614-local-path-"))); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** What the opener was asked to run, as `[command, arguments]`, so the tests read exactly which program got which separate arguments. */
function recorder() {
  const calls: [string, string[]][] = [];
  return { calls, run: async (command: string, args: string[]) => { calls.push([command, args]); } };
}

/**
 * A path that exists is opened with the app the Mac has for it: `/usr/bin/open` with the path as its single, separate argument (never through a shell).
 * It exists because this is the plain case every other rule is a deviation from.
 */
test("an existing file or folder is opened with /usr/bin/open and the path as one argument", async () => {
  const file = join(root, "notes.txt"); writeFileSync(file, "x");
  const folder = join(root, "docs folder"); mkdirSync(folder);
  const { calls, run } = recorder();
  expect(await openLocalPath(file, { platform: "darwin", run })).toBe(true);
  expect(await openLocalPath(folder, { platform: "darwin", run })).toBe(true);
  expect(calls).toEqual([["/usr/bin/open", [file]], ["/usr/bin/open", [folder]]]);
});

/** A path that is not on disk (any more) is not opened and nothing is run: the caller shows the warning line. */
test("a path that does not exist is not opened and runs nothing", async () => {
  const { calls, run } = recorder();
  expect(await openLocalPath(join(root, "missing.txt"), { platform: "darwin", run })).toBe(false);
  expect(calls).toEqual([]);
});

/**
 * Shell never runs anything because of a click: an app, a package folder, a file with the execute permission or one with an extension that runs when opened is shown in Finder
 * (`open -R`) instead. Every extension the owner listed is checked, in lower and upper case, so none of them can slip through opening.
 */
test("apps, packages, executable files and the listed extensions are shown in Finder instead of opened", async () => {
  const { calls, run } = recorder();
  const expected: [string, string[]][] = [];
  const reveal = async (path: string) => { expect(await openLocalPath(path, { platform: "darwin", run })).toBe(true); expected.push(["/usr/bin/open", ["-R", path]]); };
  for (const extension of ["app", "bundle", "framework", "pkg", "mpkg", "workflow", "kext", "xpc", "prefPane", "saver"]) {
    const folder = join(root, `Thing.${extension}`); mkdirSync(folder); await reveal(folder);
  }
  mkdirSync(join(root, "files"));
  for (const extension of ["command", "tool", "terminal", "sh", "zsh", "bash", "pkg", "mpkg", "dmg", "workflow", "scpt", "applescript", "COMMAND", "Sh"]) {
    const file = join(root, "files", `thing.${extension}`); writeFileSync(file, "x"); await reveal(file);
  }
  const executable = join(root, "program"); writeFileSync(executable, "x"); chmodSync(executable, 0o755); await reveal(executable);
  const plainText = join(root, "executable-notes.txt"); writeFileSync(plainText, "x"); chmodSync(plainText, 0o700); await reveal(plainText);
  expect(calls).toEqual(expected);
});

/** A link in disguise does not help: a file named `notes.txt` that is really an app (a symbolic link) is judged by where it leads, not by its name. */
test("a symbolic link is judged by what it points to", async () => {
  const app = join(root, "Tool.app"); mkdirSync(app);
  const disguised = join(root, "notes.txt"); symlinkSync(app, disguised);
  const script = join(root, "run.sh"); writeFileSync(script, "x");
  const alias = join(root, "readme.md"); symlinkSync(script, alias);
  const { calls, run } = recorder();
  await openLocalPath(disguised, { platform: "darwin", run });
  await openLocalPath(alias, { platform: "darwin", run });
  expect(calls).toEqual([["/usr/bin/open", ["-R", disguised]], ["/usr/bin/open", ["-R", alias]]]);
});

/** On Linux a path opens with `xdg-open`, and what is only shown is shown by opening the folder that holds it. */
test("on Linux a path opens with xdg-open and a risky one opens its folder", async () => {
  const file = join(root, "notes.txt"); writeFileSync(file, "x");
  const script = join(root, "run.sh"); writeFileSync(script, "x");
  const { calls, run } = recorder();
  await openLocalPath(file, { platform: "linux", run });
  await openLocalPath(script, { platform: "linux", run });
  expect(calls).toEqual([["xdg-open", [file]], ["xdg-open", [root]]]);
});

/** On Windows Shell never opens a file: a folder opens in Explorer and a file is selected in it, so nothing can run from a click. */
test("on Windows a folder opens in Explorer and a file is only selected in it", async () => {
  const file = join(root, "notes.txt"); writeFileSync(file, "x");
  const folder = join(root, "docs"); mkdirSync(folder);
  const { calls, run } = recorder();
  await openLocalPath(file, { platform: "win32", run });
  await openLocalPath(folder, { platform: "win32", run });
  expect(calls).toEqual([["explorer.exe", [`/select,${file}`]], ["explorer.exe", [folder]]]);
});

/** A launcher that fails, or a system Shell has no launcher for, answers false so the chat can say it could not open the path. */
test("a failing launcher or an unknown system answers false", async () => {
  const file = join(root, "notes.txt"); writeFileSync(file, "x");
  expect(await openLocalPath(file, { platform: "darwin", run: async () => { throw new Error("no app"); } })).toBe(false);
  const { calls, run } = recorder();
  expect(await openLocalPath(file, { platform: "freebsd", run })).toBe(false);
  expect(calls).toEqual([]);
});

/**
 * What a person can write for a path and what it means: absolute, `~/`, `./`, `../` and relative to the session's folder, each with an optional `:line` or `:line:column`. Only a path
 * that exists is understood; the suffix is cut off and given back apart. It exists because the same rules decide what becomes a link and what a click opens.
 */
test("paths are understood in every form, with or without a line suffix, and only when they exist", () => {
  const cwd = join(root, "project"); mkdirSync(join(cwd, "src"), { recursive: true });
  const home = join(root, "home"); mkdirSync(home);
  writeFileSync(join(cwd, "src", "app.ts"), "x"); writeFileSync(join(cwd, "package.json"), "x"); writeFileSync(join(home, "todo.md"), "x"); writeFileSync(join(root, "outside.txt"), "x");
  const base = { cwd: join(cwd, "src"), home };
  expect(resolveLocalPath("app.ts", base)).toEqual({ path: join(cwd, "src", "app.ts") });
  expect(resolveLocalPath("./app.ts:12", base)).toEqual({ path: join(cwd, "src", "app.ts"), line: 12 });
  expect(resolveLocalPath("../package.json:3:9", base)).toEqual({ path: join(cwd, "package.json"), line: 3, column: 9 });
  expect(resolveLocalPath("~/todo.md", base)).toEqual({ path: join(home, "todo.md") });
  expect(resolveLocalPath(join(root, "outside.txt"), base)).toEqual({ path: join(root, "outside.txt") });
  expect(resolveLocalPath(`${join(cwd, "src")}/`, base)).toEqual({ path: join(cwd, "src") });
  expect(resolveLocalPath("missing.ts", base)).toBeUndefined();
  expect(resolveLocalPath("./missing.ts:12:3", base)).toBeUndefined();
  expect(resolveLocalPath("~/missing.md", base)).toBeUndefined();
  expect(resolveLocalPath("", base)).toBeUndefined();
});
