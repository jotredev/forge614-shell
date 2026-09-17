import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { JsonRpcPeer } from "./rpc.ts";

test("RPC correlates fragmented replies and routes server permission requests", async () => {
  const input = new PassThrough(); const output = new PassThrough();
  const sent: any[] = []; output.on("data", data => sent.push(JSON.parse(String(data))));
  const rpc = new JsonRpcPeer(input, output, true);
  rpc.onRequest = async (method, params) => ({ allowed: method === "permission" && params.safe });
  const result = rpc.request("initialize", { protocolVersion: 1 });
  expect(sent[0]).toEqual({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
  input.write('{"id":1,"result":'); input.write('{"ready":true}}\n');
  expect(await result).toEqual({ ready: true });
  input.write('{"id":"p","method":"permission","params":{"safe":false}}\n');
  await new Promise(resolve => setImmediate(resolve));
  expect(sent[1]).toEqual({ jsonrpc: "2.0", id: "p", result: { allowed: false } });
  rpc.close();
});

test("RPC rejects pending requests on process EOF and times out unanswered requests", async () => {
  const input = new PassThrough(); const output = new PassThrough();
  const rpc = new JsonRpcPeer(input, output, false);
  const timeout = rpc.request("slow", {}, 5);
  await expect(timeout).rejects.toThrow("timed out");
  const pending = rpc.request("waiting", {});
  input.end();
  await expect(pending).rejects.toThrow("closed");
  await expect(rpc.request("again", {})).rejects.toThrow("closed");
});

test("a timed-out or malformed transport closes stdin so no orphan operation can keep running", async () => {
  for (const kind of ["timeout", "malformed"]) {
    const input = new PassThrough(); const output = new PassThrough();
    const rpc = new JsonRpcPeer(input, output, false);
    const result = rpc.request("start", {}, kind === "timeout" ? 5 : 1000);
    if (kind === "malformed") input.write("not JSON\n");
    await expect(result).rejects.toThrow();
    expect(output.writableEnded).toBe(true);
    await expect(rpc.request("next")).rejects.toThrow("closed");
  }
});
