import { spawn } from "node:child_process";
import { JsonRpcPeer } from "../infrastructure/rpc.ts";
import type { NativeId } from "./types.ts";
import { GeminiLoginFeedback } from "./gemini/login-feedback.ts";

export function nativeEnvironment(id: NativeId, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const pattern = id === "codex"
    ? /^(OPENAI_API_KEY|CODEX_API_KEY|CODEX_ACCESS_TOKEN|OPENAI_BASE_URL|OPENAI_CUSTOM_HEADERS|CODEX_AUTH_JSON|CODEX_AUTH_TOKEN)$/i
    : /^(GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENAI_USE_VERTEXAI|GOOGLE_GENAI_USE_GCA|GOOGLE_GEMINI_BASE_URL|GOOGLE_VERTEX_BASE_URL|GEMINI_API_BASE_URL|GOOGLE_APPLICATION_CREDENTIALS)$/i;
  const overrides = Object.keys(env).filter(key => env[key] && pattern.test(key));
  if (overrides.length) throw new Error(`Subscription mode refuses routing overrides: ${overrides.join(", ")}. Unset them in this terminal; Shell will not change your account.`);
  const result = { ...env };
  if (id === "gemini") {
    // Gemini loads .env after startup, but does not replace keys already present.
    // Pin alternate billing routes empty in the child only; leave project files intact.
    for (const key of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_GENAI_USE_GCA", "GOOGLE_GEMINI_BASE_URL", "GOOGLE_VERTEX_BASE_URL", "GEMINI_API_BASE_URL", "GOOGLE_APPLICATION_CREDENTIALS"]) result[key] = "";
  }
  return result;
}

export function startNativeProcess(id: "codex" | "gemini", executable: string, cwd: string, env: NodeJS.ProcessEnv, diagnostic: (text: string) => void) {
  const args = id === "codex"
    ? ["app-server", "-c", 'model_provider="openai"', "-c", 'forced_login_method="chatgpt"']
    : ["--acp", "--approval-mode", "default"];
  const nodeEntry = /\.m?js$/i.test(executable);
  const child = spawn(nodeEntry ? process.execPath : executable, nodeEntry ? [executable, ...args] : args, { cwd, env: nativeEnvironment(id, env), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const rpc = new JsonRpcPeer(child.stdout, child.stdin, id === "gemini");
  // Do not print raw engine logs: they can contain private settings or credentials.
  if (id === "gemini") {
    let feedback: GeminiLoginFeedback | undefined;
    const request = rpc.request.bind(rpc);
    rpc.request = async (method, params, timeout) => {
      if (method !== "authenticate") return request(method, params, timeout);
      feedback = new GeminiLoginFeedback(diagnostic);
      try { return await request(method, params, timeout); }
      finally { feedback = undefined; }
    };
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => feedback?.write(chunk));
  } else child.stderr.resume();
  child.once("error", () => { diagnostic(`Could not launch ${id}. Check its installation.`); rpc.close(); });
  child.once("exit", code => { if (code) diagnostic(`${id} exited with code ${code}.`); rpc.close(); });
  let stopping = false;
  const stopProcess = () => {
    if (stopping) return;
    stopping = true;
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 2000);
      timer.unref(); child.once("exit", () => clearTimeout(timer));
    }
  };
  child.stdin.once("finish", stopProcess);
  const closePeer = rpc.close.bind(rpc);
  rpc.close = () => { closePeer(); stopProcess(); };
  return rpc;
}
