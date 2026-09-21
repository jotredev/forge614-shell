import { expect, test } from "bun:test";
import { applyEngramInit, locateEngramBinary } from "./forge614-engram.ts";

test("runs init --json only when PostgreSQL and reinforcement are both disabled", async () => {
  const calls: string[][] = [];
  const result = await applyEngramInit(
    { postgresUrl: null, reinforcement: false },
    {
      home: "/Users/tester",
      run: async (command, args) => {
        calls.push([command, ...args]);
        return { status: 0, stdout: JSON.stringify({ initialized: true, storage: "sqlite" }), stderr: "" };
      },
    },
  );
  expect(calls).toEqual([["/Users/tester/.forge614/engram/bin/forge614-engram", "init", "--json"]]);
  expect(result).toEqual({ initResult: { initialized: true, storage: "sqlite" }, reinforcementResult: null });
});

test("adds --postgres-url to the same init call when PostgreSQL is enabled", async () => {
  const calls: string[][] = [];
  await applyEngramInit(
    { postgresUrl: "postgres://user:secret@host/db", reinforcement: false },
    {
      home: "/Users/tester",
      run: async (command, args) => { calls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; },
    },
  );
  expect(calls).toEqual([[
    "/Users/tester/.forge614/engram/bin/forge614-engram", "init", "--json", "--postgres-url", "postgres://user:secret@host/db",
  ]]);
});

test("runs reinforcement-enable after init when reinforcement is enabled", async () => {
  const calls: string[][] = [];
  const result = await applyEngramInit(
    { postgresUrl: null, reinforcement: true },
    {
      home: "/Users/tester",
      run: async (command, args) => {
        calls.push([command, ...args]);
        return {
          status: 0,
          stdout: args.includes("reinforcement-enable")
            ? JSON.stringify({ enabled: true, schema: 7 })
            : JSON.stringify({ initialized: true }),
          stderr: "",
        };
      },
    },
  );
  expect(calls).toEqual([
    ["/Users/tester/.forge614/engram/bin/forge614-engram", "init", "--json"],
    ["/Users/tester/.forge614/engram/bin/forge614-engram", "reinforcement-enable"],
  ]);
  expect(result.reinforcementResult).toEqual({ enabled: true, schema: 7 });
});

test("does not call reinforcement-enable when init fails, and surfaces Engram's own error", async () => {
  const calls: string[][] = [];
  await expect(applyEngramInit(
    { postgresUrl: "postgres://bad", reinforcement: true },
    {
      home: "/Users/tester",
      run: async (command, args) => {
        calls.push([command, ...args]);
        return { status: 1, stdout: "", stderr: JSON.stringify({ code: "POSTGRES_UNAVAILABLE", error: "No se pudo conectar a PostgreSQL." }) };
      },
    },
  )).rejects.toThrow("forge614-engram init failed: No se pudo conectar a PostgreSQL.");
  expect(calls).toEqual([["/Users/tester/.forge614/engram/bin/forge614-engram", "init", "--json", "--postgres-url", "postgres://bad"]]);
});

test("a reinforcement-enable failure names that command and says init already succeeded", async () => {
  const error = await applyEngramInit(
    { postgresUrl: null, reinforcement: true },
    {
      home: "/Users/tester",
      run: async (_command, args) => args.includes("reinforcement-enable")
        ? { status: 1, stdout: "", stderr: JSON.stringify({ code: "SCHEMA_ERROR", error: "No se pudo habilitar el refuerzo." }) }
        : { status: 0, stdout: "{}", stderr: "" },
    },
  ).catch((thrown: Error) => thrown);
  expect((error as Error).message).toContain("forge614-engram reinforcement-enable failed: No se pudo habilitar el refuerzo.");
  expect((error as Error).message).toContain("Local memory initialization completed successfully");
});

test("a binary that cannot be spawned reports Engram as unavailable, not a generic failure", async () => {
  const error = await applyEngramInit(
    { postgresUrl: null, reinforcement: false },
    { home: "/Users/tester", run: async () => ({ status: null, stdout: "", stderr: "" }) },
  ).catch((thrown: Error) => thrown);
  expect((error as Error).message).toBe(
    "Forge614 Engram is unavailable at /Users/tester/.forge614/engram/bin/forge614-engram. Install or reinstall Forge614 Engram to repair this dependency.",
  );
  expect((error as Error).message).not.toContain("Forge614 Engram command failed.");
});

test("an error echoing the connection string back is redacted before it can propagate", async () => {
  const postgresUrl = "postgres://user:sup3rsecret@host:5432/db";
  const error = await applyEngramInit(
    { postgresUrl, reinforcement: true },
    {
      home: "/Users/tester",
      run: async () => ({
        status: 1,
        stdout: "",
        stderr: JSON.stringify({ code: "POSTGRES_UNAVAILABLE", error: `No se pudo conectar a ${postgresUrl}.` }),
      }),
    },
  ).catch((thrown: Error) => thrown);
  expect((error as Error).message).not.toContain(postgresUrl);
  expect((error as Error).message).not.toContain("sup3rsecret");
  expect((error as Error).message).toContain("********");
});

