import { expect, test } from "bun:test";
import type { Terminal } from "@earendil-works/pi-tui";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startClaudeUI } from "./claude.ts";
import { getCatalog } from "../../i18n/index.ts";

class TestTerminal implements Terminal {
  columns = 120; rows = 50; kittyProtocolActive = false;
  input: (data: string) => void = () => {}; output = "";
  start(input: (data: string) => void) { this.input = input; }
  stop() {} async drainInput() {} write(data: string) { this.output += data; }
  moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
}
const tick = () => new Promise(resolve => setTimeout(resolve, 35));

test.skipIf(process.platform === "win32")("Claude UI accepts logout consent and stop while auth is pending, without sending a model message", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-logout-ui-"));
  const executable = join(root, "claude"); const marker = join(root, "calls");
  const terminal = new TestTerminal(); let ui: Promise<void> | undefined;
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  // Shell persists /model and /effort picks to $FORGE614_HOME/shell/preferences.json (see
  // shell-preferences.ts) — isolate it so this test never reads or writes the real developer's
  // ~/.forge614 preferences file.
  const previousForgeHome = process.env.FORGE614_HOME;
  process.env.FORGE614_HOME = join(root, "forge614-home");
  try {
    await writeFile(executable, `#!${process.execPath}
const fs=require('fs');
if(process.argv[2]==='auth') {
  fs.appendFileSync(${JSON.stringify(marker)},process.argv.slice(2).join(' ')+'\\n');
  console.log('{"loggedIn":true,"authMethod":"claude.ai"}');
} else {
  require('readline').createInterface({input:process.stdin}).on('line',line=>{
    const msg=JSON.parse(line);
    if(msg.type==='user') fs.appendFileSync(${JSON.stringify(marker)},'UNEXPECTED PROMPT\\n');
    if(msg.type==='control_request') console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,response:{models:[{value:'default',displayName:'Default',description:'Native default',supportedEffortLevels:['low','high']}],account:{email:'test@example.com'},commands:[{name:'model',description:'Select model',argumentHint:''},{name:'effort',description:'Select reasoning',argumentHint:''}],agents:[],output_style:'default',available_output_styles:[]}}}));
  });
}`, { mode: 0o755 });
    ui = startClaudeUI([], executable, terminal); await tick();
    for (let i = 0; i < 60 && !terminal.output.includes("Connected"); i++) await tick();
    expect(terminal.output).toContain("Connected");
    expect(await readFile(marker, "utf8")).toBe("auth status --json\n");
    expect(terminal.output).toContain("SESSION");
    for (let i = 0; i < 60 && !terminal.output.includes("test@example.com"); i++) await tick();
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
    enter("/no"); await tick();
    expect(await readFile(marker, "utf8")).toBe("auth status --json\n");
    enter("/logout"); await tick(); enter("/f614:stop"); await tick();
    expect(await readFile(marker, "utf8")).toBe("auth status --json\n");
    enter("/logout"); await tick(); enter("/yes");
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
    enter("/quit!"); await ui; await rm(root, { recursive: true, force: true });
    if (previousForgeHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousForgeHome;
  }
});

/**
 * Idea 7 and idea 1 on the Claude screen: the work mode saved last time is put back on opening (here
 * «Plan mode», not the default), Shift+Tab keeps cycling the SDK's modes without any «Finish or /stop»
 * error, and every change is written to Shell's preferences. Uses a fake `claude` executable, so no
 * real account or network is involved.
 */
test.skipIf(process.platform === "win32")("Claude UI restores the saved work mode on opening and saves every Shift+Tab change", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-mode-ui-"));
  const executable = join(root, "claude");
  const terminal = new TestTerminal(); let ui: Promise<void> | undefined;
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  const previousForgeHome = process.env.FORGE614_HOME;
  process.env.FORGE614_HOME = join(root, "forge614-home");
  const preferences = () => JSON.parse(readFileSync(join(root, "forge614-home", "shell", "preferences.json"), "utf8"));
  try {
    mkdirSync(join(root, "forge614-home", "shell"), { recursive: true });
    writeFileSync(join(root, "forge614-home", "shell", "preferences.json"), JSON.stringify({ claude: { mode: "plan" } }));
    await writeFile(executable, `#!${process.execPath}
if(process.argv[2]==='auth') { console.log('{"loggedIn":true,"authMethod":"claude.ai"}'); }
else {
  require('readline').createInterface({input:process.stdin}).on('line',line=>{
    const msg=JSON.parse(line);
    if(msg.type==='control_request') console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,response:{models:[],account:{email:'test@example.com'},commands:[],agents:[],output_style:'default',available_output_styles:[]}}}));
  });
}`, { mode: 0o755 });
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
    enter("/quit!"); await ui; await rm(root, { recursive: true, force: true });
    if (previousForgeHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousForgeHome;
  }
});

