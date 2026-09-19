# Public Installer and Update Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow macOS/Linux users to install the latest public GitHub Release with one `curl` command and update later with `forge614-shell update`.

**Architecture:** `scripts/install.sh` becomes one installer with no-argument/latest and explicit-archive entry points. Each release archive embeds that script; `src/cli.ts` reserves `update` and calls the embedded installer, never an AI engine.

**Tech Stack:** Bash, curl, tar, shasum/sha256sum, Node.js >=22.19.0, GitHub Releases REST API, Bun, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-18-public-installer-design.md`

## Global Constraints

- macOS and Linux only; reject other platforms before downloading.
- Require Node.js >=22.19.0, curl, tar, and shasum or sha256sum.
- Production metadata endpoint: `https://api.github.com/repos/jotredev/forge614-shell/releases/latest`.
- Preserve `bash install.sh --archive forge614-shell-<version>.tar.gz`.
- Each public release attaches the archive, matching `.sha256`, and `install.sh`.
- Do not require root, Git, GitHub CLI, Bun, npm, cloning, a custom domain, or Windows tooling.
- Never silently update; only initial install or `forge614-shell update` changes versions.
- Terminal copy remains English.

## Review Focus

- Missing one required latest-release asset leaves the active executable untouched.
- Bad checksum removes temporary downloads and preserves the old symlink.
- One leading `v` is normalized from a tag; unrelated asset names are rejected.
- `forge614-shell update extra` cannot invoke an update or start an AI session.
- An already-current install reports no change and keeps one PATH line.

---

## File Structure

- `scripts/install.sh`: downloader, verifier, explicit archive installer.
- `scripts/release-bundle.mjs`: embeds executable `install.sh` in every archive.
- `src/infrastructure/updater.ts`: calls embedded installer with `--latest`.
- `src/cli.ts`: exact `update` dispatch before interactive startup.
- `tests/integration/release-bundle.test.ts`: archive content and PATH idempotency.
- `tests/integration/public-installer.test.ts`: local synthetic release-server integration coverage.
- `src/infrastructure/updater.test.ts`: updater process-boundary coverage.
- `docs/en`, `docs/es`, `README.md`: public-install/update and maintainer release instructions.

### Task 1: Embed the installer in every bundle

**Files:**
- Modify: `scripts/release-bundle.mjs`
- Modify: `tests/integration/release-bundle.test.ts`

**Interfaces:**
- Consumes: `scripts/install.sh`.
- Produces: executable `<release-root>/install.sh` beside `dist/cli.js`.

- [ ] **Step 1: Write a failing bundle-content test**

After generating the archive, unpack it and add:

```ts
const unpacked = join(root, "unpacked");
expect(Bun.spawnSync(["tar", "-xzf", join(output, archive!), "-C", unpacked]).exitCode).toBe(0);
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const installer = join(unpacked, `forge614-shell-${version}`, "install.sh");
expect(await readFile(installer, "utf8")).toContain("--latest");
```

Run the archive installer twice and assert one line only:

