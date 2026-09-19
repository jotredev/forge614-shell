import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outputFlag = args.indexOf("--out");
const output = outputFlag === -1 ? join(root, "dist", "release") : resolve(args[outputFlag + 1] ?? "");
if (outputFlag !== -1 && !args[outputFlag + 1]) throw new Error("--out requires a directory.");

const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = metadata.version;
const stagingRoot = await mkdtemp(join(tmpdir(), "forge614-release-"));
const releaseName = `forge614-shell-${version}`;
const releaseRoot = join(stagingRoot, releaseName);
const archive = join(output, `${releaseName}.tar.gz`);
const bun = process.execPath.endsWith("bun") ? process.execPath : "bun";

try {
  await mkdir(join(releaseRoot, "dist"), { recursive: true });
  execFileSync(bun, ["build", "src/cli.ts", "--target=node", "--outdir", join(releaseRoot, "dist")], { cwd: root, stdio: "inherit" });
  await cp(join(root, "package.json"), join(releaseRoot, "package.json"));
  await cp(join(root, "scripts", "install.sh"), join(releaseRoot, "install.sh"));
  await cp(join(root, "extensions"), join(releaseRoot, "extensions"), { recursive: true });
  await chmod(join(releaseRoot, "dist", "cli.js"), 0o755);
  await chmod(join(releaseRoot, "install.sh"), 0o755);

  await mkdir(output, { recursive: true });
  execFileSync("tar", ["-czf", archive, "-C", stagingRoot, releaseName]);
  const checksum = createHash("sha256").update(await readFile(archive)).digest("hex");
  await writeFile(`${archive}.sha256`, `${checksum}  ${basename(archive)}\n`);
  console.log(`Created ${archive}`);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
