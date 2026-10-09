import { expect, test, beforeAll, afterAll } from "bun:test";
import type { Terminal } from "@earendil-works/pi-tui";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { basename, dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { claudeMenuCommands, startClaudeUI } from "./claude.ts";
import { getCatalog } from "../../i18n/index.ts";
import { emptyTelemetry, telemetryLines } from "../../engines/claude/telemetry.ts";
import type { EcosystemVersions } from "../../infrastructure/ecosystem-versions.ts";

let sharedLauncherExe: string | undefined;
let sharedLauncherDir: string | undefined;

beforeAll(async () => {
  if (process.platform === "win32") {
    sharedLauncherDir = await mkdtemp(join(tmpdir(), "forge614-claude-launcher-"));
    const srcFile = join(sharedLauncherDir, "launcher.js");
    sharedLauncherExe = join(sharedLauncherDir, "launcher.exe");
    writeFileSync(srcFile, `
const { spawn } = require("node:child_process");
const { join, dirname, basename, extname } = require("node:path");
const script = join(dirname(process.execPath), basename(process.execPath, extname(process.execPath)) + ".worker.js");
const bunBin = process.env.FORGE614_BUN_BIN || ${JSON.stringify(process.execPath)} || "bun";
const child = spawn(bunBin, [script, ...process.argv.slice(2)], {
  stdio: "inherit",
  windowsHide: true,
});
child.on("exit", (code, signal) => {
  if (signal) {
    try { process.kill(process.pid, signal); } catch { process.exit(1); }
  } else {
    process.exit(code ?? 0);
  }
});
child.on("error", (err) => {
  console.error("Launcher error:", err);
  process.exit(1);
});
`);
    execFileSync("bun", ["build", srcFile, "--compile", "--outfile", sharedLauncherExe]);
  }
});

afterAll(async () => {
  if (sharedLauncherDir) {
    await rm(sharedLauncherDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const testExecutablePath = (dir: string, name = "claude") => join(dir, process.platform === "win32" ? `${name}.exe` : name);

/**
 * Escribe un ejecutable de prueba para Claude Code o Engines.
 * En Unix escribe el script con shebang `#!${process.execPath}` y modo 0o755.
 * En Windows copia el lanzador nativo compilado `.exe` y escribe el script JS adyacente (`<nombre>.worker.js`).
 */
async function writeTestExecutable(targetPath: string, scriptContent: string): Promise<string> {
  if (process.platform === "win32") {
    const exePath = targetPath.toLowerCase().endsWith(".exe") ? targetPath : `${targetPath}.exe`;
    const dir = dirname(exePath);
    mkdirSync(dir, { recursive: true });
    const base = basename(exePath, extname(exePath));
    const workerFile = join(dir, `${base}.worker.js`);
    await writeFile(workerFile, scriptContent, "utf8");
    copyFileSync(sharedLauncherExe!, exePath);
    return exePath;
  }
  await writeFile(targetPath, `#!${process.execPath}\n${scriptContent}`, { mode: 0o755 });
  return targetPath;
}

function writeTestExecutableSync(targetPath: string, scriptContent: string): string {
  if (process.platform === "win32") {
    const exePath = targetPath.toLowerCase().endsWith(".exe") ? targetPath : `${targetPath}.exe`;
    const dir = dirname(exePath);
    mkdirSync(dir, { recursive: true });
    const base = basename(exePath, extname(exePath));
    const workerFile = join(dir, `${base}.worker.js`);
    writeFileSync(workerFile, scriptContent, "utf8");
    copyFileSync(sharedLauncherExe!, exePath);
    return exePath;
  }
  writeFileSync(targetPath, `#!${process.execPath}\n${scriptContent}`, { mode: 0o755 });
  return targetPath;
}

class TestTerminal implements Terminal {
  columns = 120; rows = 50; kittyProtocolActive = false;
  input: (data: string) => void = () => {}; output = "";
  /** What the screen asked to be told when the terminal changes size: calling it makes the next frame draw every row again, not just the rows that changed. */
  resize: () => void = () => {};
  start(input: (data: string) => void, resize: () => void = () => {}) { this.input = input; this.resize = resize; }
  stop() {} async drainInput() {} write(data: string) { this.output += data; }
  moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
}
const tick = () => new Promise(resolve => setTimeout(resolve, 35));

test("Claude UI accepts logout consent and stop while auth is pending, without sending a model message", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-logout-ui-"));
  const executable = testExecutablePath(root); const marker = join(root, "calls");
  const terminal = new TestTerminal(); let ui: Promise<void> | undefined;
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  // Shell persists /model and /effort picks to $FORGE614_HOME/shell/preferences.json (see
  // shell-preferences.ts) — isolate it so this test never reads or writes the real developer's
  // ~/.forge614 preferences file.
  const previousForgeHome = process.env.FORGE614_HOME;
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.FORGE614_HOME = join(root, "forge614-home");
  process.env.HOME = join(root, "home");
  process.env.USERPROFILE = join(root, "home");
  process.env.CLAUDE_CONFIG_DIR = join(root, "claude-config");
  try {
    await writeTestExecutable(executable, `const fs=require('fs');
if(process.argv[2]==='auth') {
  fs.appendFileSync(${JSON.stringify(marker)},process.argv.slice(2).join(' ')+'\\n');
  console.log('{"loggedIn":true,"authMethod":"claude.ai"}');
} else {
  require('readline').createInterface({input:process.stdin}).on('line',line=>{
    const msg=JSON.parse(line);
    if(msg.type==='user') fs.appendFileSync(${JSON.stringify(marker)},'UNEXPECTED PROMPT\\n');
    if(msg.type==='control_request') console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,response:{models:[{value:'default',displayName:'Default',description:'Native default',supportedEffortLevels:['low','high']}],account:{email:'test@example.com'},commands:[{name:'model',description:'Select model',argumentHint:''},{name:'effort',description:'Select reasoning',argumentHint:''}],agents:[],output_style:'default',available_output_styles:[]}}}));
  });
}`);
    ui = startClaudeUI([], executable, terminal); await tick();
    for (let i = 0; i < 60 && !terminal.output.includes("Connected"); i++) await tick();
    expect(terminal.output).toContain("Connected");
    expect(await readFile(marker, "utf8")).toBe("auth status --json\n");
    expect(terminal.output).toContain("SESSION");
    // Claude Code opens in the background and the catalog is read over it once Engram's memory and the startup-hook check (real processes, slow on a cold start) are in: wait for the line, not for a fixed moment.
    for (let i = 0; i < 200 && !terminal.output.includes("test@example.com"); i++) await tick();
    expect(terminal.output).toContain("test@example.com");
    // Claude always supports background-activity reporting (Task 8): once connected, the sidebar's
    // "Background activity" section should render — with nothing running yet, that means the idle
    // message, not the "doesn't report" fallback CodexSession-less engines get. The sidebar rail is
    // narrower than the full idle sentence, so it truncates mid-word with "…" — assert a safe leading
    // fragment (still sourced from the real catalog string, not a hand-typed literal) rather than the
    // whole sentence.
    expect(terminal.output).toContain(getCatalog("en").backgroundActivity.idle.slice(0, 16));
    enter("/model"); await tick();
    expect(terminal.output).toContain("Select model");
    expect(terminal.output).toContain("Native default");
    expect(await readFile(marker, "utf8")).not.toContain("UNEXPECTED PROMPT");
    terminal.input("\x1b"); await tick();
    enter("/effort"); await tick();
    expect(terminal.output).toContain("Select reasoning");
    terminal.input("\x1b"); await tick();
    enter("/logout"); await tick();
    expect(terminal.output).toContain("only in this Forge614-Shell session");
    terminal.input("\x1b"); await tick();
    expect(await readFile(marker, "utf8")).toBe("auth status --json\n");
    enter("/logout"); await tick(); terminal.input("\r"); await tick();
    expect(await readFile(marker, "utf8")).toBe("auth status --json\n");
    enter("/logout"); await tick(); terminal.input("\x1b[B"); terminal.input("\r");
    await tick();
    expect(terminal.output).toContain("Disconnected locally");
    enter("/new"); await tick(); enter("hello"); await tick();
    expect(await readFile(marker, "utf8")).toBe("auth status --json\n");
    expect(terminal.output).toContain("Use /login");
    enter("/login");
    for (let i = 0; i < 30 && !terminal.output.includes("Connected to Claude in Shell"); i++) await tick();
    expect(await readFile(marker, "utf8")).toBe("auth status --json\nauth status --json\n");
    expect(terminal.output).toContain("Connected to Claude in Shell");
  } finally {
    enter("/f614:quit"); await ui; await tick(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    if (previousForgeHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousForgeHome;
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
    if (previousClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
  }
});

/**
 * Idea 7 and idea 1 on the Claude screen: the work mode saved last time is put back on opening (here
 * «Plan mode», not the default), Shift+Tab keeps cycling the SDK's modes without any «Finish or /stop»
 * error, and every change is written to Shell's preferences. Uses a fake `claude` executable, so no
 * real account or network is involved.
 */
test("Claude UI restores the saved work mode on opening and saves every Shift+Tab change", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-mode-ui-"));
  const executable = testExecutablePath(root);
  const terminal = new TestTerminal(); let ui: Promise<void> | undefined;
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  const previousForgeHome = process.env.FORGE614_HOME;
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.FORGE614_HOME = join(root, "forge614-home");
  process.env.HOME = join(root, "home");
  process.env.USERPROFILE = join(root, "home");
  process.env.CLAUDE_CONFIG_DIR = join(root, "claude-config");
  const preferences = () => JSON.parse(readFileSync(join(root, "forge614-home", "shell", "preferences.json"), "utf8"));
  try {
    mkdirSync(join(root, "forge614-home", "shell"), { recursive: true });
    writeFileSync(join(root, "forge614-home", "shell", "preferences.json"), JSON.stringify({ claude: { mode: "plan" } }));
    await writeTestExecutable(executable, `if(process.argv[2]==='auth') { console.log('{"loggedIn":true,"authMethod":"claude.ai"}'); }
else {
  require('readline').createInterface({input:process.stdin}).on('line',line=>{
    const msg=JSON.parse(line);
    if(msg.type==='control_request') console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,response:{models:[],account:{email:'test@example.com'},commands:[],agents:[],output_style:'default',available_output_styles:[]}}}));
  });
}`);
    ui = startClaudeUI([], executable, terminal); await tick();
    for (let i = 0; i < 60 && !terminal.output.includes("test@example.com"); i++) await tick();
    // «Plan» is the name Claude Code itself gives the mode; the restored mode is on screen before any key is pressed.
    expect(stripVTControlCharacters(terminal.output)).toContain("Ⅱ Plan");
    terminal.input("\x1b[Z"); await tick();
    expect(preferences().claude.mode).toBe("dontAsk");
    expect(stripVTControlCharacters(terminal.output)).toContain("Don't Ask");
    expect(stripVTControlCharacters(terminal.output)).not.toContain("Finish or /stop");
    // Shift+Tab is Claude Code's own here and did not change with Codex's Plan switch: it still cycles the permission modes.
    expect(stripVTControlCharacters(terminal.output)).toContain(getCatalog("en").workMode.shiftTabToCycle);
    expect(stripVTControlCharacters(terminal.output)).not.toContain("Shift+Tab: Plan");
  } finally {
    enter("/f614:quit"); await ui; await tick(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    if (previousForgeHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousForgeHome;
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
    if (previousClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
  }
});

/**
 * Shell's own «cancel the answer in progress» is `/f614:stop` now: `/stop` no longer belongs to Shell, so
 * it does not cancel anything. Uses a fake `claude` that accepts the prompt and never answers, so the turn
 * stays open until it is cancelled; no real account or network is involved.
 */
test("Claude UI: /f614:stop cancels the running turn and a plain /stop does not", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-stop-ui-"));
  const executable = testExecutablePath(root);
  const terminal = new TestTerminal(); let ui: Promise<void> | undefined;
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  const plain = () => stripVTControlCharacters(terminal.output);
  const previousForgeHome = process.env.FORGE614_HOME;
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.FORGE614_HOME = join(root, "forge614-home");
  process.env.HOME = join(root, "home");
  process.env.USERPROFILE = join(root, "home");
  process.env.CLAUDE_CONFIG_DIR = join(root, "claude-config");
  try {
    // The fake keeps every message unanswered until it is interrupted, then ends them with the error result Claude Code gives (measured), so the turn closes with the stop and the process stays open.
    await writeTestExecutable(executable, `const open=[];
if(process.argv[2]==='auth') { console.log('{"loggedIn":true,"authMethod":"claude.ai"}'); }
else {
  require('readline').createInterface({input:process.stdin}).on('line',line=>{
    const msg=JSON.parse(line);
    if(msg.type==='user') open.push(msg.uuid);
    if(msg.type==='control_request' && msg.request.subtype==='interrupt') { console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,response:{still_queued:[]}}})); const uuids=open.splice(0); if(uuids.length) console.log(JSON.stringify({type:'result',subtype:'error_during_execution',is_error:true,duration_ms:1,duration_api_ms:1,num_turns:1,errors:[],session_id:'s1',total_cost_usd:0,usage:{},modelUsage:{},permission_denials:[],user_message_uuids:uuids,uuid:'result-'+Date.now()})); }
    else if(msg.type==='control_request') console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,response:{models:[],account:{email:'test@example.com'},commands:[],agents:[],output_style:'default',available_output_styles:[]}}}));
  });
}`);
    ui = startClaudeUI([], executable, terminal); await tick();
    for (let i = 0; i < 60 && !terminal.output.includes("test@example.com"); i++) await tick();
    enter("work please"); await tick();
    for (let i = 0; i < 30 && !plain().includes(getCatalog("en").chat.statusWorking); i++) await tick();
    expect(plain()).toContain(getCatalog("en").chat.statusWorking);
    terminal.output = ""; enter("/stop"); await tick(); await tick();
    // `/stop` is no longer Shell's: it cancels nothing, the person is told which command does, and the turn keeps running.
    expect(plain()).toContain(getCatalog("en").claudeChat.finishOrStopFirst);
    expect(plain()).not.toContain(getCatalog("en").chat.statusReady);
    terminal.output = ""; enter("/f614:stop");
    for (let i = 0; i < 60 && !plain().includes(getCatalog("en").chat.statusReady); i++) await tick();
    expect(plain()).toContain(getCatalog("en").chat.statusReady);
  } finally {
    enter("/f614:quit"); await ui; await tick(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    if (previousForgeHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousForgeHome;
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
    if (previousClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
  }
});

/**
 * A Claude Code tool permission end to end: the fake `claude` asks `can_use_tool` for a Bash call (the SDK's `BashInput`
 * with a `description`), the screen shows the description, the folder and the command in plain words with «Sí»/«No» and
 * «Sí» marked (no JSON, no `/yes`, no numbers), Enter alone approves and Esc denies, and the fake receives exactly
 * `allow` and then `deny`. It exists because the request used to be printed as `Permiso solicitado: Bash { "command": … }`
 * with «/no» marked first. The session works in `/tmp` (a short, fixed folder) so the screen never depends on how long the
 * path of the machine running the test is: in a copy under a long path the folder line used to wrap and the test failed.
 */
test("Claude UI: a Bash permission reads in plain words, Enter alone approves it and Esc denies it", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-permission-ui-"));
  const executable = testExecutablePath(root); const marker = join(root, "decisions");
  const terminal = new TestTerminal(); let ui: Promise<void> | undefined;
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  const plain = () => stripVTControlCharacters(terminal.output);
  const previousForgeHome = process.env.FORGE614_HOME;
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.FORGE614_HOME = join(root, "forge614-home");
  process.env.HOME = join(root, "home");
  process.env.USERPROFILE = join(root, "home");
  process.env.CLAUDE_CONFIG_DIR = join(root, "claude-config");
  const previousCwd = process.cwd();
  const workDir = process.platform === "win32" ? tmpdir() : "/tmp";
  process.chdir(workDir);
  try {
    await writeTestExecutable(executable, `const fs=require('fs'); let last;
if(process.argv[2]==='auth') { console.log('{"loggedIn":true,"authMethod":"claude.ai"}'); }
else {
  require('readline').createInterface({input:process.stdin}).on('line',line=>{
    const msg=JSON.parse(line);
    if(msg.type==='control_request') console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,response:{models:[],account:{email:'test@example.com'},commands:[],agents:[],output_style:'default',available_output_styles:[]}}}));
    if(msg.type==='user') last=msg.uuid;
    if(msg.type==='user') console.log(JSON.stringify({type:'control_request',request_id:'permission-'+Date.now(),request:{subtype:'can_use_tool',tool_name:'Bash',input:{command:'rtk grep -rn changelog .',description:'Buscar el changelog de Engram en este repositorio'},tool_use_id:'tool-1'}}));
    if(msg.type==='control_response' && msg.response.response && msg.response.response.behavior) {
      fs.appendFileSync(${JSON.stringify(marker)},msg.response.response.behavior+'\\n');
      console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,duration_ms:1,duration_api_ms:1,num_turns:1,result:'ok',session_id:'s1',total_cost_usd:0,usage:{},modelUsage:{},permission_denials:[],user_message_uuids:[last],uuid:'result-'+Date.now()}));
    }
  });
}`);
    ui = startClaudeUI([], executable, terminal, undefined, "es"); await tick();
    for (let i = 0; i < 60 && !terminal.output.includes("test@example.com"); i++) await tick();
    enter("run it"); await tick();
    for (let i = 0; i < 60 && !plain().includes("▎ Sí"); i++) await tick();
    const screen = plain();
    expect(screen).toContain("Buscar el changelog de Engram en este repositorio");
    expect(screen).toContain(`Carpeta: ${process.cwd()}`);
    expect(screen).toContain("rtk grep -rn changelog .");
    expect(screen).toContain("▎ Sí");
    // While the question waits the box says so (it used to say «Trabajando»).
    expect(screen).toContain("Esperando tu respuesta");
    for (const internal of ["\"command\"", "\"description\"", "Permiso solicitado: Bash", "/yes", "/no denegar", "Denegar"]) expect(screen).not.toContain(internal);
    terminal.input("\r");
    for (let i = 0; i < 60 && !existsSync(marker); i++) await tick();
    expect(readFileSync(marker, "utf8")).toBe("allow\n");
    for (let i = 0; i < 60 && !plain().includes(getCatalog("es").chat.statusReady); i++) await tick();
    enter("run it again"); await tick();
    for (let i = 0; i < 60 && !plain().includes(getCatalog("es").chat.awaitingAnswer); i++) await tick();
    await tick();
    terminal.input("\x1b");
    for (let i = 0; i < 60 && readFileSync(marker, "utf8") === "allow\n"; i++) await tick();
    expect(readFileSync(marker, "utf8")).toBe("allow\ndeny\n");
  } finally {
    enter("/f614:quit"); await ui; await tick(); process.chdir(previousCwd); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    if (previousForgeHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousForgeHome;
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
    if (previousClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
  }
});

/**
 * Came out of the real-account test: in a copy under a long path the «Carpeta:» line was broken in the middle of a folder name.
 * The session works in a deep folder of the test's own making, so the screen must show the last folders whole behind «…»
 * (manual 05: long paths are cut with «…») — the same on every machine, whatever the path above it.
 */
test("Claude UI: a long working folder is cut with «…» keeping its last whole folders", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-long-folder-ui-"));
  const executable = testExecutablePath(root);
  const deep = join(root, "a-long-folder-name-for-the-permission-card", "another-long-folder-name-here", "project");
  mkdirSync(deep, { recursive: true });
  const terminal = new TestTerminal(); let ui: Promise<void> | undefined;
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  const plain = () => stripVTControlCharacters(terminal.output);
  const previousForgeHome = process.env.FORGE614_HOME;
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.FORGE614_HOME = join(root, "forge614-home");
  process.env.HOME = join(root, "home");
  process.env.USERPROFILE = join(root, "home");
  process.env.CLAUDE_CONFIG_DIR = join(root, "claude-config");
  const previousCwd = process.cwd();
  process.chdir(deep);
  try {
    await writeTestExecutable(executable, `if(process.argv[2]==='auth') { console.log('{"loggedIn":true,"authMethod":"claude.ai"}'); }
else {
  require('readline').createInterface({input:process.stdin}).on('line',line=>{
    const msg=JSON.parse(line);
    if(msg.type==='control_request') console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,response:{models:[],account:{email:'test@example.com'},commands:[],agents:[],output_style:'default',available_output_styles:[]}}}));
    if(msg.type==='user') console.log(JSON.stringify({type:'control_request',request_id:'permission-'+Date.now(),request:{subtype:'can_use_tool',tool_name:'Bash',input:{command:'ls',description:'List the folder'},tool_use_id:'tool-1'}}));
  });
}`);
    ui = startClaudeUI([], executable, terminal, undefined, "es"); await tick();
    for (let i = 0; i < 60 && !terminal.output.includes("test@example.com"); i++) await tick();
    enter("run it"); await tick();
    for (let i = 0; i < 60 && !plain().includes("▎ Sí"); i++) await tick();
    const expectedCut = process.platform === "win32"
      ? "Carpeta: …\\another-long-folder-name-here\\project"
      : "Carpeta: …/another-long-folder-name-here/project";
    expect(plain()).toContain(expectedCut);
    expect(plain()).not.toContain("a-long-folder-name-for-the-permission-card");
    terminal.input("\x1b");
    await tick();
  } finally {
    enter("/f614:quit"); await tick(); terminal.input("\x1b[B"); terminal.input("\r"); // the turn is still open: «¿Salir de todos modos?» → «Sí»
    await ui; await tick(); process.chdir(previousCwd); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    if (previousForgeHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousForgeHome;
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
    if (previousClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
  }
});

/**
 * The owner's rule: the marked «Yes» is only for the permissions the assistant asks; a question of Shell's own that disconnects goes out with «No» marked and its own
 * words. `/logout` shows «Disconnect Claude Code from this Shell?» with «No, stay connected» marked and «Yes, disconnect»; it never shows the permission card
 * («Permission requested», «Allow?») nor the turn footer. Enter alone and Esc keep the connection; only picking «Yes» disconnects. It exists because the question used to
 * go through the tool-permission path, with «Yes» marked. Runs in English and in Spanish.
 */
test("Claude UI: the /logout question has its own words and «No» marked; Enter alone and Esc keep the connection, only «Yes» disconnects", async () => {
  for (const locale of ["en", "es"] as const) {
    const t = getCatalog(locale);
    const h = await claudeUi([], locale);
    try {
      h.terminal.output = ""; h.enter("/logout"); await tick();
      expect(h.plain()).toContain(t.logout.confirmTitle({ engine: "Claude Code" }));
      expect(h.plain()).toContain(`▎ 1. ${t.logout.stay}`);
      expect(h.plain()).toContain(t.logout.disconnect);
      expect(h.plain()).not.toContain(`▎ 2. ${t.logout.disconnect}`);
      expect(h.plain()).not.toContain(t.chat.permissionRequestedTitle);
      expect(h.plain()).not.toContain(t.permission.question);
      expect(h.plain()).not.toContain("/f614:stop");
      const cancelled = t.claudeChat.logoutCancelled.slice(0, 30); const done = t.claudeChat.disconnectedLocally.slice(0, 40);
      // Enter alone is «No».
      h.terminal.output = ""; h.terminal.input("\r"); await tick();
      expect(h.plain()).toContain(cancelled); expect(h.plain()).not.toContain(done);
      // Esc is «No».
      h.terminal.output = ""; h.enter("/logout"); await tick(); h.terminal.input("\x1b"); await tick();
      expect(h.plain()).toContain(cancelled); expect(h.plain()).not.toContain(done);
      // Picking «Yes» disconnects.
      h.terminal.output = ""; h.enter("/logout"); await tick(); h.terminal.input("\x1b[B"); h.terminal.input("\r");
      for (let i = 0; i < 30 && !h.plain().includes(done); i++) await tick();
      expect(h.plain()).toContain(done);
    } finally { await h.finish(); }
  }
});

/**
 * A Claude Code screen over a fake `claude` that is signed in, reports `commands` as the assistant's own list, never answers a
 * prompt (so a turn stays open until it is stopped) and writes what it receives to a marker file: one `control` line per control
 * request, one `interrupt` line per `interrupt` request, a `closed` line when the process is told to end (its input closes or it is terminated) and, per chat prompt, a `pid:` line (the fake process that got it) and a `prompt:` line. With `rateLimit`, each prompt is also answered with that `rate_limit_event`
 * (the turn still stays open), and with `events`, each prompt is also answered with those messages (an `init`, say). `account` is what the handshake
 * reports. `beforeStart` runs with the `$FORGE614_HOME` of the test before the screen opens (to install a stand-in for Engines, whose startup-hook check runs at
 * opening). No real account or network is involved. `versions` stands in for the reading of the two binaries' `--version` (without it the screen reads none) and `shellVersion` is
 * the version the bar shows. `options.waitFor` is the text the helper waits for before it returns (the account's email by default: it shows once Claude Code has opened and the catalog was read); with `options.answer` each prompt is also ended with a `result` that carries its uuid, so the turn closes by itself (and `events` are what the turn brings before it); `options.sessions` replaces the store `/resume` reads. The fake also reads events a test hands it through `emit` (written to a file it polls) and, for `{ __exit: n }`, ends with that code, like a process that dies. `mcpServers` is what the fake answers to the open query's `mcp_status` request (the SDK's `McpServerStatus` list; none: it answers with no list), and each such request is a
 * line `mcp_status` in the marker file. `finish` leaves the screen and cleans up.
 */
async function claudeUi(commands: { name: string; description: string; argumentHint: string }[] = [], locale: "en" | "es" = "en", rateLimit?: object[], columns = 120, events: object[] = [], account: object = { email: "test@example.com" }, beforeStart?: (forgeHome: string) => void, versions?: () => Promise<EcosystemVersions>, shellVersion?: string, mcpServers?: object[], startupContext?: Parameters<typeof startClaudeUI>[7], options: { waitFor?: string; answer?: boolean; sessions?: Parameters<typeof startClaudeUI>[8] } = {}) {
  const waitFor = options.waitFor ?? "test@example.com";
  const root = await mkdtemp(join(tmpdir(), "forge614-prefix-ui-"));
  const executable = testExecutablePath(root); const marker = join(root, "calls");
  const terminal = new TestTerminal(); terminal.columns = columns;
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  const plain = () => stripVTControlCharacters(terminal.output);
  const previousForgeHome = process.env.FORGE614_HOME;
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.FORGE614_HOME = join(root, "forge614-home");
  process.env.HOME = join(root, "home");
  process.env.USERPROFILE = join(root, "home");
  process.env.CLAUDE_CONFIG_DIR = join(root, "claude-config");
  beforeStart?.(process.env.FORGE614_HOME);
  await writeTestExecutable(executable, `const fs=require('fs'); const open=[];
let closedWritten=false;
const markClosed=()=>{ if(!closedWritten){ closedWritten=true; fs.appendFileSync(${JSON.stringify(marker)},'closed\\n'); } };
if(process.argv[2]==='auth') { console.log('{"loggedIn":true,"authMethod":"claude.ai"}'); }
else {
  const inbox=${JSON.stringify(marker + ".inbox")};
  setInterval(()=>{ try { if(!fs.existsSync(inbox)) return; const text=fs.readFileSync(inbox,'utf8'); fs.unlinkSync(inbox); for(const l of text.split('\\n').filter(Boolean)) { const e=JSON.parse(l); if(e.__exit!==undefined) process.exit(e.__exit); console.log(l); } } catch {} },15);
  process.on('SIGTERM',()=>{ markClosed(); process.exit(0); });
  const rl=require('readline').createInterface({input:process.stdin}); rl.on('close',()=>markClosed());
  rl.on('line',line=>{
    const msg=JSON.parse(line);
    if(msg.type==='control_request' && msg.request.subtype==='interrupt') { fs.appendFileSync(${JSON.stringify(marker)},'interrupt\\n'); console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,response:{still_queued:[]}}})); const uuids=open.splice(0); if(uuids.length) console.log(JSON.stringify({type:'result',subtype:'error_during_execution',is_error:true,duration_ms:1,duration_api_ms:1,num_turns:1,errors:[],session_id:'s1',total_cost_usd:0,usage:{},modelUsage:{},permission_denials:[],user_message_uuids:uuids,uuid:'result-'+Date.now()})); }
    else if(msg.type==='control_request' && msg.request.subtype==='mcp_status') { fs.appendFileSync(${JSON.stringify(marker)},'mcp_status\\n'); console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,response:{mcpServers:${JSON.stringify(mcpServers)}}}})); }
    else if(msg.type==='control_request') { fs.appendFileSync(${JSON.stringify(marker)},'control\\n'); console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,response:{models:[],account:${JSON.stringify(account)},commands:${JSON.stringify(commands)},agents:[],output_style:'default',available_output_styles:[]}}})); }
    if(msg.type==='user') { open.push(msg.uuid); fs.appendFileSync(${JSON.stringify(marker)},'pid:'+process.pid+'\\n'+'prompt:'+JSON.stringify(msg.message.content)+'\\n'); for (const info of ${JSON.stringify(rateLimit ?? [])}) console.log(JSON.stringify({type:'rate_limit_event',rate_limit_info:info,uuid:'00000000-0000-4000-8000-000000000001',session_id:'s'})); for (const event of ${JSON.stringify(events)}) console.log(JSON.stringify(event)); if (${JSON.stringify(Boolean(options.answer))}) open.splice(open.indexOf(msg.uuid),1); if (${JSON.stringify(Boolean(options.answer))}) console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,duration_ms:1,duration_api_ms:1,num_turns:1,result:'ok',session_id:'s1',total_cost_usd:0,usage:{},modelUsage:{},permission_denials:[],user_message_uuids:[msg.uuid],uuid:'result-'+Date.now()})); }
  });
}`);
  const ui = startClaudeUI([], executable, terminal, shellVersion, locale, undefined, versions, startupContext, options.sessions);
  await tick();
  for (let i = 0; i < 120 && !terminal.output.includes(waitFor); i++) await tick();
  const calls = () => existsSync(marker) ? readFileSync(marker, "utf8").split("\n").filter(Boolean) : [];
  /**
   * Leaves through `/f614:quit`, or, with `byCtrlC`, through Esc and Ctrl+C (for a test that leaves text in the box), and puts the environment back.
   * When a turn is still open the screen asks «Quit anyway?», and with background tasks running it asks to cut them: this cleanup answers «Yes» to either, so a test that leaves work running can still end.
   */
  const finish = async (byCtrlC = false) => {
    terminal.output = "";
    if (byCtrlC) { terminal.input("\x1b"); terminal.input("\x03"); } else enter("/f614:quit");
    await tick();
    if (plain().includes("▎ No") || plain().includes("▎ 1. No")) { terminal.input("\x1b[B"); terminal.input("\r"); }
    await ui; await tick(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    if (previousForgeHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousForgeHome;
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
    if (previousClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
  };
  /** Hands events to the fake `claude`, which writes them out of turn (no message of the person asked for them). */
  const emit = (...events: object[]) => { writeFileSync(`${marker}.inbox.tmp`, events.map(event => JSON.stringify(event)).join("\n") + "\n"); renameSync(`${marker}.inbox.tmp`, `${marker}.inbox`); };
  return { terminal, enter, plain, ui, calls, finish, emit };
}


/** Claude's opening transcript owns the sign too: it vanishes after the first person message and never returns after `/new`. */
test("a new Claude chat removes the FORGE614 sign after its first person message and never restores it on new", async () => {
  const h = await claudeUi();
  try {
    expect(h.plain()).toContain("████████");
    h.terminal.output = ""; h.enter("first message"); await tick();
    expect(h.plain()).not.toContain("████████");
    h.terminal.output = ""; h.enter("/new"); await tick();
    expect(h.plain()).not.toContain("████████");
  } finally { await h.finish(); }
});

/**
 * A native Claude Code command that is sent as a turn (`/init` here, one of the assistant's own commands) is the first turn of the chat, exactly like a normal message,
 * so it removes the opening sign and the sign does not come back. Before this only a normal message removed it and the sign stayed on top of the command and its answer.
 */
test("a native Claude command sent as a turn removes the FORGE614 sign and it does not come back", async () => {
  const h = await claudeUi([{ name: "init", description: "Initialize", argumentHint: "" }]);
  try {
    expect(h.plain()).toContain("████████");
    h.enter("/init");
    // The turn reaches the fake `claude` process through its stdin, and the process writes what it received to a file: wait for that line, not for a fixed moment, which a loaded machine overruns.
    const sentInit = () => h.calls().some(line => line.startsWith("prompt:") && line.includes("/init"));
    for (let i = 0; i < 60 && !sentInit(); i++) await tick();
    expect(sentInit()).toBe(true);
    // A resize makes the next frame draw every row, so the sign would show up in the output if it were still in the chat.
    h.terminal.columns = 121; h.terminal.output = ""; h.terminal.resize(); await tick();
    expect(h.plain()).toContain("/init");
    expect(h.plain()).not.toContain("████████");
    h.enter("/f614:stop"); await tick(); await tick();
    h.terminal.columns = 120; h.terminal.output = ""; h.terminal.resize(); await tick();
    expect(h.plain()).not.toContain("████████");
  } finally { await h.finish(); }
});

/**
 * Node prints every `process.emitWarning` raw on stderr, which lands on top of the screen Shell draws: the Claude SDK raises `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`
 * («canUseTool will not be invoked») when a query opens in «Bypass Permissions» with `canUseTool` set, and it cut across the writing box on the first message. Shell passes
 * `canUseTool` on purpose (so the mode can leave «Bypass Permissions» live), so that warning is expected and says nothing; any other warning shows once in the chat as a muted
 * line with the catalog's prefix and without «(node:<pid>)»; nothing reaches stderr while the screen is open. Both languages, with the exact words of each.
 */
test("while the Claude screen is open Node warnings do not reach stderr: the expected one is silent, another shows once in the chat", async () => {
  for (const [locale, shown] of [["en", "Node warning: Something odd happened"], ["es", "Aviso de Node: Something odd happened"]] as const) {
    const h = await claudeUi([], locale); const stderr: string[] = []; const realWrite = process.stderr.write;
    try {
      process.stderr.write = ((chunk: string | Uint8Array) => { stderr.push(String(chunk)); return true; }) as typeof process.stderr.write;
      h.terminal.output = "";
      process.emitWarning("canUseTool will not be invoked: permissionMode 'bypassPermissions' auto-approves every tool call", { code: "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED" });
      await tick(); await tick();
      expect(h.plain()).not.toContain("canUseTool");
      expect(h.plain()).not.toContain("Node warning"); expect(h.plain()).not.toContain("Aviso de Node");
      expect(stderr).toEqual([]);
      process.emitWarning("Something odd happened", { code: "SOME_OTHER_WARNING" });
      await tick(); await tick();
      expect(h.plain().split(shown)).toHaveLength(2);
      expect(h.plain()).not.toContain("(node:");
      expect(stderr).toEqual([]);
    } finally { process.stderr.write = realWrite; await h.finish(); }
  }
});

/**
 * Shell only borrows the process's `warning` listeners while its screen is open: Node's own printer (the listener named `onWarning`) is taken out while it is open
 * and, on leaving, the listeners are exactly the ones there were before opening (same number, same functions, same order), with nothing of Shell's left hanging.
 */
test("the Claude screen takes Node's warning printer while it is open and gives back the very same warning listeners on leaving", async () => {
  const before = process.listeners("warning");
  expect(before.some(listener => listener.name === "onWarning")).toBe(true);
  const h = await claudeUi();
  try {
    expect(process.listeners("warning").some(listener => listener.name === "onWarning")).toBe(false);
    expect(process.listenerCount("warning")).toBe(before.length);
  } finally { await h.finish(); }
  const after = process.listeners("warning");
  expect(after).toHaveLength(before.length);
  for (const [index, listener] of before.entries()) expect(after[index]).toBe(listener);
});

/**
 * Every Shell command with Claude Code answers to `/f614:<name>` and does what its unprefixed name did before 1.12.0:
 * `/f614:status` is Shell's own session telemetry (it used to be `/status` and `/forge614-status`), `/f614:refresh` asks
 * Claude Code for the plan usage again, `/f614:help` and `/f614:commands` open Shell's command menu, and `/f614:yes` and
 * `/f614:no` answer a pending permission (here none is pending, so they say so).
 */
test("Claude UI: each Shell command answers to /f614:<name> and does what the old name did", async () => {
  const h = await claudeUi();
  try {
    h.terminal.output = ""; h.enter("/f614:status"); await tick();
    expect(h.plain()).toContain(telemetryLines(emptyTelemetry(), "en")[0]!);
    const before = h.calls().filter(line => line === "control").length;
    h.enter("/f614:refresh"); await tick(); await tick();
    expect(h.calls().filter(line => line === "control").length).toBeGreaterThan(before);
    for (const name of ["/f614:help", "/f614:commands"]) {
      h.terminal.output = ""; h.enter(name); await tick();
      expect(h.plain(), name).toContain("Commands · 1–5 of");
      h.terminal.input("\x1b"); await tick();
    }
    for (const name of ["/f614:yes", "/f614:no"]) {
      h.terminal.output = ""; h.enter(name); await tick();
      expect(h.plain(), name).toContain(getCatalog("en").chat.noPermissionPending);
    }
    expect(h.calls().filter(line => line.startsWith("prompt:"))).toEqual([]); // none of them became a chat turn
  } finally { await h.finish(); }
});

/**
 * With Claude Code a slash command without prefix is Claude Code's or nothing: the names Shell used to answer
 * (`/refresh`, `/yes`, `/no`, `/commands`, `/forge614-status`, `/quit!`, `/exit!`) and `/thinking` (Claude Code has `/effort`
 * only) are unknown commands, and none of them becomes a chat prompt. It exists so that no silent alias survives the move.
 */
test("Claude UI: the old unprefixed Shell names are unknown commands and send nothing", async () => {
  const h = await claudeUi();
  try {
    for (const name of ["/refresh", "/yes", "/no", "/commands", "/forge614-status", "/quit!", "/exit!", "/thinking"]) {
      h.terminal.output = ""; h.enter(name); await tick();
      expect(h.plain(), name).toContain(getCatalog("en").chat.unknownCommand({ name }));
    }
    expect(h.calls().filter(line => line.startsWith("prompt:"))).toEqual([]);
  } finally { await h.finish(); }
});

/**
 * `/status` and `/help` are Claude Code's own commands (Shell's telemetry is `/f614:status`, Shell's menu `/f614:help`) and Shell answers them with what it has:
 * they used to say «Claude Code doesn't allow /x from Shell yet». Neither is unknown, neither is sent to the model as a chat prompt, and when Claude Code itself
 * reports one of them in its command list, it is forwarded as Claude Code's own instead.
 */
test("Claude UI: /status and /help answer with what Shell has, send nothing, and are forwarded when Claude Code lists them", async () => {
  const bare = await claudeUi();
  try {
    for (const name of ["/status", "/help"]) {
      bare.terminal.output = ""; bare.enter(name); await tick();
      expect(bare.plain(), name).not.toContain("doesn't allow");
      expect(bare.plain(), name).not.toContain(getCatalog("en").chat.unknownCommand({ name }));
    }
    expect(bare.calls().filter(line => line.startsWith("prompt:"))).toEqual([]);
  } finally { await bare.finish(); }
  const listed = await claudeUi([{ name: "status", description: "Show status", argumentHint: "" }]);
  try {
    listed.enter("/status");
    for (let i = 0; i < 30 && !listed.calls().some(line => line.startsWith("prompt:")); i++) await tick();
    expect(listed.calls().filter(line => line.startsWith("prompt:"))).toEqual(["prompt:\"/status\""]);
  } finally { await listed.finish(); }
});

/**
 * Before any message Claude Code's `/status` in Shell shows what Shell has without a turn: the folder, the account of the handshake, the permission mode, the memory
 * and the setting sources — and says that version, session and MCP servers appear after the first message. Spanish and English; the lines are Claude Code's Status panel's.
 */
test("Claude UI: /status before any message shows the account, folder and mode, and says what appears later", async () => {
  for (const locale of ["en", "es"] as const) {
    const h = await claudeUi([], locale, undefined, 200, [], { email: "test@example.com", organization: "Acme", subscriptionType: "max", apiProvider: "firstParty" });
    try {
      h.terminal.output = ""; h.enter("/status");
      const t = getCatalog(locale).claudePanels;
      for (let i = 0; i < 60 && !h.plain().includes(t.statusTitle); i++) await tick();
      const shown = h.plain();
      for (const line of [t.statusTitle, `${t.labelFolder}: ${process.cwd()}`, `${t.labelEmail}: test@example.com`, `${t.labelOrganization}: Acme`, `${t.labelPlan}: max`,
        `${t.labelPermissionMode}: Manual`, `${t.labelSettingSources}: ${locale === "en" ? "user, project, local" : "usuario, proyecto, local"}`, t.statusAfterFirstMessage]) expect(shown).toContain(line);
      for (const label of [t.labelVersion, t.labelSession, t.labelMcpServers]) expect(shown).not.toContain(`${label}:`);
      expect(shown).not.toMatch(/undefined|desconocid/);
      expect(h.calls().filter(line => line.startsWith("prompt:"))).toEqual([]);
    } finally { await h.finish(); }
  }
});

/**
 * After a turn has started, the SDK's `init` message gives Shell the Claude Code version, the session, where the API key comes from and the MCP servers with their
 * state; `/status` shows them — also while the turn is still open, as Claude Code's own does. The exact values come from the stand-in's message.
 */
test("Claude UI: /status shows the version, session, API key and MCP servers from the init message, also mid-turn", async () => {
  const init = { type: "system", subtype: "init", session_id: "s-status-1", claude_code_version: "2.1.274", apiKeySource: "none", model: "claude-test", permissionMode: "default", cwd: process.cwd(),
    mcp_servers: [{ name: "forge614-engram", status: "connected", source: "user" }, { name: "github", status: "failed", source: "project" }], slash_commands: [], tools: [], output_style: "default", skills: [], plugins: [],
    uuid: "00000000-0000-4000-8000-000000000002" };
  const h = await claudeUi([], "en", undefined, 200, [init]);
  try {
    h.enter("go"); await tick();
    for (let i = 0; i < 60 && !h.plain().includes(getCatalog("en").chat.statusWorking); i++) await tick();
    for (let i = 0; i < 60 && !h.plain().includes("s-status-1"); i++) await tick();
    h.terminal.output = ""; h.enter("/status");
    for (let i = 0; i < 60 && !h.plain().includes("MCP servers:"); i++) await tick();
    const shown = h.plain();
    for (const line of ["Claude Code status", "Version: 2.1.274", "Session: s-status-1", `Folder: ${process.cwd()}`, "Email: test@example.com", "API key: none in use", "Permission mode: Manual",
      "MCP servers:", "Connected: forge614-engram", "Failed: github"]) expect(shown).toContain(line);
    expect(shown).not.toContain(getCatalog("en").claudePanels.statusAfterFirstMessage);
  } finally { await h.finish(); }
});

/**
 * After a confirmed `/logout` the account is gone from the session, so `/status` no longer shows the email, the organization or the plan of the account that was
 * disconnected (it kept them, because `reset()` only forgot the conversation). It still answers, with the folder and the mode.
 */
test("Claude UI: /status after a confirmed /logout shows no account data", async () => {
  const h = await claudeUi([], "en", undefined, 200, [], { email: "test@example.com", organization: "Acme", subscriptionType: "max", apiProvider: "firstParty" });
  try {
    const t = getCatalog("en").claudePanels;
    h.enter("/logout"); await tick();
    h.terminal.input("\x1b[B"); h.terminal.input("\r");
    const confirmed = getCatalog("en").claudeChat.disconnectedLocally.slice(0, 40);
    for (let i = 0; i < 30 && !h.plain().includes(confirmed); i++) await tick();
    h.terminal.output = ""; h.enter("/status");
    for (let i = 0; i < 60 && !h.plain().includes(t.statusTitle); i++) await tick();
    const shown = h.plain();
    expect(shown).toContain(`${t.labelFolder}: ${process.cwd()}`);
    for (const label of [t.labelEmail, t.labelOrganization, t.labelPlan]) expect(shown).not.toContain(`${label}:`);
    expect(shown).not.toContain("test@example.com");
    expect(shown).not.toContain("Acme");
  } finally { await h.finish(); }
});

/**
 * `/new` forgets what the newest turn's `init` message reported, as it forgets the session: `/status` shows no Version and no MCP servers until the first message
 * of the new conversation brings them again (it kept the previous turn's). The values are the stand-in's own.
 */
test("Claude UI: /status after /new drops the version and MCP servers until the first message", async () => {
  const init = { type: "system", subtype: "init", session_id: "s-new-1", claude_code_version: "2.1.274", apiKeySource: "none", model: "claude-test", permissionMode: "default", cwd: process.cwd(),
    mcp_servers: [{ name: "forge614-engram", status: "connected", source: "user" }], slash_commands: [], tools: [], output_style: "default", skills: [], plugins: [],
    uuid: "00000000-0000-4000-8000-000000000003" };
  const h = await claudeUi([], "en", undefined, 200, [init]);
  try {
    h.enter("go");
    for (let i = 0; i < 60 && !h.plain().includes("s-new-1"); i++) await tick();
    h.enter("/status");
    for (let i = 0; i < 60 && !h.plain().includes("Version: 2.1.274"); i++) await tick();
    expect(h.plain()).toContain("MCP servers:");
    expect(h.plain()).toContain("Connected: forge614-engram");
    h.enter("/f614:stop"); await tick(); await tick(); await tick();
    h.enter("/new"); await tick(); await tick();
    h.terminal.output = ""; h.enter("/status");
    const t = getCatalog("en").claudePanels;
    for (let i = 0; i < 60 && !h.plain().includes(t.statusTitle); i++) await tick();
    const shown = h.plain();
    expect(shown).toContain(t.statusAfterFirstMessage);
    for (const label of [t.labelVersion, t.labelSession, t.labelMcpServers]) expect(shown).not.toContain(`${label}:`);
    expect(shown).not.toContain("2.1.274");
    // The first message of the new conversation brings them back.
    h.enter("again");
    for (let i = 0; i < 60 && !h.calls().filter(line => line.startsWith("prompt:")).length; i++) await tick();
    await tick(); await tick();
    h.terminal.output = ""; h.enter("/status");
    for (let i = 0; i < 60 && !h.plain().includes("MCP servers:"); i++) await tick();
    expect(h.plain()).toContain("Version: 2.1.274");
  } finally { await h.finish(); }
}, 30_000);

/**
 * `/help` lists the commands of the `/` menu with their description — Claude Code's own (from its list), the ones Shell carries out with Claude Code's meaning
 * (`/status` and `/help` among them now) — and the shortcuts Shell respects. It sends nothing to the model.
 */
test("Claude UI: /help lists the menu's commands with their description and the shortcuts, in both languages", async () => {
  const commands = [{ name: "compact", description: "Clear conversation history but keep a summary in context", argumentHint: "<instructions>" }];
  for (const locale of ["en", "es"] as const) {
    const h = await claudeUi(commands, locale, undefined, 200);
    try {
      h.terminal.output = ""; h.enter("/help");
      const t = getCatalog(locale).claudePanels; const c = getCatalog(locale).chat;
      for (let i = 0; i < 60 && !h.plain().includes(t.helpShortcuts); i++) await tick();
      const shown = h.plain();
      for (const line of [t.helpTitle, t.helpCommands, "/compact  Clear conversation history but keep a summary in context", `/status   ${c.commandShowStatus}`, `/help     ${c.commandShowHelp}`,
        `/model    ${c.commandSelectModel}`, t.helpShellCommands, t.helpShortcuts, `Shift+Tab      ${t.keyCycleModes}`]) expect(shown).toContain(line);
      expect(shown).not.toContain("Ctrl+R");
      expect(h.calls().filter(line => line.startsWith("prompt:"))).toEqual([]);
    } finally { await h.finish(); }
  }
});

/**
 * On a narrow screen `/help` keeps the rest of a long description under its own column instead of dropping it flush left («and MCP servers» used to break the columns),
 * and `/status` shows the MCP servers one group per line, the long group continuing under its first name. It runs the real screen at 60 columns, so the width the panels
 * are wrapped to is the width the chat has, not a guess.
 */
test("Claude UI: /help and /status wrap to the real width, under their own columns", async () => {
  const commands = [{ name: "compact", description: "Clear conversation history but keep a summary in context", argumentHint: "" }];
  const names = Array.from({ length: 12 }, (_, index) => `server-${String(index + 1).padStart(2, "0")}`);
  const init = { type: "system", subtype: "init", session_id: "s-wrap-1", claude_code_version: "2.1.274", apiKeySource: "none", model: "claude-test", permissionMode: "default", cwd: process.cwd(),
    mcp_servers: names.map(name => ({ name, status: "connected", source: "user" })), slash_commands: [], tools: [], output_style: "default", skills: [], plugins: [],
    uuid: "00000000-0000-4000-8000-000000000003" };
  const h = await claudeUi(commands, "en", undefined, 60, [init]);
  try {
    // The screen's text has no line breaks (rows come one after another, padded), so a row that continues shows as a wide run of spaces — the margin and the indent —
    // between its last word and the first of the next row; a flush-left break would leave a run too short to hold the column, and an unbroken row leaves one space.
    h.terminal.output = ""; h.enter("/help");
    for (let i = 0; i < 60 && !h.plain().includes("Shortcuts:"); i++) await tick();
    expect(h.plain()).toMatch(/\/compact  Clear conversation history but keep a summary {12,}in context/);
    expect(h.plain()).not.toContain("keep a summary in context");
    h.enter("go"); await tick();
    for (let i = 0; i < 60 && !h.plain().includes("s-wrap-1"); i++) await tick();
    h.terminal.output = ""; h.enter("/status");
    for (let i = 0; i < 60 && !h.plain().includes("MCP servers:"); i++) await tick();
    expect(h.plain()).toContain("Connected: server-01, server-02");
    expect(h.plain()).toMatch(/server-\d\d, {15,}server-\d\d/);
    expect(h.plain()).not.toContain("server-01, server-02, server-03, server-04, server-05, server-06");
  } finally { await h.finish(); }
}, 30_000);

/**
 * The `/` menu's Claude Code group and `/help` are made by one function, so they cannot disagree. It lists the commands Claude Code reports first, then the ones Shell
 * carries out with Claude Code's meaning (`/status` and `/help` included, with Claude Code's descriptions), and never one twice when Claude Code lists it as well.
 */
test("the menu's Claude Code commands come from one function: Claude Code's own first, then Shell's, none twice", () => {
  const c = getCatalog("en").chat;
  const rows = claudeMenuCommands([{ name: "status", description: "Its own status", argumentHint: "" }, { name: "compact", description: "Compact", argumentHint: "" }], c);
  expect(rows.map(row => row.value)).toEqual(["/status", "/compact", "/model", "/effort", "/resume", "/new", "/login", "/logout", "/exit", "/help"]);
  expect(rows.find(row => row.value === "/status")!.label).toBe("Its own status");
  expect(rows.at(-1)).toEqual({ value: "/help", label: "Show help and available commands" });
  expect(claudeMenuCommands([], c).find(row => row.value === "/status")!.label).toBe(c.commandShowStatus);
  expect(claudeMenuCommands([{ name: "x", description: "", argumentHint: "<file>" }], c)[0]).toEqual({ value: "/x", label: "<file>" });
});

/**
 * `/exit` and its alias `/quit` are Claude Code's own: they leave when idle and refuse while a turn runs, naming `/f614:quit`,
 * which asks before stopping anything. The old `/quit!` is gone (see the unknown-names test).
 */
test("Claude UI: /exit and /quit refuse while a turn runs and name /f614:quit, which asks first", async () => {
  const h = await claudeUi();
  h.enter("work please"); await tick();
  for (let i = 0; i < 30 && !h.plain().includes(getCatalog("en").chat.statusWorking); i++) await tick();
  const refusal = "Work or authentication is active. Use /f614:quit to leave: it asks before stopping anything. Nothing was stopped.";
  expect(getCatalog("en").claudeChat.workOrAuthActive).toBe(refusal);
  for (const send of [() => h.enter("/exit"), () => h.enter("/quit")]) {
    h.terminal.output = ""; send(); await tick();
    expect(h.plain()).toContain("Nothing was stopped");
  }
  let left = false; void h.ui.then(() => { left = true; });
  await tick(); expect(left).toBe(false);
  await h.finish();
  expect(left).toBe(true);
});

/**
 * `/f614:quit` is Shell's way out with any assistant (owner, 2026-09-29: «ese quit debería ser para todos»), and Ctrl+C and Ctrl+D
 * do the same. Idle they leave at once; while a turn runs they ask «Quit anyway? What is running will be stopped.» with «No»
 * marked (stopping work cannot be undone), so Enter and Esc keep everything and only «Yes» stops and leaves. It exists because
 * the real-account test of 1.12.0 showed that with Claude Code the owner typed `/quit`, which its menu does not list, and could not
 * see what leaving did. The `/` menu offers `/f614:quit` under FORGE614 with Claude Code.
 */
test("Claude UI: /f614:quit, Ctrl+C and Ctrl+D leave when idle and ask first while a turn runs, with No marked", async () => {
  const question = { en: "Quit anyway? What is running will be stopped.", es: "¿Salir de todos modos? Se detendrá lo que está en curso." };
  const words = { en: { yes: "Yes", no: "No", yesKey: "y" }, es: { yes: "Sí", no: "No", yesKey: "s" } };
  const ways: [string, string[]][] = [["/f614:quit", ["/f614:quit", "\r"]], ["Ctrl+C", ["\x03"]], ["Ctrl+D", ["\x04"]]];
  for (const locale of ["en", "es"] as const) {
    const menu = await claudeUi([], locale);
    try {
      menu.terminal.output = ""; menu.terminal.input("/f614:q"); await tick();
      expect(menu.plain(), locale).toContain("FORGE614 ");
      expect(menu.plain(), locale).toContain("/f614:quit");
      expect(menu.plain(), locale).toContain(locale === "en" ? "Exit Shell" : "Salir de Shell");
    } finally { await menu.finish(true); }
    for (const [way, keys] of ways) {
      const name = `${locale} ${way}`;
      // Idle: it leaves at once and never asks.
      const idle = await claudeUi([], locale);
      idle.terminal.output = ""; for (const key of keys) idle.terminal.input(key); await idle.ui;
      expect(idle.plain(), name).not.toContain(question[locale]);
      await idle.finish(true);
      // While a turn runs: it asks, with «No» marked.
      const busy = await claudeUi([], locale);
      let left = false; void busy.ui.then(() => { left = true; });
      busy.enter("work please");
      for (let i = 0; i < 30 && !busy.calls().some(line => line.startsWith("prompt:")); i++) await tick();
      busy.terminal.output = ""; for (const key of keys) busy.terminal.input(key); await tick();
      expect(busy.plain(), name).toContain(question[locale]);
      expect(busy.plain(), name).toContain(`▎ ${words[locale].no}`);
      expect(busy.plain(), name).not.toContain(`▎ ${words[locale].yes}`);
      // Enter takes the marked «No»: nothing is stopped.
      busy.terminal.input("\r"); await tick();
      expect(left, name).toBe(false);
      // Esc is «No» too.
      for (const key of keys) busy.terminal.input(key); await tick();
      busy.terminal.input("\x1b"); await tick();
      expect(left, name).toBe(false);
      // «Yes» (the arrow, then Enter; the row's first letter works too) stops the turn and leaves.
      for (const key of keys) busy.terminal.input(key); await tick();
      busy.terminal.input(way === "Ctrl+D" ? words[locale].yesKey : "\x1b[B"); if (way !== "Ctrl+D") busy.terminal.input("\r");
      await busy.ui;
      expect(left, name).toBe(true);
      await busy.finish(true);
    }
  }
}, 90_000);

/**
 * `/f614:status` with Claude Code names the limits like the sidebar and says their status in plain words, with the reset in local
 * time, in es and en; no provider key («five_hour», «seven_day», «allowed») and no machine date. It exists because the real-account
 * test of 1.12.0 showed «five_hour (último reporte): no reportado | allowed | se reinicia: …» to the owner. The fake `claude` answers the
 * prompt with two rate-limit events, so the screen shows real reported values, not only the «not reported» defaults.
 */
test("Claude UI: /f614:status shows plain limit names, a translated status and a readable reset, in es and en", async () => {
  const reset = Math.floor(new Date(2026, 9, 3, 17, 22, 0).getTime() / 1000);
  const events = [
    { status: "allowed", rateLimitType: "five_hour", utilization: 0.31, resetsAt: reset },
    { status: "allowed_warning", rateLimitType: "seven_day", utilization: 0.9, resetsAt: reset },
  ];
  const expected = {
    en: ["5-hour limit (last report): 31% used | allowed | resets Oct 3, 5:22 PM", "Weekly limit (last report): 90% used | allowed, near the limit | resets Oct 3, 5:22 PM"],
    es: ["Límite de 5 horas (último reporte): 31% usado | permitido | se reinicia el 3 oct, 5:22 p.m.", "Límite semanal (último reporte): 90% usado | permitido, cerca del límite | se reinicia el 3 oct, 5:22 p.m."],
  };
  for (const locale of ["en", "es"] as const) {
    const h = await claudeUi([], locale, events, 220);
    try {
      h.enter("work please");
      for (let i = 0; i < 30 && !h.calls().some(line => line.startsWith("prompt:")); i++) await tick();
      await tick(); await tick();
      h.terminal.output = ""; h.enter("/f614:status"); await tick(); await tick();
      for (const line of expected[locale]) expect(h.plain().replace(/\s*\n\s*/g, " "), `${locale} ${line}`).toContain(line);
      expect(h.plain(), locale).not.toMatch(/five_hour|seven_day|allowed_warning|\d{4}-\d{2}-\d{2}T/);
      if (locale === "es") expect(h.plain()).not.toContain("allowed");
    } finally { await h.finish(); }
  }
}, 30_000);

/**
 * The `/` menu with Claude Code: what Claude Code has goes under CLAUDE CODE with no Shell name in it (its own `/login`,
 * `/logout`, `/effort`, `/exit`, `/resume` stay as they are), and the FORGE614 group has only `/f614:` commands. It exists so
 * the menu keeps telling apart the assistant's commands from Shell's after the prefix.
 */
test("Claude UI: the / menu keeps the assistant's own names and lists only /f614: commands under FORGE614", async () => {
  const h = await claudeUi();
  try {
    h.terminal.output = ""; h.terminal.input("/f614:"); await tick();
    for (const name of ["/f614:refresh", "/f614:status", "/f614:commands", "/f614:stop", "/f614:quit"]) expect(h.plain(), name).toContain(name);
    expect(h.plain()).toContain("FORGE614 ");
  } finally { await h.finish(true); }
  for (const [typed, shown, hidden] of [
    ["/lo", ["/login", "/logout"], ["/f614:login"]], ["/e", ["/effort", "/exit"], ["/f614:effort"]], ["/re", ["/resume"], ["/refresh"]],
    ["/th", [], ["/thinking"]], ["/c", [], ["/commands"]], ["/q", [], ["/quit!"]],
  ] as [string, string[], string[]][]) {
    const other = await claudeUi();
    try {
      other.terminal.output = ""; other.terminal.input(typed); await tick();
      for (const text of shown) expect(other.plain(), typed).toContain(text);
      for (const text of hidden) expect(other.plain(), typed).not.toContain(text);
    } finally { await other.finish(true); }
  }
});

/**
 * `/f614:status` says where the memory comes from, so the person can check it without asking the model (the memory used to arrive twice: measured with a
 * real account on 2026-09-29, build of 067e348). Through the real composition root: with no Engines under `$FORGE614_HOME` Shell cannot know that the
 * startup hook delivers, so it says «Shell pastes it»; with an Engines that reports the hook active, it says the assistant delivers it (the exact words in both languages are checked in `memory-source.test.ts`).
 * The check runs when the session opens (not at the first message), once for the whole run: an Engines installed after opening is not noticed until the next run.
 */
test("Claude UI: /f614:status says who delivers the memory, from the one detection of the run", async () => {
  const h = await claudeUi();
  try {
    h.terminal.output = ""; h.enter("/f614:status"); await tick(); await tick();
    expect(h.plain()).toContain("Memory: Shell pastes it");
    expect(h.plain()).not.toContain("delivers it at startup");
  } finally { await h.finish(); }
  const verification = { agentId: "claude-code", mcp: { path: "/x", present: true }, instructions: { supported: true, paths: [], present: true }, hook: { supported: true, path: "/x", present: true, dryRunOk: true, runtimeStatus: { kind: "runtime-observed" } }, overallStatus: "complete" };
  const installEngines = (forgeHome: string) => {
    const bin = join(forgeHome, "engines", "bin"); mkdirSync(bin, { recursive: true });
    writeTestExecutableSync(join(bin, "forge614-engines"), `console.log(JSON.stringify({schemaVersion:1,verification:${JSON.stringify(verification)}}));\n`);
  };
  const late = await claudeUi();
  try {
    installEngines(process.env.FORGE614_HOME!);
    late.terminal.output = ""; late.enter("/f614:status"); await tick(); await tick();
    expect(late.plain()).toContain("Memory: Shell pastes it");
  } finally { await late.finish(); }
  const second = await claudeUi([], "en", undefined, 120, [], { email: "test@example.com" }, installEngines);
  try {
    second.terminal.output = ""; second.enter("/f614:status");
    for (let i = 0; i < 60 && !second.plain().includes("Memory: "); i++) await tick();
    expect(second.plain()).toContain("Memory: the assistant delivers it at startup");
    expect(second.plain()).not.toContain("Shell pastes it");
  } finally { await second.finish(); }
});

/**
 * The sidebar on the Claude Code screen, with real SGR mouse sequences and a fake `claude`: the width saved in Shell's preferences (50) is what the screen opens with (the grip is at
 * columns 68–69 of 120, so the resize pointer is asked for there), clicking «hide ›» in the sidebar's first row hides it and saves `sidebarHidden`, and the header then offers «‹ show sidebar».
 */
test("Claude UI opens with the saved sidebar width and hides it with the hide button, saving the choice", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-sidebar-ui-"));
  const executable = testExecutablePath(root);
  const terminal = new TestTerminal(); let ui: Promise<void> | undefined;
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  const previousForgeHome = process.env.FORGE614_HOME;
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.FORGE614_HOME = join(root, "forge614-home");
  process.env.HOME = join(root, "home");
  process.env.USERPROFILE = join(root, "home");
  process.env.CLAUDE_CONFIG_DIR = join(root, "claude-config");
  const preferences = () => JSON.parse(readFileSync(join(root, "forge614-home", "shell", "preferences.json"), "utf8"));
  try {
    mkdirSync(join(root, "forge614-home", "shell"), { recursive: true });
    writeFileSync(join(root, "forge614-home", "shell", "preferences.json"), JSON.stringify({ sidebarWidth: 50 }));
    await writeTestExecutable(executable, `if(process.argv[2]==='auth') { console.log('{"loggedIn":true,"authMethod":"claude.ai"}'); }
else { require('readline').createInterface({input:process.stdin}).on('line',line=>{ const msg=JSON.parse(line); if(msg.type==='control_request') console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,response:{models:[],account:{email:'test@example.com'},commands:[],agents:[],output_style:'default',available_output_styles:[]}}})); }); }`);
    ui = startClaudeUI([], executable, terminal); await tick();
    for (let i = 0; i < 60 && !terminal.output.includes("Connected"); i++) await tick();
    const ew = "\x1b]22;ew-resize\x07";
    terminal.input("\x1b[<35;70;26M"); await tick(); // column 69 of the 50-wide layout's grip (68–69), middle row 25
    expect(terminal.output).toContain(ew);
    terminal.input("\x1b[<35;10;10M"); await tick();
    terminal.output = "";
    terminal.input("\x1b[<0;115;1M"); terminal.input("\x1b[<0;115;1m"); await tick(); // the «hide ›» button: columns 112–117 of the first row
    expect(preferences()).toMatchObject({ sidebarWidth: 50, sidebarHidden: true });
    expect(stripVTControlCharacters(terminal.output)).toContain(getCatalog("en").sidebarControls.show);
  } finally {
    enter("/f614:quit"); await ui; await tick(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    if (previousForgeHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousForgeHome;
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
    if (previousClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
  }
});

/** The screen as the terminal shows it now, without escape codes: for each row, what the screen last wrote to it (`ESC[row;1H ESC[2K` and the row), so a test can find where a piece of text is. */
function screenRows(output: string): string[] {
  const rows: string[] = [];
  for (const chunk of output.split(/(?=\x1b\[\d+;1H\x1b\[2K)/)) {
    const marker = /^\x1b\[(\d+);1H\x1b\[2K([\s\S]*)$/.exec(chunk);
    if (marker) rows[Number(marker[1]) - 1] = stripVTControlCharacters(marker[2]!.replace(/\x1b\[\?25[lh][\s\S]*$/, "").replace(/\x1b\[\d+;\d+H[\s\S]*$/, ""));
  }
  return Array.from(rows, row => row ?? "");
}

/**
 * Links through the whole Claude Code screen, with real SGR mouse sequences and a fake `claude` whose answer carries a web address and a path that exists: clicking the address gives the
 * opener exactly that address, clicking the path gives the path opener the file, and when the openers fail the chat gets one warning line with the catalog's text and the address or path.
 * It exists because the unit tests build the screen by hand; this one proves Claude Code's screen wires the links, the clicks and the warning, as Codex's does.
 */
test("links in a Claude Code answer open with a click and a failure is a warning line", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-links-ui-"));
  const executable = testExecutablePath(root);
  const file = join(root, "notes.txt"); writeFileSync(file, "x");
  const terminal = new TestTerminal(); terminal.columns = 200; let ui: Promise<void> | undefined;
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  const previousForgeHome = process.env.FORGE614_HOME;
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.FORGE614_HOME = join(root, "forge614-home");
  process.env.HOME = join(root, "home");
  process.env.USERPROFILE = join(root, "home");
  process.env.CLAUDE_CONFIG_DIR = join(root, "claude-config");
  const opened = { web: [] as string[], path: [] as string[] };
  let works = true;
  const tools = { openWeb: async (url: string) => { opened.web.push(url); return works; }, openPath: async (path: string) => { opened.path.push(path); return works; } };
  const answer = `Docs: https://example.com/docs and the notes ${file}:3`;
  try {
    await writeTestExecutable(executable, `if(process.argv[2]==='auth') { console.log('{"loggedIn":true,"authMethod":"claude.ai"}'); }
else { require('readline').createInterface({input:process.stdin}).on('line',line=>{ const msg=JSON.parse(line);
  if(msg.type==='control_request') console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,response:{models:[],account:{email:'test@example.com'},commands:[],agents:[],output_style:'default',available_output_styles:[]}}}));
  if(msg.type==='user') {
    console.log(JSON.stringify({type:'assistant',message:{role:'assistant',content:[{type:'text',text:${JSON.stringify(answer)}}]},parent_tool_use_id:null,session_id:'s1',uuid:'a-'+Date.now()}));
    console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,duration_ms:1,duration_api_ms:1,num_turns:1,result:'ok',session_id:'s1',total_cost_usd:0,usage:{},modelUsage:{},permission_denials:[],user_message_uuids:[msg.uuid],uuid:'result-'+Date.now()}));
  } }); }`);
    ui = startClaudeUI([], executable, terminal, undefined, "en", tools); await tick();
    for (let i = 0; i < 60 && !screenRows(terminal.output).join("\n").includes(getCatalog("en").chat.statusReady); i++) await tick();
    enter("hello"); await tick();
    for (let i = 0; i < 60 && !screenRows(terminal.output).join("\n").includes(file); i++) await tick();
    const where = (text: string) => { const rows = screenRows(terminal.output); const y = rows.findIndex(row => row.includes(text)); return { x: rows[y]!.indexOf(text), y }; };
    const click = async (x: number, y: number) => { terminal.input(`\x1b[<0;${x + 1};${y + 1}M`); terminal.input(`\x1b[<0;${x + 1};${y + 1}m`); await tick(); };
    const web = where("https://example.com/docs"); const path = where(file);
    await click(web.x + 4, web.y); await click(path.x + 4, path.y);
    expect(opened).toEqual({ web: ["https://example.com/docs"], path: [file] });
    expect(screenRows(terminal.output).join("\n")).not.toContain(getCatalog("en").chat.linkOpenFailed({ target: file }));
    works = false;
    await click(web.x + 4, web.y); await click(path.x + 4, path.y);
    const text = screenRows(terminal.output).join("\n");
    expect(text).toContain(getCatalog("en").chat.linkOpenFailed({ target: "https://example.com/docs" }));
    expect(text).toContain(getCatalog("en").chat.linkOpenFailed({ target: file }));
  } finally {
    enter("/f614:quit"); await ui; await tick(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    if (previousForgeHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousForgeHome;
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
    if (previousClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
  }
});

/** The SDK's `init` message of a turn, with two MCP servers connected and one failed (what the bottom bar and its panel show). */
const mcpInit = { type: "system", subtype: "init", session_id: "s-bar-1", claude_code_version: "2.1.274", apiKeySource: "none", model: "claude-test", permissionMode: "default", cwd: process.cwd(),
  mcp_servers: [{ name: "forge614-engram", status: "connected" }, { name: "context7", status: "connected" }, { name: "github", status: "failed" }], slash_commands: [], tools: [], output_style: "default", skills: [], plugins: [],
  uuid: "00000000-0000-4000-8000-000000000003" };
type ClaudeHarness = Awaited<ReturnType<typeof claudeUi>>;
/** What is on the screen now, drawn again from scratch, as plain text. */
async function snapshot(h: ClaudeHarness): Promise<string> {
  // The width changes by one column (which is what makes the screen write every row) and comes back, so the clicks that follow land where they were measured.
  h.terminal.columns = 121; h.terminal.output = ""; h.terminal.resize(); await tick();
  const shown = h.plain();
  h.terminal.columns = 120; h.terminal.resize(); await tick();
  return shown;
}
/** A left click at column `x`, row `y` (0-based) as the terminal sends it: the press and then the release, in SGR mode. */
function leftClick(h: ClaudeHarness, x: number, y: number): void { h.terminal.input(`\x1b[<0;${x + 1};${y + 1}M`); h.terminal.input(`\x1b[<0;${x + 1};${y + 1}m`); }
/** On the 120×50 stand-in terminal the chat is 82 wide and the status line is row 48; «F614 ▴» starts in column 2 and, with no version, «⇌ N MCP ▴» ends in column 80. */
const STATUS_ROW = 48; const F614_X = 3; const MCP_X = 72;

/**
 * Runs `body` with the process in `/`, a short folder that is the same on every machine: the bottom bar draws the folder's path, and the MCP tests must not depend on where the repository (or its copy) lives.
 * The original folder comes back afterwards.
 */
async function inFixedFolder(body: () => Promise<void>): Promise<void> {
  const previous = process.cwd();
  process.chdir("/");
  try { await body(); } finally { process.chdir(previous); }
}
/** What the opening probe's `mcp_status` request is answered with: two servers connected and one failed, as the SDK words them. */
const probedServers = [{ name: "forge614-engram", status: "connected" }, { name: "context7", status: "connected" }, { name: "github", status: "failed" }];

/**
 * With Claude Code the bar knows the MCP servers from the moment the chat opens: Shell opens one query in the background that sends no message and asks the servers' states. So with NO message sent the bar already
 * shows «⇌ 2 MCP ▴» (two connected, one failed), and nothing was sent to the model (no `prompt:` line reaches the fake `claude`). A click on it opens the panel with the three servers, each with its state, the
 * Forge614 one marked; the same click closes it, and so does Esc.
 */
test("Claude UI: the bottom bar shows «⇌ 2 MCP ▴» with no message sent and its click opens the servers' panel", () => inFixedFolder(async () => {
  const h = await claudeUi([], "en", undefined, 120, [mcpInit], undefined, undefined, undefined, undefined, probedServers);
  try {
    for (let i = 0; i < 60 && !h.plain().includes("⇌ 2 MCP ▴"); i++) await tick();
    const before = await snapshot(h);
    expect(before).toContain("F614 ▴");
    expect(before).toContain("⇌ 2 MCP ▴");
    expect(h.calls()).toContain("mcp_status");
    expect(h.calls().some(line => line.startsWith("prompt:"))).toBe(false);
    leftClick(h, MCP_X, STATUS_ROW); await tick();
    const opened = await snapshot(h);
    for (const text of ["MCP servers · 3", "forge614-engram", "Forge614 · Engram", "context7", "github", "connected", "failed", "⇌ 2 MCP ▾"]) expect(opened, text).toContain(text);
    leftClick(h, MCP_X, STATUS_ROW); await tick();
    const closed = await snapshot(h);
    expect(closed).not.toContain("MCP servers · 3");
    expect(closed).toContain("⇌ 2 MCP ▴");
    leftClick(h, MCP_X, STATUS_ROW); await tick();
    expect(await snapshot(h)).toContain("MCP servers · 3");
    h.terminal.input("\x1b"); await tick();
    expect(await snapshot(h)).not.toContain("MCP servers · 3");
  } finally { await h.finish(); }
}));

/**
 * The open query's first answer is only the first word: when the person sends a message, that message's `init` rules (here it reports two connected where the query's answer knew one), and `/new` does not clear the list — it is
 * Claude Code's configuration, not the conversation's — so the bar keeps showing an MCP indicator through it, until the query opened again for the new conversation answers (the fake answers its one server every time it opens).
 */
test("Claude UI: a message's init rules over the opening answer, and /new keeps the MCP indicator", () => inFixedFolder(async () => {
  const h = await claudeUi([], "en", undefined, 120, [mcpInit], undefined, undefined, undefined, undefined, [{ name: "forge614-engram", status: "connected" }]);
  try {
    for (let i = 0; i < 60 && !h.plain().includes("⇌ 1 MCP ▴"); i++) await tick();
    expect(await snapshot(h)).toContain("⇌ 1 MCP ▴");
    h.enter("go");
    for (let i = 0; i < 60 && !h.plain().includes("⇌ 2 MCP ▴"); i++) await tick();
    expect(await snapshot(h)).toContain("⇌ 2 MCP ▴");
    h.enter("/f614:stop"); await tick(); await tick();
    h.enter("/new");
    // Never blank: the indicator is on screen right after `/new`, and the new query's own answer settles it on its list.
    expect(await snapshot(h)).toMatch(/⇌ \d MCP ▴/);
    for (let i = 0; i < 60 && h.calls().filter(line => line === "mcp_status").length < 2; i++) await tick();
    expect(h.calls().filter(line => line === "mcp_status")).toHaveLength(2);
    expect(await snapshot(h)).toContain("⇌ 1 MCP ▴");
  } finally { await h.finish(); }
}));

/**
 * A folder whose path is 150 characters long used to push the MCP indicator and the version off a wide bar. Here the real screen opens in such a folder at 120 columns: the folder is cut with «…» and «F614 ▴», «⇌ 2 MCP ▴» and the
 * version are all on the line. The folder is made in the test's own temporary directory (a path of that length in a fixed place), not in the repository.
 */
test("Claude UI: with a 150-character folder the bar cuts the folder with «…» and keeps «F614 ▴», the MCP indicator and the version", async () => {
  const previous = process.cwd();
  const base = await mkdtemp(join(tmpdir(), "forge614-long-folder-"));
  const folder = join(base, "a".repeat(Math.max(1, 150 - base.length - 1)));
  mkdirSync(folder, { recursive: true });
  process.chdir(folder);
  const h = await claudeUi([], "en", undefined, 120, [mcpInit], undefined, undefined, undefined, "1.13.0", probedServers);
  try {
    for (let i = 0; i < 60 && !h.plain().includes("⇌ 2 MCP ▴"); i++) await tick();
    const shown = await snapshot(h);
    expect(process.cwd().length).toBeGreaterThanOrEqual(140);
    expect(shown).toContain("F614 ▴");
    expect(shown).toContain("…");
    expect(shown).toContain("⇌ 2 MCP ▴   v1.13.0");
  } finally { await h.finish(); process.chdir(previous); await rm(base, { recursive: true, force: true }); }
});

/**
 * The Forge614 panel: Shell's version (the one the bar already has), Engines' and Engram's (read once, when Shell opens, by the injected reader) and the memory state, which is known as soon as Claude Code opens (it
 * asks Engram for its startup context then, before any message) — here there is no Engram under the test's own $FORGE614_HOME, so the context does not arrive and the row says «not in use». The reader is called once
 * however often the panel is opened.
 */
test("Claude UI: the Forge614 panel shows the three versions and the memory state, reading the versions once", async () => {
  let reads = 0;
  const versions = async (): Promise<EcosystemVersions> => { reads++; return { engines: { state: "version", version: "1.16.0" }, engram: { state: "version", version: "1.8.6" } }; };
  const h = await claudeUi([], "en", undefined, 120, [mcpInit], undefined, undefined, versions, "1.13.0");
  try {
    await tick();
    leftClick(h, F614_X, STATUS_ROW); await tick();
    const first = await snapshot(h);
    for (const text of ["Forge614", "Shell", "1.13.0", "Engines", "1.16.0", "Engram", "1.8.6", "F614 ▾"]) expect(first, text).toContain(text);
    // No message was sent, and the memory state is already known: Claude Code opened in the background and asked Engram.
    expect(first).toContain("not in use");
    expect(first).not.toContain("memory in use");
    leftClick(h, F614_X, STATUS_ROW); await tick();
    expect(await snapshot(h)).not.toContain("Engines");
    h.enter("go");
    for (let i = 0; i < 60 && !h.plain().includes("⇌ 2 MCP ▴"); i++) await tick();
    leftClick(h, F614_X, STATUS_ROW); await tick();
    const second = await snapshot(h);
    expect(second).toContain("1.8.6");
    expect(second).toContain("not in use");
    expect(reads).toBe(1);
  } finally { await h.finish(); }
});

/**
 * Esc with a panel open only closes the panel: it does not reach the writing box, so a menu that was open in it (here the command list) stays open, where Esc would have closed it. A second Esc is the box's again.
 */
test("Claude UI: Esc with a panel open closes only the panel and leaves the open menu alone", async () => {
  const h = await claudeUi([], "en", undefined, 120, [mcpInit], undefined, undefined, async () => ({ engines: { state: "missing" }, engram: { state: "missing" } }), "1.13.0");
  try {
    const title = getCatalog("en").chat.commandsFallbackTitle;
    h.enter("/f614:commands"); await tick();
    expect(await snapshot(h)).toContain(title);
    leftClick(h, F614_X, STATUS_ROW); await tick();
    expect(await snapshot(h)).toContain("Engines");
    h.terminal.input("\x1b"); await tick();
    const afterFirst = await snapshot(h);
    expect(afterFirst).not.toContain("Engines");
    expect(afterFirst).toContain(title);
    h.terminal.input("\x1b"); await tick();
    expect(await snapshot(h)).not.toContain(title);
  } finally { await h.finish(); }
});

/**
 * Claude Code is one open conversation: a message typed while it is still answering is drawn at once and handed to Claude Code (which takes it at its next tool boundary), not refused with «a turn is already
 * running». Both messages reach the same process, in order, and the box keeps saying «Working» until the turn ends; `/f614:stop` then ends it with an `interrupt` and no new process starts.
 */
test("Claude UI: a message typed mid-answer is drawn and sent to the same open Claude Code; /f614:stop interrupts it without closing it", async () => {
  const h = await claudeUi();
  try {
    const prompts = () => h.calls().filter(line => line.startsWith("prompt:"));
    h.enter("first message");
    for (let i = 0; i < 60 && prompts().length < 1; i++) await tick();
    h.terminal.output = ""; h.enter("second message, while the first is answered");
    for (let i = 0; i < 60 && prompts().length < 2; i++) await tick();
    expect(prompts()).toEqual(['prompt:"first message"', 'prompt:"second message, while the first is answered"']);
    expect(h.plain()).toContain("second message, while the first is answered");
    expect(h.plain()).not.toContain(getCatalog("en").chat.waitForCurrentOperation);
    expect(await snapshot(h)).toContain(getCatalog("en").chat.statusWorking);
    // One process got both messages.
    const pids = h.calls().filter(line => line.startsWith("pid:"));
    expect(pids).toHaveLength(2);
    expect(pids[0]).toBe(pids[1]!);
    h.terminal.output = ""; h.enter("/f614:stop");
    for (let i = 0; i < 60 && !h.plain().includes(getCatalog("en").chat.statusReady); i++) await tick();
    expect(h.calls().filter(line => line === "interrupt")).toHaveLength(1);
    // The person stopped it: the chat says so in plain words, never with the technical name of Claude Code's result.
    expect(h.plain()).toContain(getCatalog("en").chat.turnStoppedByYou);
    expect(h.plain()).not.toContain("error_during_execution");
    expect(h.plain()).not.toContain(getCatalog("en").chat.turnStopped({ message: "" }));
    // The next message goes to the same process: stopping did not close Claude Code.
    h.enter("after the stop");
    for (let i = 0; i < 60 && prompts().length < 3; i++) await tick();
    expect(h.calls().filter(line => line.startsWith("pid:")).at(-1)).toBe(pids[0]!);
  } finally { await h.finish(); }
});

/**
 * Leaving Shell closes Claude Code: the process the SDK started for the conversation ends with the screen, instead of staying behind with its MCP servers (it used to be left to the SDK to notice that Shell was gone).
 * The fake `claude` writes `closed` when its input closes or it is terminated.
 */
test("Claude UI: leaving Shell closes the Claude Code that was kept open", async () => {
  const h = await claudeUi();
  try {
    expect(h.calls()).not.toContain("closed");
    h.enter("/f614:quit");
    await h.ui;
    for (let i = 0; i < 100 && !h.calls().includes("closed"); i++) await tick();
    expect(h.calls()).toContain("closed");
  } finally { await h.finish(); }
});

/**
 * The person's first message is on screen before Engram answers. `startup-context` takes about 650 ms and used to run inside `send()` with `spawnSync`, so the screen drew nothing — not even the message —
 * until it was done. Claude Code now opens in the background when the account is connected and asks Engram then: here Engram's answer waits for the test and the message is typed as soon as Engram was asked,
 * while it is still being waited for — the message must already be drawn.
 */
test("Claude UI: the first message is drawn before Engram's startup context answers", async () => {
  let asked = false; let answered = false; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const slow = async () => { asked = true; await gate; answered = true; return { available: false as const, reason: "slow" }; };
  const h = await claudeUi([], "en", undefined, 120, [], undefined, undefined, undefined, undefined, undefined, slow, { waitFor: getCatalog("en").chat.statusReady });
  try {
    for (let i = 0; i < 60 && !asked; i++) await tick();
    expect(asked).toBe(true);
    h.terminal.output = ""; h.enter("hola desde la prueba");
    for (let i = 0; i < 10 && !screenRows(h.terminal.output).some(row => row.includes("hola desde la prueba")); i++) await tick();
    // Engram has not answered (its answer waits for the test) and the message is on screen anyway.
    expect(answered).toBe(false);
    expect(screenRows(h.terminal.output).some(row => row.includes("hola desde la prueba"))).toBe(true);
  } finally { release(); await h.finish(); }
});

// --- Background tasks between messages (Claude Code stays open) ---

const taskInit = { type: "system", subtype: "init", session_id: "s-bg", claude_code_version: "2.1.274", model: "claude-test", mcp_servers: [], uuid: "00000000-0000-4000-8000-0000000000a1" };
/** What a message that launches a background subagent brings (Claude Code SDK 0.3.274): the task starts in the background and the set of tasks alive says so. */
const launchEvents = [
  taskInit,
  { type: "system", subtype: "task_started", task_id: "t1", description: "Investigar X", task_type: "local_agent", is_backgrounded: true, uuid: "00000000-0000-4000-8000-0000000000a2", session_id: "s-bg" },
  { type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "t1", description: "Investigar X", task_type: "local_agent", is_backgrounded: true }], uuid: "00000000-0000-4000-8000-0000000000a3", session_id: "s-bg" },
];
const ready1 = (locale: "en" | "es" = "en") => getCatalog(locale).claudeChat.statusReadyBackground({ count: 1 });
/** A screen with one background task alive after the turn that launched it ended (the fake ends each turn with its own result). */
async function withBackgroundTask(locale: "en" | "es" = "en", sessions?: Parameters<typeof startClaudeUI>[8]) {
  const h = await claudeUi([], locale, undefined, 140, launchEvents, undefined, undefined, undefined, undefined, undefined, undefined, { answer: true, sessions });
  h.enter("lanza un subagente");
  for (let i = 0; i < 80 && !h.plain().includes(ready1(locale)); i++) await tick();
  return h;
}
const pidsOf = (h: ClaudeHarness) => h.calls().filter(line => line.startsWith("pid:"));

test("Claude UI: a background task stays after the turn's result — the box says «Ready · 1 in the background», the panel and the bottom bar's count keep it", async () => {
  for (const locale of ["en", "es"] as const) {
    const h = await withBackgroundTask(locale);
    try {
      const t = getCatalog(locale);
      expect(h.plain()).toContain(t.claudeChat.statusReadyBackground({ count: 1 }));
      expect(h.plain()).toContain(t.backgroundActivity.statusBarCount({ count: 1 }));
      // The sidebar cuts a long title with «…» to keep the state and the time: the start is enough.
      expect(h.plain()).toContain("Investigar");
      expect(h.plain()).toContain(t.backgroundActivity.running);
    } finally { await h.finish(); }
  }
});

test("Claude UI: a finished background task draws a card with its summary and state, and the automatic turn that follows is drawn and keeps the box on «Working» until its result", async () => {
  const h = await withBackgroundTask();
  try {
    const t = getCatalog("en");
    h.terminal.output = "";
    h.emit(
      { type: "system", subtype: "task_updated", task_id: "t1", patch: { status: "completed" }, uuid: "00000000-0000-4000-8000-0000000000b1", session_id: "s-bg" },
      { type: "system", subtype: "task_notification", task_id: "t1", status: "completed", summary: "Resultado de X: todo bien", output_file: "/tmp/out", uuid: "00000000-0000-4000-8000-0000000000b2", session_id: "s-bg" },
      taskInit, { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Terminé lo de X" }] }, parent_tool_use_id: null, session_id: "s-bg", uuid: "00000000-0000-4000-8000-0000000000b3" },
    );
    for (let i = 0; i < 60 && !h.plain().includes("Terminé lo de X"); i++) await tick();
    // The card: the task's title, its state and the summary it came with.
    expect(h.plain()).toContain(`Investigar X · ${t.backgroundActivity.cardDone}`);
    expect(h.plain()).toContain("Resultado de X: todo bien");
    // The assistant's words of the turn Claude Code started by itself are drawn, and the box is working until that turn's result.
    expect(h.plain()).toContain(t.chat.statusWorking);
    expect(h.plain()).not.toContain(ready1());
    h.terminal.output = "";
    h.emit({ type: "result", subtype: "success", is_error: false, duration_ms: 1, duration_api_ms: 1, num_turns: 1, result: "ok", session_id: "s-bg", total_cost_usd: 0, usage: {}, modelUsage: {}, permission_denials: [], user_message_uuids: [], uuid: "00000000-0000-4000-8000-0000000000b4" });
    for (let i = 0; i < 60 && !h.plain().includes(t.chat.statusReady); i++) await tick();
    expect(h.plain()).toContain(t.chat.statusReady);
    expect(h.plain()).not.toContain(ready1());
    expect(h.calls().filter(line => line.startsWith("prompt:"))).toHaveLength(1);
  } finally { await h.finish(); }
});

test("Claude UI: a task launched by a subagent draws no card, one of the top level does, in the words of each state", async () => {
  const h = await withBackgroundTask();
  try {
    const t = getCatalog("en").backgroundActivity;
    h.emit(
      { type: "system", subtype: "task_started", task_id: "inner", description: "Tarea interna", task_type: "local_bash", is_backgrounded: true, owned_by_subagent: true, uuid: "00000000-0000-4000-8000-0000000000c1", session_id: "s-bg" },
      { type: "system", subtype: "task_notification", task_id: "inner", status: "completed", summary: "Resumen interno", output_file: "/tmp/o", uuid: "00000000-0000-4000-8000-0000000000c2", session_id: "s-bg" },
      { type: "system", subtype: "task_notification", task_id: "t1", status: "failed", summary: "Se cayó la tarea", output_file: "/tmp/o", uuid: "00000000-0000-4000-8000-0000000000c3", session_id: "s-bg" },
      { type: "system", subtype: "task_notification", task_id: "unseen-inner", status: "completed", owned_by_subagent: true, summary: "Resumen interno 2", output_file: "/tmp/o", uuid: "00000000-0000-4000-8000-0000000000c7", session_id: "s-bg" },
    );
    for (let i = 0; i < 60 && !h.plain().includes("Se cayó la tarea"); i++) await tick();
    expect(h.plain()).toContain(`Investigar X · ${t.cardFailed}`);
    expect(h.plain()).not.toContain("Resumen interno");
    // A notice of a task never seen, which carries the subagent's mark itself, draws none either.
    expect(h.plain()).not.toContain("unseen-inner");
    expect(h.plain()).not.toContain(`Tarea interna · ${t.cardDone}`);
    h.terminal.output = "";
    h.emit({ type: "system", subtype: "task_notification", task_id: "t1", status: "stopped", summary: "Detenida a mano", output_file: "/tmp/o", uuid: "00000000-0000-4000-8000-0000000000c4", session_id: "s-bg" });
    for (let i = 0; i < 60 && !h.plain().includes("Detenida a mano"); i++) await tick();
    expect(h.plain()).toContain(`Investigar X · ${t.cardStopped}`);
    h.terminal.output = "";
    h.emit({ type: "system", subtype: "task_notification", task_id: "orphan", status: "stopped", reason: "worker_restart", summary: "2 agentes no terminaron", output_file: "/tmp/o", uuid: "00000000-0000-4000-8000-0000000000c5", session_id: "s-bg" },
      { type: "system", subtype: "task_notification", task_id: "housekeeping", status: "completed", ambient: true, summary: "limpieza interna", output_file: "/tmp/o", uuid: "00000000-0000-4000-8000-0000000000c6", session_id: "s-bg" });
    for (let i = 0; i < 60 && !h.plain().includes("2 agentes no terminaron"); i++) await tick();
    expect(h.plain()).toContain(`orphan · ${t.cardInterrupted}`);
    expect(h.plain()).not.toContain("limpieza interna");
  } finally { await h.finish(); }
});

test("Claude UI: when Claude Code dies the tasks that were running read «interrupted» and the box no longer says there are tasks", async () => {
  const h = await withBackgroundTask();
  try {
    const t = getCatalog("en");
    h.terminal.output = "";
    h.emit({ __exit: 1 });
    for (let i = 0; i < 80 && !h.plain().includes(t.backgroundActivity.interrupted); i++) await tick();
    expect(h.plain()).toContain(t.backgroundActivity.interrupted);
    expect(h.plain()).toContain("Investigar");
    for (let i = 0; i < 40 && h.plain().includes(ready1()); i++) await tick();
    expect(await snapshot(h)).not.toContain(ready1());
    expect(await snapshot(h)).toContain(t.chat.statusReady);
    expect(await snapshot(h)).not.toContain(t.backgroundActivity.statusBarCount({ count: 1 }));
  } finally { await h.finish(); }
});

test("Claude UI: the notice Claude Code gives on resuming («N background agents didn't finish…») is a notice card, not a message of the person", async () => {
  const h = await claudeUi();
  try {
    const t = getCatalog("en");
    h.terminal.output = "";
    const text = "2 background agents didn't finish before the previous session ended";
    h.emit({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, isSynthetic: true, origin: { kind: "task-notification" }, session_id: "s-bg", uuid: "00000000-0000-4000-8000-0000000000d1" });
    for (let i = 0; i < 60 && !h.plain().includes(text); i++) await tick();
    expect(h.plain()).toContain(t.backgroundActivity.noticeTitle);
    expect(h.plain()).toContain(text);
    expect(h.plain()).not.toContain(t.chatRoles.you);
  } finally { await h.finish(); }
});

/** What each way of cutting work asks (and says) when background tasks are alive: the question names the count, «No» is the marked row, and answering «No» cuts nothing. */
const cutActions: { name: string; run: (h: ClaudeHarness) => void; question: (t: ReturnType<typeof getCatalog>) => string }[] = [
  { name: "/f614:quit", run: h => h.enter("/f614:quit"), question: t => t.claudeChat.backgroundCutQuestion({ count: 1 }) },
  { name: "Ctrl+C", run: h => h.terminal.input("\x03"), question: t => t.claudeChat.backgroundCutQuestion({ count: 1 }) },
  { name: "Ctrl+D", run: h => h.terminal.input("\x04"), question: t => t.claudeChat.backgroundCutQuestion({ count: 1 }) },
  { name: "/new", run: h => h.enter("/new"), question: t => t.claudeChat.backgroundCutQuestion({ count: 1 }) },
  { name: "/logout", run: h => h.enter("/logout"), question: t => t.claudeChat.backgroundCutQuestion({ count: 1 }) },
  { name: "/effort high", run: h => h.enter("/effort high"), question: t => t.claudeChat.backgroundCutQuestion({ count: 1 }) },
  { name: "/f614:stop", run: h => h.enter("/f614:stop"), question: t => t.claudeChat.backgroundStopQuestion({ count: 1 }) },
];

test("Claude UI: leaving, /new, /logout, a new effort and /f614:stop ask first when tasks run in the background, with «No» marked, and «No» (Enter or Esc) cuts nothing", async () => {
  for (const action of cutActions) {
    const h = await withBackgroundTask();
    try {
      const t = getCatalog("en");
      h.terminal.output = ""; action.run(h);
      for (let i = 0; i < 40 && !h.plain().includes(action.question(t)); i++) await tick();
      expect(h.plain(), action.name).toContain(action.question(t));
      expect(h.plain(), action.name).toContain(`▎ 1. ${t.permission.no}`);
      // Enter alone is «No»; then Esc is «No» too.
      for (const key of ["\r", "\x1b"]) {
        if (key === "\x1b") { h.terminal.output = ""; action.run(h); for (let i = 0; i < 40 && !h.plain().includes(action.question(t)); i++) await tick(); }
        h.terminal.input(key); await tick(); await tick();
        expect(h.calls(), action.name).not.toContain("closed");
        expect(h.calls(), action.name).not.toContain("interrupt");
        expect(pidsOf(h), action.name).toHaveLength(1);
      }
      expect(await snapshot(h), action.name).toContain(ready1());
    } finally { await h.finish(); }
  }
});

test("Claude UI: answering «Yes» cuts the tasks: /new closes Claude Code and opens another with no resume; /f614:stop interrupts", async () => {
  const t = getCatalog("en");
  const yes = (h: ClaudeHarness) => { h.terminal.input("\x1b[B"); h.terminal.input("\r"); };
  const stopped = await withBackgroundTask();
  try {
    stopped.enter("/f614:stop");
    for (let i = 0; i < 40 && !stopped.plain().includes(t.claudeChat.backgroundStopQuestion({ count: 1 })); i++) await tick();
    yes(stopped);
    for (let i = 0; i < 60 && !stopped.calls().includes("interrupt"); i++) await tick();
    expect(stopped.calls().filter(line => line === "interrupt")).toHaveLength(1);
    expect(stopped.calls()).not.toContain("closed");
  } finally { await stopped.finish(); }
  const fresh = await withBackgroundTask();
  try {
    fresh.enter("/new");
    for (let i = 0; i < 40 && !fresh.plain().includes(t.claudeChat.backgroundCutQuestion({ count: 1 })); i++) await tick();
    yes(fresh);
    for (let i = 0; i < 80 && !fresh.calls().includes("closed"); i++) await tick();
    expect(fresh.calls()).toContain("closed");
    // The first process is gone and the new conversation's one opens in the background.
    for (let i = 0; i < 80 && !fresh.calls().filter(line => line === "mcp_status").length; i++) await tick();
    expect(fresh.calls().filter(line => line === "closed")).toHaveLength(1);
  } finally { await fresh.finish(); }
});

test("Claude UI: /resume asks before cutting tasks, after a conversation was chosen; «No» keeps everything", async () => {
  const t = getCatalog("en");
  const sessions = { listSessions: async () => [{ sessionId: "saved-1", summary: "Una conversación guardada", lastModified: 1_700_000_000_000, cwd: process.cwd(), firstPrompt: "hola" }], getSessionMessages: async () => [] } as unknown as Parameters<typeof startClaudeUI>[8];
  const h = await withBackgroundTask("en", sessions);
  try {
    h.enter("/resume");
    for (let i = 0; i < 40 && !h.plain().includes("Una conversación guardada"); i++) await tick();
    // The picker comes first: nothing is cut for a conversation not chosen yet.
    expect(h.plain()).not.toContain(t.claudeChat.backgroundCutQuestion({ count: 1 }));
    h.terminal.input("\r");
    for (let i = 0; i < 40 && !h.plain().includes(t.claudeChat.backgroundCutQuestion({ count: 1 })); i++) await tick();
    expect(h.plain()).toContain(`▎ 1. ${t.permission.no}`);
    h.terminal.input("\r"); await tick(); await tick();
    expect(h.calls()).not.toContain("closed");
    expect(pidsOf(h)).toHaveLength(1);
    expect(await snapshot(h)).toContain(ready1());
  } finally { await h.finish(); }
});

test("Claude UI: with no task running nothing is asked: leaving, /new and /f614:stop go ahead as before", async () => {
  const h = await claudeUi();
  try {
    const t = getCatalog("en");
    h.terminal.output = ""; h.enter("/new"); await tick(); await tick();
    expect(h.plain()).not.toContain(t.claudeChat.backgroundCutQuestion({ count: 1 }));
    h.terminal.output = ""; h.enter("/f614:stop"); await tick(); await tick();
    expect(h.plain()).not.toContain(t.claudeChat.backgroundStopQuestion({ count: 1 }));
    expect(h.plain()).not.toContain(t.permission.no);
    h.terminal.output = ""; h.enter("/f614:quit");
    await h.ui;
    expect(h.plain()).not.toContain(t.claudeChat.backgroundCutQuestion({ count: 1 }));
  } finally { await h.finish(); }
});

// --- Round 2: the text of a stop, the inner steps of a helper and the up-arrow history ---

/** When the person stopped the turn, Claude Code answers with an error result whose name is technical; the chat says «You stopped the turn.» instead, in the person's language. */
test("Claude UI: stopping a turn says «Detuviste el turno.» (es) or «You stopped the turn.» (en), never the technical name of Claude Code's result", async () => {
  const words = { es: "Detuviste el turno.", en: "You stopped the turn." } as const;
  for (const locale of ["es", "en"] as const) {
    const h = await claudeUi([], locale);
    try {
      expect(getCatalog(locale).chat.turnStoppedByYou).toBe(words[locale]);
      h.enter("trabajo largo");
      for (let i = 0; i < 60 && !h.calls().some(line => line.startsWith("prompt:")); i++) await tick();
      h.terminal.output = ""; h.enter("/f614:stop");
      for (let i = 0; i < 60 && !h.plain().includes(words[locale]); i++) await tick();
      expect(h.plain()).toContain(words[locale]);
      expect(h.plain()).not.toContain("error_during_execution");
      expect(h.plain()).not.toContain(getCatalog(locale).chat.turnStopped({ message: "" }).trim());
    } finally { await h.finish(); }
  }
});

test("Claude UI: a turn that ends for another reason (Claude Code dies) still says «Turn stopped: …» with its message, not «You stopped the turn.»", async () => {
  const h = await claudeUi();
  try {
    const t = getCatalog("en");
    h.enter("trabajo que se cae");
    for (let i = 0; i < 60 && !h.calls().some(line => line.startsWith("prompt:")); i++) await tick();
    h.terminal.output = ""; h.emit({ __exit: 1 });
    for (let i = 0; i < 80 && !h.plain().includes(t.chat.turnStopped({ message: "" }).trim()); i++) await tick();
    expect(h.plain()).toContain(t.chat.turnStopped({ message: "" }).trim());
    expect(h.plain()).not.toContain(t.chat.turnStoppedByYou);
  } finally { await h.finish(); }
});

/**
 * In Claude Code itself the main chat does not draw what a subagent does inside: its tool calls and their results (events with a `parent_tool_use_id`), nor its progress notices. The helper's own line
 * («Agent») is the main assistant's tool call and stays; the same events with no parent are the main assistant's and are drawn.
 */
test("Claude UI: the tools of a subagent (events with a parent_tool_use_id) draw nothing in the main chat, the same events of the main assistant do", async () => {
  const h = await claudeUi();
  try {
    const t = getCatalog("en");
    let n = 0;
    const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    const toolUse = (id: string, name: string, parent: string | null) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input: { description: "probe" } }] }, parent_tool_use_id: parent, session_id: "s", uuid: uuid() });
    const toolResult = (id: string, parent: string | null, isError = true) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "boom", is_error: isError }] }, parent_tool_use_id: parent, session_id: "s", uuid: uuid() });
    const progress = (id: string, name: string, parent: string | null) => ({ type: "tool_progress", tool_use_id: id, tool_name: name, parent_tool_use_id: parent, elapsed_time_seconds: 3, session_id: "s", uuid: uuid() });
    const said = (text: string) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] }, parent_tool_use_id: null, session_id: "s", uuid: uuid() });
    const failed = t.claudeChat.toolFailed({ duration: "" }).replace(/[\s·]+$/, "");
    // Inside a subagent: its own tool, its result, a progress notice of another one, and (as the marker that the events were handled) a line of the main assistant.
    h.terminal.output = "";
    h.emit(toolUse("inner-1", "InnerProbeTool", "agent-1"), toolResult("inner-1", "agent-1"), progress("inner-2", "InnerProgressTool", "agent-1"), said("MARKER-ONE"));
    for (let i = 0; i < 60 && !h.plain().includes("MARKER-ONE"); i++) await tick();
    expect(h.plain()).toContain("MARKER-ONE");
    expect(h.plain()).not.toContain("InnerProbeTool");
    expect(h.plain()).not.toContain("InnerProgressTool");
    expect(h.plain()).not.toContain(failed);
    // The main assistant's own calls, with no parent: drawn, with their result and progress.
    h.terminal.output = "";
    h.emit(toolUse("main-1", "MainProbeTool", null), toolResult("main-1", null), progress("main-2", "MainProgressTool", null), said("MARKER-TWO"));
    for (let i = 0; i < 60 && !h.plain().includes("MARKER-TWO"); i++) await tick();
    expect(h.plain()).toContain("MainProbeTool");
    expect(h.plain()).toContain("MainProgressTool");
    expect(h.plain()).toContain(failed);
    // A result marked as a subagent's never finishes a card of the main chat, not even one with that very id: the card stays as requested and never reads «Completed».
    const completed = t.claudeChat.toolCompleted({ duration: "" }).replace(/[\s·]+$/, "");
    h.terminal.output = "";
    h.emit(toolUse("shared-1", "SharedProbeTool", null), toolResult("shared-1", "agent-1", false), said("MARKER-THREE"));
    for (let i = 0; i < 60 && !h.plain().includes("MARKER-THREE"); i++) await tick();
    expect(h.plain()).toContain("SharedProbeTool");
    expect(h.plain()).not.toContain(completed);
  } finally { await h.finish(); }
});

// The up arrow brings back what the person sent, as the shells do (the editor has it; Shell fills it with each message or command sent).
const promptsOf = (h: ClaudeHarness) => h.calls().filter(line => line.startsWith("prompt:"));
const waitForPrompts = async (h: ClaudeHarness, count: number) => { for (let i = 0; i < 60 && promptsOf(h).length < count; i++) await tick(); };
const UP = "\x1b[A"; const DOWN = "\x1b[B";

test("Claude UI: ↑ with the box empty brings the last message, ↑ again the one before, ↓ goes forward and past the newest returns what was being written", async () => {
  const h = await claudeUi();
  try {
    h.enter("uno"); await waitForPrompts(h, 1);
    h.enter("dos"); await waitForPrompts(h, 2);
    // ↑ brings «dos»; Enter sends what the box holds.
    h.terminal.input(UP); h.terminal.input("\r"); await waitForPrompts(h, 3);
    // ↑ ↑ ↓ is «dos» again.
    h.terminal.input(UP); h.terminal.input(UP); h.terminal.input(DOWN); h.terminal.input("\r"); await waitForPrompts(h, 4);
    // With a draft and the cursor at the start of the line: ↑ ↑ goes back to «uno», ↓ ↓ returns the draft.
    h.terminal.input("borrador"); h.terminal.input("\x01");
    h.terminal.input(UP); h.terminal.input(UP); h.terminal.input(DOWN); h.terminal.input(DOWN); h.terminal.input("\r"); await waitForPrompts(h, 5);
    // The draft was sent now, so it is the newest: ↑ ↑ ↑ reaches «uno».
    h.terminal.input(UP); h.terminal.input(UP); h.terminal.input(UP); h.terminal.input("\r"); await waitForPrompts(h, 6);
    expect(promptsOf(h)).toEqual(['prompt:"uno"', 'prompt:"dos"', 'prompt:"dos"', 'prompt:"dos"', 'prompt:"borrador"', 'prompt:"uno"']);
  } finally { await h.finish(); }
});

test("Claude UI: what answers a question (/f614:yes, /f614:no) does not enter the history, a command does", async () => {
  const h = await claudeUi();
  try {
    h.enter("uno"); await waitForPrompts(h, 1);
    h.enter("/f614:yes"); await tick(); await tick();
    h.enter("/f614:no"); await tick(); await tick();
    // The newest entry is still «uno»: the answers were not remembered.
    h.terminal.input(UP); h.terminal.input("\r"); await waitForPrompts(h, 2);
    expect(promptsOf(h)).toEqual(['prompt:"uno"', 'prompt:"uno"']);
    // A command is remembered like a message: ↑ brings it back and Enter runs it again.
    h.terminal.output = ""; h.enter("/f614:status"); await tick(); await tick();
    for (let i = 0; i < 60 && !h.plain().includes("Memory: "); i++) await tick();
    expect(h.plain()).toContain("Memory: ");
    h.terminal.output = ""; h.terminal.input(UP); h.terminal.input("\r");
    for (let i = 0; i < 60 && !h.plain().includes("Memory: "); i++) await tick();
    expect(h.plain()).toContain("Memory: ");
  } finally { await h.finish(); }
});

/** The history is kept between runs, per project folder: the file is `$FORGE614_HOME/shell/history.jsonl` with permissions 600 and a line {cwd,text,at} per entry. */
test("Claude UI: the history is saved per folder (history.jsonl, 600) and comes back on opening the chat again in the same folder, not in another", async () => {
  const here = process.cwd();
  const elsewhere = await mkdtemp(join(tmpdir(), "forge614-history-elsewhere-"));
  let saved = "";
  const first = await claudeUi();
  try {
    first.enter("mensaje que se guarda"); await waitForPrompts(first, 1);
    const file = join(process.env.FORGE614_HOME!, "shell", "history.jsonl");
    saved = readFileSync(file, "utf8");
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    } else {
      expect(file.startsWith(process.env.FORGE614_HOME!)).toBe(true);
      expect(existsSync(file)).toBe(true);
    }
  } finally { await first.finish(); }
  const entries = saved.split("\n").filter(Boolean).map(line => JSON.parse(line));
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ cwd: here, text: "mensaje que se guarda" });
  expect(typeof entries[0].at).toBe("number");
  // A new run (a fresh $FORGE614_HOME that holds the saved file), same folder: ↑ brings the message back.
  const install = (forgeHome: string) => { mkdirSync(join(forgeHome, "shell"), { recursive: true }); writeFileSync(join(forgeHome, "shell", "history.jsonl"), saved, { mode: 0o600 }); };
  const same = await claudeUi([], "en", undefined, 120, [], undefined, install);
  try {
    same.terminal.input(UP); same.terminal.input("\r"); await waitForPrompts(same, 1);
    expect(promptsOf(same)).toEqual(['prompt:"mensaje que se guarda"']);
  } finally { await same.finish(); }
  // Another folder: the same file brings nothing there.
  process.chdir(elsewhere);
  try {
    const other = await claudeUi([], "en", undefined, 120, [], undefined, install);
    try {
      other.terminal.input(UP); other.terminal.input("\r");
      for (let i = 0; i < 8; i++) await tick();
      expect(promptsOf(other)).toEqual([]);
    } finally { await other.finish(); }
  } finally { process.chdir(here); await rm(elsewhere, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test("Claude UI: a history file that cannot be used never breaks the chat or shows an error", async () => {
  // The history path is a folder: it can be neither read nor written as a file.
  const h = await claudeUi([], "en", undefined, 120, [], undefined, forgeHome => { mkdirSync(join(forgeHome, "shell", "history.jsonl"), { recursive: true }); });
  try {
    h.enter("sigue funcionando"); await waitForPrompts(h, 1);
    h.terminal.input(UP); h.terminal.input("\r"); await waitForPrompts(h, 2);
    // In memory the history still works.
    expect(promptsOf(h)).toEqual(['prompt:"sigue funcionando"', 'prompt:"sigue funcionando"']);
    expect(h.plain()).not.toContain("EISDIR");
    expect(h.plain()).not.toContain(getCatalog("en").chat.errorPrefixed({ message: "" }).trim());
  } finally { await h.finish(); }
});
