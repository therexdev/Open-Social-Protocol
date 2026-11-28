import { afterEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { JsonRpcProvider } from "./jsonRpcProvider.js";
import { ProtocolClient } from "./protocolClient.js";
import { fixtureDeployment } from "../testing/fixtures.js";
afterEach(() => vi.unstubAllGlobals());

it("sends JSON headers to a strict HTTP gateway through the default SDK client", async () => {
  const calls: string[] = [];
  const server = createServer((request, response) => {
    if (request.headers["content-type"] !== "application/json") {
      response.writeHead(415, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: { message: "Use application/json" } })); return;
    }
    let raw = "";
    request.setEncoding("utf8"); request.on("data", chunk => { raw += chunk; });
    request.on("end", () => {
      const body = JSON.parse(raw); calls.push(body.method);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { chain_id: "strict-chain" } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); if (!address || typeof address === "string") throw Error("No server port");
    const deployment = fixtureDeployment(); deployment.rpc = [`http://127.0.0.1:${address.port}`];
    const client = new ProtocolClient({ deployment });
    expect(await client.provider.getChainId()).toBe("strict-chain"); expect(calls).toEqual(["chain.get_chain_id"]);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

it("fails a transport-limited read over in configured order", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 429 })).mockResolvedValueOnce(new Response(JSON.stringify({ result: { chain_id: "mainnet" } })));
  vi.stubGlobal("fetch", fetch);
  const provider = new JsonRpcProvider(["https://primary.test", "https://backup.test"]);
  expect(await provider.getChainId()).toBe("mainnet");
  expect(fetch.mock.calls.map(call => call[0])).toEqual(["https://primary.test", "https://backup.test"]);
});

it("does not replay an uncertain signed transaction on a backup", async () => {
  const fetch = vi.fn().mockRejectedValue(Error("connection closed after submit")); vi.stubGlobal("fetch", fetch);
  const provider = new JsonRpcProvider(["https://primary.test", "https://backup.test"]);
  await expect(provider.call("chain.submit_transaction", { transaction: { id: "signed" } })).rejects.toThrow("connection closed");
  expect(fetch).toHaveBeenCalledOnce();
});

it("preserves contract error data and never retries an authoritative rejection", async () => {
  const data = { logs: ["invalid account nonce"], receipt: { reverted: true } };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "transaction reverted", data: JSON.stringify(data) } }))); vi.stubGlobal("fetch", fetch);
  const provider = new JsonRpcProvider(["https://primary.test", "https://backup.test"]);
  await expect(provider.call("chain.read_contract", {})).rejects.toThrow(JSON.stringify({ error: "transaction reverted", ...data }));
  expect(fetch).toHaveBeenCalledOnce();
});