/**
 * Shell's own «cancel the answer in progress» is `/f614:stop` now: `/stop` no longer belongs to Shell, so
 * it does not cancel anything. Uses a fake `claude` that accepts the prompt and never answers, so the turn
 * stays open until it is cancelled; no real account or network is involved.
 */
test.skipIf(process.platform === "win32")("Claude UI: /f614:stop cancels the running turn and a plain /stop does not", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-stop-ui-"));
  const executable = join(root, "claude");
  const terminal = new TestTerminal(); let ui: Promise<void> | undefined;
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  const plain = () => stripVTControlCharacters(terminal.output);
  const previousForgeHome = process.env.FORGE614_HOME;
  process.env.FORGE614_HOME = join(root, "forge614-home");
  try {
    await writeFile(executable, `#!${process.execPath}
if(process.argv[2]==='auth') { console.log('{"loggedIn":true,"authMethod":"claude.ai"}'); }
else {
  require('readline').createInterface({input:process.stdin}).on('line',line=>{
    const msg=JSON.parse(line);
    if(msg.type==='control_request') console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,response:{models:[],account:{email:'test@example.com'},commands:[],agents:[],output_style:'default',available_output_styles:[]}}}));
  });
}`, { mode: 0o755 });
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
    enter("/quit!"); await ui; await rm(root, { recursive: true, force: true });
    if (previousForgeHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousForgeHome;
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
test.skipIf(process.platform === "win32")("Claude UI: a Bash permission reads in plain words, Enter alone approves it and Esc denies it", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-permission-ui-"));
  const executable = join(root, "claude"); const marker = join(root, "decisions");
  const terminal = new TestTerminal(); let ui: Promise<void> | undefined;
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  const plain = () => stripVTControlCharacters(terminal.output);
  const previousForgeHome = process.env.FORGE614_HOME;
  process.env.FORGE614_HOME = join(root, "forge614-home");
  const previousCwd = process.cwd();
  process.chdir("/tmp");
  try {
    await writeFile(executable, `#!${process.execPath}
const fs=require('fs');
if(process.argv[2]==='auth') { console.log('{"loggedIn":true,"authMethod":"claude.ai"}'); }
else {
  require('readline').createInterface({input:process.stdin}).on('line',line=>{
    const msg=JSON.parse(line);
    if(msg.type==='control_request') console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,response:{models:[],account:{email:'test@example.com'},commands:[],agents:[],output_style:'default',available_output_styles:[]}}}));
    if(msg.type==='user') console.log(JSON.stringify({type:'control_request',request_id:'permission-'+Date.now(),request:{subtype:'can_use_tool',tool_name:'Bash',input:{command:'rtk grep -rn changelog .',description:'Buscar el changelog de Engram en este repositorio'},tool_use_id:'tool-1'}}));
    if(msg.type==='control_response' && msg.response.response && msg.response.response.behavior) {
      fs.appendFileSync(${JSON.stringify(marker)},msg.response.response.behavior+'\\n');
      console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,duration_ms:1,duration_api_ms:1,num_turns:1,result:'ok',session_id:'s1',total_cost_usd:0,usage:{},modelUsage:{},permission_denials:[],uuid:'result-'+Date.now()}));
    }
  });
}`, { mode: 0o755 });
    ui = startClaudeUI([], executable, terminal, undefined, "es"); await tick();
    for (let i = 0; i < 60 && !terminal.output.includes("test@example.com"); i++) await tick();
    enter("run it"); await tick();
    for (let i = 0; i < 60 && !plain().includes("› Sí"); i++) await tick();
    const screen = plain();
    expect(screen).toContain("Buscar el changelog de Engram en este repositorio");
    expect(screen).toContain(`Carpeta: ${process.cwd()}`);
    expect(screen).toContain("rtk grep -rn changelog .");
    expect(screen).toContain("› Sí");
    for (const internal of ["\"command\"", "\"description\"", "Permiso solicitado: Bash", "/yes", "/no denegar", "Denegar"]) expect(screen).not.toContain(internal);
    terminal.input("\r");
    for (let i = 0; i < 60 && !existsSync(marker); i++) await tick();
    expect(readFileSync(marker, "utf8")).toBe("allow\n");
    for (let i = 0; i < 60 && !plain().includes(getCatalog("es").chat.statusReady); i++) await tick();
    enter("run it again"); await tick();
    for (let i = 0; i < 60 && !plain().includes(getCatalog("es").chat.awaitingPermission); i++) await tick();
    await tick();
    terminal.input("\x1b");
    for (let i = 0; i < 60 && readFileSync(marker, "utf8") === "allow\n"; i++) await tick();
    expect(readFileSync(marker, "utf8")).toBe("allow\ndeny\n");
  } finally {
    enter("/quit!"); await ui; process.chdir(previousCwd); await rm(root, { recursive: true, force: true });
    if (previousForgeHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousForgeHome;
  }
});

/**
 * Came out of the real-account test: in a copy under a long path the «Carpeta:» line was broken in the middle of a folder name.
 * The session works in a deep folder of the test's own making, so the screen must show the last folders whole behind «…»
 * (manual 05: long paths are cut with «…») — the same on every machine, whatever the path above it.
 */
test.skipIf(process.platform === "win32")("Claude UI: a long working folder is cut with «…» keeping its last whole folders", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-long-folder-ui-"));
  const executable = join(root, "claude");
  const deep = join(root, "a-long-folder-name-for-the-permission-card", "another-long-folder-name-here", "project");
  mkdirSync(deep, { recursive: true });
  const terminal = new TestTerminal(); let ui: Promise<void> | undefined;
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  const plain = () => stripVTControlCharacters(terminal.output);
  const previousForgeHome = process.env.FORGE614_HOME;
  process.env.FORGE614_HOME = join(root, "forge614-home");
  const previousCwd = process.cwd();
  process.chdir(deep);
  try {
    await writeFile(executable, `#!${process.execPath}
if(process.argv[2]==='auth') { console.log('{"loggedIn":true,"authMethod":"claude.ai"}'); }
else {
  require('readline').createInterface({input:process.stdin}).on('line',line=>{
    const msg=JSON.parse(line);
    if(msg.type==='control_request') console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,response:{models:[],account:{email:'test@example.com'},commands:[],agents:[],output_style:'default',available_output_styles:[]}}}));
    if(msg.type==='user') console.log(JSON.stringify({type:'control_request',request_id:'permission-'+Date.now(),request:{subtype:'can_use_tool',tool_name:'Bash',input:{command:'ls',description:'List the folder'},tool_use_id:'tool-1'}}));
  });
}`, { mode: 0o755 });
    ui = startClaudeUI([], executable, terminal, undefined, "es"); await tick();
    for (let i = 0; i < 60 && !terminal.output.includes("test@example.com"); i++) await tick();
    enter("run it"); await tick();
    for (let i = 0; i < 60 && !plain().includes("› Sí"); i++) await tick();
    expect(plain()).toContain("Carpeta: …/another-long-folder-name-here/project");
    expect(plain()).not.toContain("a-long-folder-name-for-the-permission-card");
    terminal.input("\x1b");
    await tick();
  } finally {
    enter("/quit!"); await ui; process.chdir(previousCwd); await rm(root, { recursive: true, force: true });
    if (previousForgeHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousForgeHome;
  }
});

/**
 * The «Disconnect only in this session?» question of `/logout` uses the same Sí/No selector as any tool permission: its own
 * sentence, «Yes» marked, Enter alone confirms. It exists because that question went through the tool-permission path
 * as a fake tool called «Sign out» and would have been read as `Use the Sign out tool`.
 */
test.skipIf(process.platform === "win32")("Claude UI: the /logout question keeps its own sentence with a marked Yes, and Enter alone confirms", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge614-logout-choice-ui-"));
  const executable = join(root, "claude");
  const terminal = new TestTerminal(); let ui: Promise<void> | undefined;
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  const plain = () => stripVTControlCharacters(terminal.output);
  const previousForgeHome = process.env.FORGE614_HOME;
  process.env.FORGE614_HOME = join(root, "forge614-home");
  try {
    await writeFile(executable, `#!${process.execPath}
if(process.argv[2]==='auth') { console.log('{"loggedIn":true,"authMethod":"claude.ai"}'); }
else {
  require('readline').createInterface({input:process.stdin}).on('line',line=>{
    const msg=JSON.parse(line);
    if(msg.type==='control_request') console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,response:{models:[],account:{email:'test@example.com'},commands:[],agents:[],output_style:'default',available_output_styles:[]}}}));
  });
}`, { mode: 0o755 });
    ui = startClaudeUI([], executable, terminal); await tick();
    for (let i = 0; i < 60 && !terminal.output.includes("test@example.com"); i++) await tick();
    enter("/logout"); await tick();
    expect(plain()).toContain(getCatalog("en").logout.confirmPrompt({ engine: "Claude Code" }).slice(0, 30));
    expect(plain()).toContain("› Yes");
    expect(plain()).not.toContain("Sign out");
    terminal.input("\r");
    // The card wraps a long sentence across rows, so the check reads its start.
    const confirmed = getCatalog("en").claudeChat.disconnectedLocally.slice(0, 40);
    for (let i = 0; i < 30 && !plain().includes(confirmed); i++) await tick();
    expect(plain()).toContain(confirmed);
  } finally {
    enter("/quit!"); await ui; await rm(root, { recursive: true, force: true });
    if (previousForgeHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousForgeHome;
  }
});
