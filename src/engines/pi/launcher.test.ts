import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import * as launcher from "./launcher.ts";

// Removing the dedicated profile or cwd propagation must break these contracts.

describe("isolated Pi launch", () => {
  test("keeps the selected worktree and uses Shell's profile, not ambient Pi's", () => {
    expect(launcher.createLaunch).toBeFunction();
    const env = { PATH: "/usr/bin", PI_CODING_AGENT_DIR: "/personal/pi", PI_CODING_AGENT_SESSION_DIR: "/personal/sessions", KEEP_ME: "yes" };
    const result = launcher.createLaunch({
      home: "/users/test", cwd: "/work/a worktree", env,
      executable: "/runtime/node", piEntry: "/deps/pi/cli.js",
      extension: "/shell/extensions/forge614-shell.ts", args: ["--resume"],
    });
    expect(result.cwd).toBe("/work/a worktree");
    expect(result.env.PI_CODING_AGENT_DIR).toBe(join("/users/test", ".forge614-shell", "agent"));
    expect(result.env.PI_CODING_AGENT_SESSION_DIR).toBeUndefined();
    expect(env.PI_CODING_AGENT_DIR).toBe("/personal/pi");
    expect(result.env.KEEP_ME).toBe("yes");
    expect(result.command).toBe("/runtime/node");
    expect(result.args).toContain("/deps/pi/cli.js");
    expect(result.args).toContain("/shell/extensions/forge614-shell.ts");
    expect(result.args).toContain("--resume");
    expect(result.args).toContain("--no-extensions");
  });

  test("allows a dedicated absolute Shell profile for portable use", () => {
    expect(launcher.createLaunch).toBeFunction();
    const result = launcher.createLaunch({
      home: "/users/test", cwd: "/work/project",
      env: { FORGE614_SHELL_HOME: "/profiles/forge" },
      executable: "node", piEntry: "/deps/pi/cli.js", extension: "/shell/ext.ts", args: [],
    });
    expect(result.env.PI_CODING_AGENT_DIR).toBe(join("/profiles/forge", "agent"));
  });

  test("rejects relative profile paths so changing projects cannot change the profile", () => {
    expect(launcher.createLaunch).toBeFunction();
    expect(() => launcher.createLaunch({
      home: "/users/test", cwd: "/work/project", env: { FORGE614_SHELL_HOME: "relative" },
      executable: "node", piEntry: "/deps/pi/cli.js", extension: "/shell/ext.ts", args: [],
    })).toThrow("absolute");
  });
});
