import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGroupPrompt } from "./project-identity.ts";

const created: string[] = [];
function temp(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "forge614-shell-identity-")));
  created.push(dir);
  return dir;
}
afterEach(() => { for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function gitRepo(): string {
  const dir = temp();
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}
function identityFile(root: string, content = "{}"): void {
  mkdirSync(join(root, ".forge614"), { recursive: true });
  writeFileSync(join(root, ".forge614", "project.json"), content);
}

test("a Git repository with no identity file asks, and reports the repository root", async () => {
  const repo = gitRepo();
  expect(await resolveGroupPrompt({ cwd: repo, interactive: true })).toEqual({ ask: true, root: repo });
});

test("a folder with a manifest (no Git) and no identity file asks, rooted at that folder", async () => {
  for (const manifest of ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "forge614.node.json"]) {
    const dir = temp();
    writeFileSync(join(dir, manifest), "");
    expect(await resolveGroupPrompt({ cwd: dir, interactive: true })).toEqual({ ask: true, root: dir });
  }
});

test("a folder that is neither a Git repository nor has a manifest is not a project: no question", async () => {
  expect(await resolveGroupPrompt({ cwd: temp(), interactive: true })).toEqual({ ask: false });
});

test("an existing identity file never asks, whatever it says (acta 0023: if the file exists, never ask)", async () => {
  for (const content of ['{"schemaVersion":1,"project":{"id":"x","name":"a"},"ecosystem":{"id":"g","name":"mi-tienda"}}', '{"schemaVersion":1,"ecosystem":null}', "not json", ""]) {
    const repo = gitRepo();
    identityFile(repo, content);
    expect(await resolveGroupPrompt({ cwd: repo, interactive: true })).toEqual({ ask: false });
  }
});

test("a subfolder of a repository whose root already has the identity file does not ask", async () => {
  const repo = gitRepo();
  identityFile(repo);
  const sub = join(repo, "packages", "app");
  mkdirSync(sub, { recursive: true });
  expect(await resolveGroupPrompt({ cwd: sub, interactive: true })).toEqual({ ask: false });
});

test("a subfolder of a repository without the identity file asks, rooted at the repository", async () => {
  const repo = gitRepo();
  const sub = join(repo, "packages", "app");
  mkdirSync(sub, { recursive: true });
  expect(await resolveGroupPrompt({ cwd: sub, interactive: true })).toEqual({ ask: true, root: repo });
});

test("an identity path that is a directory or a broken symlink still counts as existing: no question", async () => {
  const withDir = gitRepo();
  mkdirSync(join(withDir, ".forge614", "project.json"), { recursive: true });
  expect(await resolveGroupPrompt({ cwd: withDir, interactive: true })).toEqual({ ask: false });
  const withLink = gitRepo();
  mkdirSync(join(withLink, ".forge614"));
  symlinkSync(join(withLink, "nowhere"), join(withLink, ".forge614", "project.json"));
  expect(await resolveGroupPrompt({ cwd: withLink, interactive: true })).toEqual({ ask: false });
});

test("a non-interactive run never asks, even for a project with no identity file", async () => {
  const repo = gitRepo();
  expect(await resolveGroupPrompt({ cwd: repo, interactive: false })).toEqual({ ask: false });
});

test("a folder that does not exist does not ask and does not throw", async () => {
  expect(await resolveGroupPrompt({ cwd: join(temp(), "missing"), interactive: true })).toEqual({ ask: false });
});

test("deciding never writes anything: the folder is byte-for-byte the same afterwards", async () => {
  const repo = gitRepo();
  const before = readdirSync(repo, { recursive: true }).sort();
  await resolveGroupPrompt({ cwd: repo, interactive: true });
  expect(readdirSync(repo, { recursive: true }).sort()).toEqual(before);
});
