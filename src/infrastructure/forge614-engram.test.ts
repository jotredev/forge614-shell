import { expect, test } from "bun:test";
import { applyEngramInit } from "./forge614-engram.ts";

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
  )).rejects.toThrow("No se pudo conectar a PostgreSQL.");
  expect(calls).toEqual([["/Users/tester/.forge614/engram/bin/forge614-engram", "init", "--json", "--postgres-url", "postgres://bad"]]);
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
