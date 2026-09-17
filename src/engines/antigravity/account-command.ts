import { spawn } from "node:child_process";

type Options = { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal; timeout?: number; maxBuffer?: number };

// Account probes must not inherit a controlling terminal: native print mode can
// otherwise launch interactive login after logout. This child is still awaited
// and terminated on cancellation/timeout; it is not a background agent.
export async function runAccountCommand(file: string, args: string[], options: Options): Promise<{ stdout: string }> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: options.cwd, env: options.env, detached: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      failure ??= new Error("Account command stopped.");
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 2000); killTimer.unref();
    };
    const timer = setTimeout(stop, options.timeout ?? 15000); timer.unref();
    options.signal?.addEventListener("abort", stop, { once: true });
    if (options.signal?.aborted) stop();
    const collect = (chunk: string, error: boolean) => {
      if (failure) return;
      if (error) stderr += chunk; else stdout += chunk;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > (options.maxBuffer ?? 65536)) stop();
    };
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => collect(chunk, false));
    child.stderr.on("data", chunk => collect(chunk, true));
    child.once("error", () => { failure ??= new Error("Account command could not start."); });
    child.once("close", code => {
      clearTimeout(timer); if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", stop);
      if (failure) reject(failure);
      else if (code !== 0) reject(Object.assign(new Error("Account command failed."), { stderr }));
      else resolve({ stdout });
    });
  });
}