test("a reinforcement-enable failure echoing the connection string back is redacted before it can propagate", async () => {
  const postgresUrl = "postgres://user:sup3rsecret@host:5432/db";
  const error = await applyEngramInit(
    { postgresUrl, reinforcement: true },
    {
      home: "/Users/tester",
      run: async (_command, args) => args.includes("reinforcement-enable")
        ? {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({ code: "SCHEMA_ERROR", error: `No se pudo habilitar el refuerzo para ${postgresUrl}.` }),
        }
        : { status: 0, stdout: "{}", stderr: "" },
    },
  ).catch((thrown: Error) => thrown);
  expect((error as Error).message).not.toContain(postgresUrl);
  expect((error as Error).message).not.toContain("sup3rsecret");
  expect((error as Error).message).toContain("********");
  expect((error as Error).message).toContain("Local memory initialization completed successfully");
});

test("respects FORGE614_HOME when locating the Engram binary", async () => {
  const calls: string[][] = [];
  await applyEngramInit(
    { postgresUrl: null, reinforcement: false },
    { env: { FORGE614_HOME: "/custom/forge" } as NodeJS.ProcessEnv, run: async (command, args) => { calls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; } },
  );
  expect(calls[0]![0]).toBe("/custom/forge/engram/bin/forge614-engram");
});

test("rejects a result Engram did not report as JSON", async () => {
  await expect(applyEngramInit(
    { postgresUrl: null, reinforcement: false },
    { home: "/Users/tester", run: async () => ({ status: 0, stdout: "not json", stderr: "" }) },
  )).rejects.toThrow("invalid result");
});

test("locateEngramBinary resolves under the given home by default", () => {
  expect(locateEngramBinary("/Users/tester")).toBe("/Users/tester/.forge614/engram/bin/forge614-engram");
});

test("locateEngramBinary honors FORGE614_HOME over the given home", () => {
  expect(locateEngramBinary("/Users/tester", { FORGE614_HOME: "/custom/forge" } as NodeJS.ProcessEnv)).toBe(
    "/custom/forge/engram/bin/forge614-engram",
  );
});

import { updateEngram } from "./forge614-engram.ts";

test("updateEngram sends update --json and reads the result", async () => {
  const calls: string[][] = [];
  const result = await updateEngram({
    home: "/Users/tester",
    run: async (command, args) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: JSON.stringify({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" }), stderr: "" };
    },
  });
  expect(calls).toEqual([["/Users/tester/.forge614/engram/bin/forge614-engram", "update", "--json"]]);
  expect(result).toEqual({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" });
});

test("updateEngram reports already up to date when previous and installed versions match", async () => {
  const result = await updateEngram({
    home: "/Users/tester",
    run: async () => ({ status: 0, stdout: JSON.stringify({ updated: false, previousVersion: "1.4.0", installedVersion: "1.4.0" }), stderr: "" }),
  });
  expect(result).toEqual({ updated: false, previousVersion: "1.4.0", installedVersion: "1.4.0" });
});

test("updateEngram throws Engram's own safe message on failure, reading it from stderr", async () => {
  await expect(updateEngram({
    home: "/Users/tester",
    run: async () => ({ status: 1, stdout: "", stderr: JSON.stringify({ code: "UPDATE_FAILED", error: "No se pudo actualizar Forge614 Engram." }) }),
  })).rejects.toThrow("forge614-engram update failed: No se pudo actualizar Forge614 Engram.");
});

test("updateEngram never leaks installer progress text mixed into stdout ahead of the JSON", async () => {
  // Real forge614-engram update --json suppresses installer output when quiet, but this test locks
  // in what happens if that guarantee is ever violated: stdout is parsed as JSON outright, not
  // scanned for a trailing object, so leading text makes the whole payload fail to parse rather
  // than silently finding and trusting the "real" JSON — installer text can never leak through.
  const error = await updateEngram({
    home: "/Users/tester",
    run: async () => ({
      status: 0,
      stdout: `Downloading forge614-engram 1.4.0...\n${JSON.stringify({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" })}`,
      stderr: "",
    }),
  }).catch((thrown: Error) => thrown);
  expect((error as Error).message).toBe("forge614-engram update returned an invalid result.");
  expect((error as Error).message).not.toContain("Downloading");
});

test("updateEngram rejects a malformed result instead of guessing its shape", async () => {
  await expect(updateEngram({
    home: "/Users/tester",
    run: async () => ({ status: 0, stdout: JSON.stringify({ updated: true }), stderr: "" }),
  })).rejects.toThrow("forge614-engram update returned an invalid result.");
});
