import { isAbsolute, join } from "node:path";

export interface LaunchOptions {
  home: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  executable: string;
  piEntry: string;
  extension: string;
  args: string[];
}

export function createLaunch(options: LaunchOptions): {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
} {
  const profile = options.env.FORGE614_SHELL_HOME ?? join(options.home, ".forge614-shell");
  if (!isAbsolute(profile)) {
    throw new Error("FORGE614_SHELL_HOME must be an absolute path.");
  }

  return {
    command: options.executable,
    args: [
      options.piEntry,
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
      "--extension", options.extension,
      ...options.args,
    ],
    cwd: options.cwd,
    env: {
      ...options.env,
      PI_CODING_AGENT_DIR: join(profile, "agent"),
      // Let Pi partition sessions by cwd inside our agent profile.
      PI_CODING_AGENT_SESSION_DIR: undefined,
    },
  };
}
