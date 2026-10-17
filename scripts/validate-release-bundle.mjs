import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dirFlag = args.indexOf("--dir");
const distDir = resolve(dirFlag !== -1 ? args[dirFlag + 1] : args[0] || join(root, "dist", "release"));

const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = metadata.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid package version: "${version}"`);
  process.exit(1);
}

const expectedArchiveName = `forge614-shell-${version}.tar.gz`;
const expectedChecksumName = `${expectedArchiveName}.sha256`;
const expectedFiles = [expectedArchiveName, expectedChecksumName, "install.ps1", "install.sh"].sort();

let actualFiles;
try {
  actualFiles = readdirSync(distDir).sort();
} catch (error) {
  console.error(`Could not read release output directory: ${distDir}`, error);
  process.exit(1);
}

if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  console.error("Release output directory contents do not match expected assets:");
  console.error("  Expected:", expectedFiles);
  console.error("  Actual:  ", actualFiles);
  process.exit(1);
}

const archivePath = join(distDir, expectedArchiveName);
const stat = statSync(archivePath);
if (stat.size === 0) {
  console.error(`Release archive is empty: ${archivePath}`);
  process.exit(1);
}

const archiveBytes = readFileSync(archivePath);
const actualHash = createHash("sha256").update(archiveBytes).digest("hex");
const checksumPath = join(distDir, expectedChecksumName);
const checksumContent = readFileSync(checksumPath, "utf8");
const expectedChecksumLine = `${actualHash}  ${expectedArchiveName}\n`;

if (checksumContent !== expectedChecksumLine) {
  console.error("SHA-256 sidecar content does not match expected hash or format:");
  console.error(`  Expected: "${expectedChecksumLine}"`);
  console.error(`  Actual:   "${checksumContent}"`);
  process.exit(1);
}

let tarEntries;
try {
  const listing = execFileSync("tar", ["-tf", archivePath], { encoding: "utf8" });
  tarEntries = listing.split(/\r?\n/).filter(Boolean);
} catch (error) {
  console.error("Failed to inspect archive with tar:", error);
  process.exit(1);
}

const releasePrefix = `forge614-shell-${version}`;
const requiredPieces = [
  `${releasePrefix}/package.json`,
  `${releasePrefix}/dist/cli.js`,
  `${releasePrefix}/install.sh`,
  `${releasePrefix}/install.ps1`,
  `${releasePrefix}/forge614-shell.cmd.template`,
];

for (const piece of requiredPieces) {
  if (!tarEntries.includes(piece)) {
    console.error(`Archive is missing required piece used by installers: ${piece}`);
    process.exit(1);
  }
}

// Verify package.json inside archive has exact matching version
try {
  const extractedPackageJson = execFileSync("tar", ["-xzf", archivePath, "-O", `${releasePrefix}/package.json`], { encoding: "utf8" });
  const archivedMetadata = JSON.parse(extractedPackageJson);
  if (archivedMetadata.version !== version) {
    console.error(`Version mismatch in archived package.json: expected "${version}", found "${archivedMetadata.version}"`);
    process.exit(1);
  }
} catch (error) {
  console.error("Failed to read package.json from archive:", error);
  process.exit(1);
}

console.log(`Validated release bundle in ${distDir} (version: ${version}, archive: ${expectedArchiveName}, size: ${stat.size} bytes).`);
