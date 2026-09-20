import { spawn } from "node:child_process";
import { JsonRpcPeer } from "../infrastructure/rpc.ts";

export function nativeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const pattern = /^(OPENAI_API_KEY|CODEX_API_KEY|CODEX_ACCESS_TOKEN|OPENAI_BASE_URL|OPENAI_CUSTOM_HEADERS|CODEX_AUTH_JSON|CODEX_AUTH_TOKEN)$/i;
  const overrides = Object.keys(env).filter(key => env[key] && pattern.test(key));
  if (overrides.length) throw new Error(`Subscription mode refuses routing overrides: ${overrides.join(", ")}. Unset them in this terminal; Shell will not change your account.`);
  return { ...env };
}

export function startNativeProcess(id: "codex", executable: string, cwd: string, env: NodeJS.ProcessEnv, diagnostic: (text: string) => void) {
  const args = ["app-server", "-c", 'model_provider="openai"', "-c", 'forced_login_method="chatgpt"'];
  const nodeEntry = /\.m?js$/i.test(executable);
  const child = spawn(nodeEntry ? process.execPath : executable, nodeEntry ? [executable, ...args] : args, { cwd, env: nativeEnvironment(env), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const rpc = new JsonRpcPeer(child.stdout, child.stdin, false);
  // Do not print raw engine logs: they can contain private settings or credentials.
  child.stderr.resume();
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
