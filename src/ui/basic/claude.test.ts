import { expect, test } from "bun:test";
import type { Terminal } from "@earendil-works/pi-tui";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { claudeMenuCommands, startClaudeUI } from "./claude.ts";
import { getCatalog } from "../../i18n/index.ts";
import { emptyTelemetry, telemetryLines } from "../../engines/claude/telemetry.ts";

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
    enter("/f614:quit"); await ui; await rm(root, { recursive: true, force: true });
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
    enter("/f614:quit"); await ui; await rm(root, { recursive: true, force: true });
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
    enter("/f614:quit"); await ui; await rm(root, { recursive: true, force: true });
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
    enter("/f614:quit"); await ui; process.chdir(previousCwd); await rm(root, { recursive: true, force: true });
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
    for (let i = 0; i < 60 && !plain().includes("▎ Sí"); i++) await tick();
    expect(plain()).toContain("Carpeta: …/another-long-folder-name-here/project");
    expect(plain()).not.toContain("a-long-folder-name-for-the-permission-card");
    terminal.input("\x1b");
    await tick();
  } finally {
    enter("/f614:quit"); await tick(); terminal.input("\x1b[B"); terminal.input("\r"); // the turn is still open: «¿Salir de todos modos?» → «Sí»
    await ui; process.chdir(previousCwd); await rm(root, { recursive: true, force: true });
    if (previousForgeHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousForgeHome;
  }
});

/**
 * The owner's rule: the marked «Yes» is only for the permissions the assistant asks; a question of Shell's own that disconnects goes out with «No» marked and its own
 * words. `/logout` shows «Disconnect Claude Code from this Shell?» with «No, stay connected» marked and «Yes, disconnect»; it never shows the permission card
 * («Permission requested», «Allow?») nor the turn footer. Enter alone and Esc keep the connection; only picking «Yes» disconnects. It exists because the question used to
 * go through the tool-permission path, with «Yes» marked. Runs in English and in Spanish.
 */
