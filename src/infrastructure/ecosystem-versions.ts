import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { stripVTControlCharacters } from "node:util";
import { enginesBinary } from "./forge614-engines.ts";
import { locateEngramBinary } from "./forge614-engram.ts";

/**
 * What Shell knows about one Forge614 binary: its version (the last word of what `--version` prints), that it is not there at all («missing»: Shell never runs what does not exist),
 * or that it is there but gave no version (it failed, printed nothing or did not answer in time: «unreadable»).
 */
export type ToolVersion = { state: "version"; version: string } | { state: "unreadable" } | { state: "missing" };

/** The two binaries the Forge614 panel names besides Shell itself. */
export interface EcosystemVersions { engines: ToolVersion; engram: ToolVersion }

/** The clock the limit uses: `setTimeout` and `clearTimeout` in real life, a stand-in in a test so no real seconds pass. */
export interface VersionTimers {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

/** How long each binary has to answer `--version` before its row goes without a version. */
export const VERSION_LIMIT_MS = 3000;

/** A version is a short word; anything longer or with terminal control characters is not taken as one. */
const MAX_VERSION_LENGTH = 40;

const realTimers: VersionTimers = { set: (callback, ms) => setTimeout(callback, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };

/** The real `--version` call: the binary's output, or a rejection when it fails; `execFile` itself also ends the process after the limit. */
function defaultRun(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: VERSION_LIMIT_MS, windowsHide: true, encoding: "utf8" }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

/** The version in what a binary printed (`forge614-engines 1.16.0`): its last word, without control characters; none when there is no usable word. */
function parseVersion(output: string): string | undefined {
  const word = stripVTControlCharacters(output).replace(/[\x00-\x1f\x7f]/g, " ").trim().split(/\s+/).at(-1);
  return word && word.length <= MAX_VERSION_LENGTH ? word : undefined;
}

async function readOne(binary: string, exists: (path: string) => boolean, run: (binary: string, args: string[]) => Promise<string>, timers: VersionTimers, limitMs: number): Promise<ToolVersion> {
  if (!exists(binary)) return { state: "missing" };
  let handle: unknown;
  const timeout = new Promise<undefined>(resolve => { handle = timers.set(() => resolve(undefined), limitMs); });
  try {
    const version = parseVersion(await Promise.race([run(binary, ["--version"]), timeout]) ?? "");
    return version ? { state: "version", version } : { state: "unreadable" };
  } catch {
    return { state: "unreadable" };
  } finally {
    timers.clear(handle);
  }
}

/**
 * Reads `--version` of the Engines and Engram binaries (the ones `enginesBinary` and `locateEngramBinary` already name), each once and at the same time, each with its own 3 seconds. Meant to run
 * once when Shell opens, in the background: it never throws, and a binary that is missing, fails or does not answer only changes its own entry. `exists`, `run` and `timers` are parameters so a test
 * stands in for the binaries and the clock; the real ones are never run by the tests.
 */
export async function readEcosystemVersions(options: {
  home?: string;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  run?: (binary: string, args: string[]) => Promise<string>;
  timers?: VersionTimers;
  limitMs?: number;
} = {}): Promise<EcosystemVersions> {
  const home = options.home ?? homedir();
  const exists = options.exists ?? existsSync;
  const run = options.run ?? defaultRun;
  const timers = options.timers ?? realTimers;
  const limitMs = options.limitMs ?? VERSION_LIMIT_MS;
  const [engines, engram] = await Promise.all([
    readOne(enginesBinary(home, options.env), exists, run, timers, limitMs),
    readOne(locateEngramBinary(home, options.env), exists, run, timers, limitMs),
  ]);
  return { engines, engram };
}