```ts
const profile = await readFile(join(home, ".zshrc"), "utf8");
expect(profile.split(`export PATH=\"${installation}/bin:$PATH\"`).length - 1).toBe(1);
```

- [ ] **Step 2: Verify RED**

Run: `bun test tests/integration/release-bundle.test.ts`

Expected: FAIL because the archive has no embedded installer and current installer has no `--latest` contract.

- [ ] **Step 3: Copy and mark executable**

After copying package metadata in `scripts/release-bundle.mjs`, add:

```js
await cp(join(root, "scripts", "install.sh"), join(releaseRoot, "install.sh"));
await chmod(join(releaseRoot, "install.sh"), 0o755);
```

- [ ] **Step 4: Commit after Task 2 makes this test green**

```bash
git add scripts/release-bundle.mjs tests/integration/release-bundle.test.ts
git commit -m "Package installer with release bundles"
```

### Task 2: Add verified latest-release installation

**Files:**
- Modify: `scripts/install.sh`
- Create: `tests/integration/public-installer.test.ts`
- Modify: `tests/integration/release-bundle.test.ts`

**Interfaces:**
- Consumes: no arguments, `--latest`, `--archive <path>`, and test-only `FORGE614_RELEASE_API_URL`.
- Produces: active `~/.forge614/bin/forge614-shell` or a non-zero direct error with no active symlink mutation.

- [ ] **Step 1: Write synthetic-server tests**

Create `tests/integration/public-installer.test.ts`. Build a real local archive using `scripts/release-bundle.mjs`, then serve metadata and assets through `Bun.serve`:

```ts
const server = Bun.serve({
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/latest") return Response.json({
      tag_name: "1.0.1",
      assets: [
        { name: archiveName, browser_download_url: `${server.url}archive` },
        { name: `${archiveName}.sha256`, browser_download_url: `${server.url}checksum` },
      ],
    });
    if (path === "/archive") return new Response(archiveBytes);
    if (path === "/checksum") return new Response(checksumBytes);
    return new Response("missing", { status: 404 });
  },
});
```

Spawn `bash scripts/install.sh --latest` with isolated `HOME`, `FORGE614_HOME`, `SHELL=/bin/zsh`, and `FORGE614_RELEASE_API_URL=${server.url}latest`. Assert success, installed `--version`, and one PATH line.

Write a separate checksum failure test: first install a valid old archive, retain `readlink(<home>/.forge614/bin/forge614-shell)`, serve an invalid checksum, then assert non-zero exit and unchanged symlink.

- [ ] **Step 2: Verify RED**

Run: `bun test tests/integration/public-installer.test.ts`

Expected: FAIL because `install.sh` rejects `--latest`.

- [ ] **Step 3: Implement modes and prerequisites**

Replace the argument guard with:

```bash
mode="latest"
archive=""
if [[ $# -eq 0 || ( $# -eq 1 && "$1" == "--latest" ) ]]; then
  mode="latest"
elif [[ $# -eq 2 && "$1" == "--archive" ]]; then
  mode="archive"; archive="$2"
else
  echo "Usage: install.sh [--latest | --archive <forge614-shell-<version>.tar.gz>]" >&2; exit 64
fi
case "$(uname -s)" in Darwin|Linux) ;; *) echo "Forge614 Shell supports macOS and Linux only." >&2; exit 69 ;; esac
```

Require curl, tar, Node >=22.19.0 (numeric major/minor comparison), and either `shasum` or `sha256sum` before network work.

- [ ] **Step 4: Resolve, download, and verify strict assets**

Fetch metadata only in latest mode:

```bash
api_url="${FORGE614_RELEASE_API_URL:-https://api.github.com/repos/jotredev/forge614-shell/releases/latest}"
release_json="$(curl --fail --silent --show-error --location "$api_url")"
```

Pass JSON over stdin to Node. Normalize exactly one leading `v`; require strict numeric SemVer; select exactly `forge614-shell-${version}.tar.gz` plus `${archive}.sha256`; reject duplicates or absent assets. Require HTTPS asset URLs in production; permit HTTP only while the explicit test-only `FORGE614_RELEASE_API_URL` override is set. Download both into `mktemp -d`, then execute `shasum -a 256 -c` or `sha256sum -c` from that directory before extraction.

- [ ] **Step 5: Preserve state and handle a current version**

After archive validation but before moving/repointing, use:

```bash
active_link="$forge_home/bin/forge614-shell"
if [[ -L "$active_link" && "$(readlink "$active_link")" == "$target/dist/cli.js" ]]; then
  echo "Forge614 Shell v$version is already active."
  exit 0
fi
```

Keep all candidate files in the temporary directory until valid. Only then move staging and repoint the link. `trap cleanup EXIT` must delete temporary files on every branch.

- [ ] **Step 6: Verify GREEN and commit**

Run: `bun test tests/integration/public-installer.test.ts tests/integration/release-bundle.test.ts`

Expected: PASS; valid install works, checksum failure retains old link, and PATH is idempotent.

```bash
git add scripts/install.sh scripts/release-bundle.mjs tests/integration/public-installer.test.ts tests/integration/release-bundle.test.ts
git commit -m "Add verified public release installer"
```

### Task 3: Add the native update command

**Files:**
- Create: `src/infrastructure/updater.ts`
- Create: `src/infrastructure/updater.test.ts`
- Modify: `src/cli.ts`
- Modify: `tests/integration/public-installer.test.ts`

**Interfaces:**
- Produces: `updateInstalledShell(options?: { installer?: string; spawn?: typeof spawnSync }): Promise<void>`.
- Consumes: bundled `../install.sh`.
- CLI: exact `forge614-shell update` only.

- [ ] **Step 1: Write failing updater tests**

Create `src/infrastructure/updater.test.ts`:

```ts
test("runs the bundled installer with --latest", async () => {
  const calls: string[][] = [];
  await updateInstalledShell({ installer: "/tmp/release/install.sh", spawn: (command, args) => {
    calls.push([command, ...args]); return { status: 0, stderr: "" } as never;
  }});
  expect(calls).toEqual([["bash", "/tmp/release/install.sh", "--latest"]]);
});
test("reports installer diagnostics", async () => {
  await expect(updateInstalledShell({ installer: "/tmp/release/install.sh", spawn: () =>
    ({ status: 69, stderr: "Node.js is required" }) as never,
  })).rejects.toThrow("Node.js is required");
});
```

Add integration coverage invoking installed `forge614-shell update` against the synthetic server and assert it changes the active version without starting an engine.

- [ ] **Step 2: Verify RED**

Run: `bun test src/infrastructure/updater.test.ts tests/integration/public-installer.test.ts`

Expected: FAIL because updater and CLI update dispatch do not exist.

- [ ] **Step 3: Implement process boundary and CLI dispatch**

Create `src/infrastructure/updater.ts`:

```ts
export async function updateInstalledShell(options: { installer?: string; spawn?: typeof spawnSync } = {}): Promise<void> {
  const installer = options.installer ?? fileURLToPath(new URL("../install.sh", import.meta.url));
  const result = (options.spawn ?? spawnSync)("bash", [installer, "--latest"], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr?.toString().trim() || "Forge614 Shell update failed.");
}
```

In `src/cli.ts`, before help/version/startup, dispatch only `args.length === 1 && args[0] === "update"`, call `updateInstalledShell`, print failures as `Forge614-Shell update failed: ...`, and end the process. Add help text: `update              Download and activate the latest stable release`. Do not add `/update` to chat commands.

- [ ] **Step 4: Verify GREEN and commit**

Run: `bun test src/infrastructure/updater.test.ts tests/integration/public-installer.test.ts`

Expected: PASS; exact update works, failures are visible, and no engine starts.

```bash
git add src/infrastructure/updater.ts src/infrastructure/updater.test.ts src/cli.ts tests/integration/public-installer.test.ts
git commit -m "Add Forge614 Shell update command"
```

### Task 4: Update public documentation and prepare a patch locally

**Files:**
- Modify: `README.md`
- Modify: `docs/en/00-installation-and-local-release-test.md`
- Modify: `docs/es/00-instalacion-y-prueba-local-release.md`
- Modify: `docs/en/06-release-1.0.0-bundle-installer.md`
- Modify: `docs/es/06-preparacion-release-1.0.0-instalador.md`
- Modify: `package.json`
- Modify: `tests/integration/release-bundle.test.ts`

**Interfaces:**
- Produces: public ES/EN installation/update instructions and locally verified next-patch Assets.

- [ ] **Step 1: Replace private-only instructions**

Document first install in both languages:

```bash
curl -fsSL https://github.com/jotredev/forge614-shell/releases/latest/download/install.sh | bash
```

Document later updates:

```bash
forge614-shell update
```

Keep Node and macOS/Linux requirements. Remove claims that public curl install does not exist.

- [ ] **Step 2: State exact future release Assets**

In the maintainer guides require:

```text
forge614-shell-<version>.tar.gz
forge614-shell-<version>.tar.gz.sha256
install.sh
```

State `releases/latest` must represent only a published stable release; numeric tags remain `1.0.x`, visible labels remain `v1.0.x`.

- [ ] **Step 3: Verify documentation consistency**

Run:

```bash
rg -n 'private repository|authorized collaborator|No public installer|curl.*do not exist' README.md docs/en docs/es
git diff --check
```

Expected: no stale description says public macOS/Linux installation is unavailable.

- [ ] **Step 4: Bump and locally package the next patch**

Change `package.json` to the next patch version and update intentional version assertions. Then run:

```bash
bun run check
rm -rf dist/release
bun run bundle:release
cd dist/release && shasum -a 256 -c forge614-shell-<next-version>.tar.gz.sha256
```

Expected: all tests pass, build succeeds, archive/checksum exist, and checksum reports `OK`.

- [ ] **Step 5: Commit source only**

```bash
git add README.md docs/en docs/es package.json tests/integration/release-bundle.test.ts
git commit -m "Release <next-version>"
```

Do not create/push a tag, create a GitHub Release, or upload Assets. The maintainer performs all publication actions.

## Spec Coverage Review

- One-command public install: Task 2.
- Public GitHub assets and embedded updater: Tasks 1 and 2.
- Explicit archive install: Task 2.
- Checksum and rollback safety: Task 2.
- `forge614-shell update`: Task 3.
- Documentation, version, and maintainer-only publication: Task 4.