test.skipIf(process.platform === "win32")("Claude UI: the /logout question has its own words and «No» marked; Enter alone and Esc keep the connection, only «Yes» disconnects", async () => {
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
 * request and one `prompt:` line per chat prompt. With `rateLimit`, each prompt is also answered with that `rate_limit_event`
 * (the turn still stays open), and with `events`, each prompt is also answered with those messages (an `init`, say). `account` is what the handshake
 * reports. `beforeStart` runs with the `$FORGE614_HOME` of the test before the screen opens (to install a stand-in for Engines, whose startup-hook check runs at
 * opening). No real account or network is involved. `finish` leaves the screen and cleans up.
 */
async function claudeUi(commands: { name: string; description: string; argumentHint: string }[] = [], locale: "en" | "es" = "en", rateLimit?: object[], columns = 120, events: object[] = [], account: object = { email: "test@example.com" }, beforeStart?: (forgeHome: string) => void) {
  const root = await mkdtemp(join(tmpdir(), "forge614-prefix-ui-"));
  const executable = join(root, "claude"); const marker = join(root, "calls");
  const terminal = new TestTerminal(); terminal.columns = columns;
  const enter = (text: string) => { terminal.input(text); terminal.input("\r"); };
  const plain = () => stripVTControlCharacters(terminal.output);
  const previousForgeHome = process.env.FORGE614_HOME;
  process.env.FORGE614_HOME = join(root, "forge614-home");
  beforeStart?.(process.env.FORGE614_HOME);
  await writeFile(executable, `#!${process.execPath}
const fs=require('fs');
if(process.argv[2]==='auth') { console.log('{"loggedIn":true,"authMethod":"claude.ai"}'); }
else {
  require('readline').createInterface({input:process.stdin}).on('line',line=>{
    const msg=JSON.parse(line);
    if(msg.type==='control_request') { fs.appendFileSync(${JSON.stringify(marker)},'control\\n'); console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,response:{models:[],account:${JSON.stringify(account)},commands:${JSON.stringify(commands)},agents:[],output_style:'default',available_output_styles:[]}}})); }
    if(msg.type==='user') { fs.appendFileSync(${JSON.stringify(marker)},'prompt:'+JSON.stringify(msg.message.content)+'\\n'); for (const info of ${JSON.stringify(rateLimit ?? [])}) console.log(JSON.stringify({type:'rate_limit_event',rate_limit_info:info,uuid:'00000000-0000-4000-8000-000000000001',session_id:'s'})); for (const event of ${JSON.stringify(events)}) console.log(JSON.stringify(event)); }
  });
}`, { mode: 0o755 });
  const ui = startClaudeUI([], executable, terminal, undefined, locale);
  await tick();
  for (let i = 0; i < 60 && !terminal.output.includes("test@example.com"); i++) await tick();
  const calls = () => existsSync(marker) ? readFileSync(marker, "utf8").split("\n").filter(Boolean) : [];
  /**
   * Leaves through `/f614:quit`, or, with `byCtrlC`, through Esc and Ctrl+C (for a test that leaves text in the box), and puts the environment back.
   * When a turn is still open the screen asks «Quit anyway?»: this cleanup answers «Yes», so a test that leaves work running can still end.
   */
  const finish = async (byCtrlC = false) => {
    terminal.output = "";
    if (byCtrlC) { terminal.input("\x1b"); terminal.input("\x03"); } else enter("/f614:quit");
    await tick();
    if (plain().includes("▎ No")) { terminal.input("\x1b[B"); terminal.input("\r"); }
    await ui; await rm(root, { recursive: true, force: true });
    if (previousForgeHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousForgeHome;
  };
  return { terminal, enter, plain, ui, calls, finish };
}

/** Claude's opening transcript owns the sign too: it vanishes after the first person message and never returns after `/new`. */
test.skipIf(process.platform === "win32")("a new Claude chat removes the FORGE614 sign after its first person message and never restores it on new", async () => {
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
test.skipIf(process.platform === "win32")("a native Claude command sent as a turn removes the FORGE614 sign and it does not come back", async () => {
  const h = await claudeUi([{ name: "init", description: "Initialize", argumentHint: "" }]);
  try {
    expect(h.plain()).toContain("████████");
    h.enter("/init"); await tick();
    expect(h.calls().some(line => line.startsWith("prompt:") && line.includes("/init"))).toBe(true);
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
test.skipIf(process.platform === "win32")("while the Claude screen is open Node warnings do not reach stderr: the expected one is silent, another shows once in the chat", async () => {
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
test.skipIf(process.platform === "win32")("the Claude screen takes Node's warning printer while it is open and gives back the very same warning listeners on leaving", async () => {
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
test.skipIf(process.platform === "win32")("Claude UI: each Shell command answers to /f614:<name> and does what the old name did", async () => {
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
test.skipIf(process.platform === "win32")("Claude UI: the old unprefixed Shell names are unknown commands and send nothing", async () => {
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
test.skipIf(process.platform === "win32")("Claude UI: /status and /help answer with what Shell has, send nothing, and are forwarded when Claude Code lists them", async () => {
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
test.skipIf(process.platform === "win32")("Claude UI: /status before any message shows the account, folder and mode, and says what appears later", async () => {
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
test.skipIf(process.platform === "win32")("Claude UI: /status shows the version, session, API key and MCP servers from the init message, also mid-turn", async () => {
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
test.skipIf(process.platform === "win32")("Claude UI: /status after a confirmed /logout shows no account data", async () => {
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
test.skipIf(process.platform === "win32")("Claude UI: /status after /new drops the version and MCP servers until the first message", async () => {
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
test.skipIf(process.platform === "win32")("Claude UI: /help lists the menu's commands with their description and the shortcuts, in both languages", async () => {
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
test.skipIf(process.platform === "win32")("Claude UI: /help and /status wrap to the real width, under their own columns", async () => {
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
test.skipIf(process.platform === "win32")("Claude UI: /exit and /quit refuse while a turn runs and name /f614:quit, which asks first", async () => {
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
test.skipIf(process.platform === "win32")("Claude UI: /f614:quit, Ctrl+C and Ctrl+D leave when idle and ask first while a turn runs, with No marked", async () => {
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
test.skipIf(process.platform === "win32")("Claude UI: /f614:status shows plain limit names, a translated status and a readable reset, in es and en", async () => {
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
test.skipIf(process.platform === "win32")("Claude UI: the / menu keeps the assistant's own names and lists only /f614: commands under FORGE614", async () => {
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
test.skipIf(process.platform === "win32")("Claude UI: /f614:status says who delivers the memory, from the one detection of the run", async () => {
  const h = await claudeUi();
  try {
    h.terminal.output = ""; h.enter("/f614:status"); await tick(); await tick();
    expect(h.plain()).toContain("Memory: Shell pastes it");
    expect(h.plain()).not.toContain("delivers it at startup");
  } finally { await h.finish(); }
  const verification = { agentId: "claude-code", mcp: { path: "/x", present: true }, instructions: { supported: true, paths: [], present: true }, hook: { supported: true, path: "/x", present: true, dryRunOk: true, runtimeStatus: { kind: "runtime-observed" } }, overallStatus: "complete" };
  const installEngines = (forgeHome: string) => {
    const bin = join(forgeHome, "engines", "bin"); mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "forge614-engines"), `#!${process.execPath}\nconsole.log(JSON.stringify({schemaVersion:1,verification:${JSON.stringify(verification)}}));\n`, { mode: 0o755 });
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
