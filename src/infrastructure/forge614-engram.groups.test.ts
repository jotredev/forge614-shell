import { expect, test } from "bun:test";
import { bindEngramFolder, bindEngramGroup, createEngramGroup, listEngramGroups } from "./forge614-engram.ts";
import type { RunEngram } from "./forge614-engram.ts";
import { describeError, ShellError } from "../shell-error.ts";

const GROUP_ID = "b1f1f1f1-0000-4000-8000-000000000001";
const PROJECT_ID = "a2a2a2a2-0000-4000-8000-000000000002";

function stub(stdout: unknown, calls: string[][] = []): RunEngram {
  return async (_command, args) => { calls.push(args); return { status: 0, stdout: JSON.stringify(stdout), stderr: "" }; };
}
const options = (run: RunEngram) => ({ home: "/Users/tester", run });

test("listEngramGroups sends group-list and reads groups with their projects, tolerating extra fields", async () => {
  const calls: string[][] = [];
  const groups = await listEngramGroups(options(stub({
    schemaVersion: 1, future: true,
    groups: [
      { id: GROUP_ID, name: "mi-tienda", createdAt: "2026-01-01T00:00:00Z", extra: 1, projects: [{ projectId: PROJECT_ID, name: "frontend", extra: true }] },
      { id: "c3", name: "vacio" },
    ],
  }, calls)));
  expect(calls).toEqual([["group-list"]]);
  expect(groups).toEqual([
    { id: GROUP_ID, name: "mi-tienda", projects: [{ projectId: PROJECT_ID, name: "frontend" }] },
    { id: "c3", name: "vacio", projects: [] },
  ]);
});

test("listEngramGroups accepts an empty list", async () => {
  expect(await listEngramGroups(options(stub({ schemaVersion: 1, groups: [] })))).toEqual([]);
});

test.each([
  ["not an object", "x"],
  ["no groups array", { schemaVersion: 1 }],
  ["a group without an id", { schemaVersion: 1, groups: [{ name: "a" }] }],
  ["a group with a non-text name", { schemaVersion: 1, groups: [{ id: "1", name: 5 }] }],
  ["projects that are not a list", { schemaVersion: 1, groups: [{ id: "1", name: "a", projects: "x" }] }],
  ["a project without a name", { schemaVersion: 1, groups: [{ id: "1", name: "a", projects: [{ projectId: "p" }] }] }],
])("listEngramGroups rejects %s with a typed, translatable error", async (_label, payload) => {
  const error = await listEngramGroups(options(stub(payload))).catch(e => e);
  expect(error).toBeInstanceOf(ShellError);
  expect((error as ShellError).code).toBe("ENGRAM_GROUP_LIST_INVALID");
  expect(describeError(error, "es")).toContain("group-list");
});

test("bindEngramFolder sends init --json --directory and returns the project id and any notices", async () => {
  const calls: string[][] = [];
  const result = await bindEngramFolder("/work/tienda", options(stub({
    project: { projectId: PROJECT_ID, directory: "/work/tienda", source: "path" },
    notices: [{ code: "DATABASE_MIGRATED", message: "x", backup: "/b.bak" }],
  }, calls)));
  expect(calls).toEqual([["init", "--json", "--directory", "/work/tienda"]]);
  expect(result).toEqual({ projectId: PROJECT_ID, notices: [{ code: "DATABASE_MIGRATED", backup: "/b.bak" }] });
});

test("bindEngramFolder rejects a result without a project id", async () => {
  const error = await bindEngramFolder("/work/tienda", options(stub({ project: {} }))).catch(e => e);
  expect((error as ShellError).code).toBe("ENGRAM_GROUP_RESULT_INVALID");
  expect((error as ShellError).params.command).toBe("init");
});

test("createEngramGroup sends group-create --name and returns the new group id and name", async () => {
  const calls: string[][] = [];
  const result = await createEngramGroup("mi-tienda", options(stub({
    schemaVersion: 1, group: { id: GROUP_ID, name: "mi-tienda", createdAt: "2026-01-01T00:00:00Z" },
    notices: [{ code: "DATABASE_MIGRATED", backup: "/b.bak" }],
  }, calls)));
  expect(calls).toEqual([["group-create", "--name", "mi-tienda"]]);
  expect(result).toEqual({ groupId: GROUP_ID, name: "mi-tienda", notices: [{ code: "DATABASE_MIGRATED", backup: "/b.bak" }] });
});

test("createEngramGroup rejects a result without a group id", async () => {
  const error = await createEngramGroup("mi-tienda", options(stub({ schemaVersion: 1, group: { name: "x" } }))).catch(e => e);
  expect((error as ShellError).code).toBe("ENGRAM_GROUP_RESULT_INVALID");
});

test("bindEngramGroup sends group-bind with the group id (never its name) and returns notices", async () => {
  const calls: string[][] = [];
  const result = await bindEngramGroup(PROJECT_ID, GROUP_ID, options(stub({
    schemaVersion: 1, projectId: PROJECT_ID, group: { id: GROUP_ID, name: "mi-tienda" }, changed: true, identityFilesUpdated: 1,
    notices: [{ code: "PROJECT_REBOUND_FROM_FILE" }],
  }, calls)));
  expect(calls).toEqual([["group-bind", "--project-id", PROJECT_ID, "--group", GROUP_ID]]);
  expect(result.notices).toEqual([{ code: "PROJECT_REBOUND_FROM_FILE" }]);
});

test("Engram's own failure (for example GROUP_EXISTS) surfaces its literal message inside the typed command error", async () => {
  const run: RunEngram = async () => ({ status: 1, stdout: "", stderr: JSON.stringify({ schemaVersion: 1, code: "GROUP_EXISTS", error: "Ya existe un grupo con ese nombre." }) });
  const error = await createEngramGroup("mi-tienda", options(run)).catch(e => e);
  expect((error as ShellError).code).toBe("engram-command-failed");
  expect(describeError(error, "es")).toContain("Ya existe un grupo con ese nombre.");
});

test("a missing binary is reported as unavailable, like every other Engram call", async () => {
  const run: RunEngram = async () => ({ status: null, stdout: "", stderr: "" });
  const error = await listEngramGroups(options(run)).catch(e => e);
  expect((error as ShellError).code).toBe("engram-unavailable-at-path");
});
