import { afterEach, expect, it, vi } from "vitest";
import { BrowserRpcProvider, RpcUnavailableError } from "./rpcProvider";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const reply = (value: unknown) => new Response(JSON.stringify({ result: value }));

it("paces concurrent reads and coalesces identical in-flight checks across clients without caching completed reads", async () => {
  vi.useFakeTimers();
  const starts: number[] = [];
  const fetch = vi.fn(async () => { starts.push(Date.now()); return reply({ value: 1 }); });
  vi.stubGlobal("fetch", fetch);
  const a = new BrowserRpcProvider(["https://pace.test"]), b = new BrowserRpcProvider(["https://pace.test"]);
  const calls = [a.call("chain.read_contract", { args: "A" }), b.call("chain.read_contract", { args: "A" }), a.call("chain.read_contract", { args: "B" })];
  await vi.runAllTimersAsync();
  expect(await Promise.all(calls)).toEqual([{ value: 1 }, { value: 1 }, { value: 1 }]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(400);
  const fresh = a.call("chain.read_contract", { args: "A" }); await vi.runAllTimersAsync(); await fresh;
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("honors 429 Retry-After across queued checks and resumes after cooldown", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": "30" } })).mockImplementation(async () => reply({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  const a = new BrowserRpcProvider(["https://rate.test"]);
  const result = Promise.allSettled([a.call("chain.read_contract", { args: "A" }), a.call("chain.read_contract", { args: "B" })]);
  await vi.runAllTimersAsync();
  const rejected = await result;
  expect(rejected.every(r => r.status === "rejected" && r.reason instanceof RpcUnavailableError)).toBe(true);
  expect(fetch).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30_000);
  const recovered = a.call("chain.read_contract", { args: "A" }); await vi.runAllTimersAsync();
  expect(await recovered).toEqual({ ok: true });
});

it("opens the circuit for CORS-hidden failures and never automatically replays a transaction", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")); vi.stubGlobal("fetch", fetch);
  const provider = new BrowserRpcProvider(["https://cors.test"]);
  const result = Promise.allSettled([provider.call("chain.submit_transaction", { transaction: { id: "signed" } }), provider.call("chain.read_contract", {})]);
  await vi.runAllTimersAsync();
  expect((await result).every(r => r.status === "rejected" && r.reason instanceof RpcUnavailableError)).toBe(true);
  expect(fetch).toHaveBeenCalledOnce();
});

it("preserves authoritative contract errors without treating them as rate limits", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "invalid account nonce" } }))).mockImplementation(async () => reply({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  const provider = new BrowserRpcProvider(["https://contract.test"]);
  const first = expect(provider.call("chain.submit_transaction", {})).rejects.toThrow("invalid account nonce"); await vi.runAllTimersAsync(); await first;
  const second = provider.call("chain.read_contract", {}); await vi.runAllTimersAsync(); expect(await second).toEqual({ ok: true });
});

it("moves subsequent requests to a configured alternate without replaying an uncertain write", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockImplementation(async () => reply({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  const provider = new BrowserRpcProvider(["https://failover-one.test", "https://failover-two.test"]);
  const write = expect(provider.call("chain.submit_transaction", { signed: true })).rejects.toBeInstanceOf(RpcUnavailableError);
  await vi.runAllTimersAsync(); await write; expect(fetch).toHaveBeenCalledOnce();
  const read = provider.call("chain.read_contract", {}); await vi.runAllTimersAsync(); expect(await read).toEqual({ ok: true });
  expect(fetch.mock.calls[1]![0]).toBe("https://failover-two.test");
});

it("fails a throttled read over immediately, skips cooldowns and returns to the primary after recovery", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockImplementation(async (url: string) => url.includes('primary') && Date.now() < 30_000 ? new Response('busy', {status:429,headers:{'retry-after':'30'}}) : reply({node:url}));
  vi.setSystemTime(0); vi.stubGlobal('fetch', fetch);
  const provider = new BrowserRpcProvider(['https://primary-read.test','https://backup-read.test']);
  const first=provider.call('chain.read_contract',{args:'one'}); await vi.runAllTimersAsync(); expect(await first).toEqual({node:'https://backup-read.test'});
  const second=provider.call('chain.read_contract',{args:'two'}); await vi.runAllTimersAsync(); expect(await second).toEqual({node:'https://backup-read.test'});
  expect(fetch.mock.calls.filter(c=>c[0]==='https://primary-read.test')).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(30_000);
  const recovered=provider.call('chain.read_contract',{args:'three'}); await vi.runAllTimersAsync(); expect(await recovered).toEqual({node:'https://primary-read.test'});
});

it("rejects the wrong network before using a backup's data", async () => {
  vi.useFakeTimers();
  const fetch=vi.fn(async (url:string,init:RequestInit)=>{
    const {method}=JSON.parse(init.body as string);
    return reply(method==='chain.get_chain_id'?{chain_id:url.includes('wrong')?'testnet':'mainnet'}:{value:'verified'});
  }); vi.stubGlobal('fetch',fetch);
  const provider=new BrowserRpcProvider(['https://wrong-chain.test','https://right-chain.test'],'mainnet');
  const result=provider.call('chain.read_contract',{args:'private keys'}); await vi.runAllTimersAsync(); expect(await result).toEqual({value:'verified'});
  expect(fetch.mock.calls.filter(([url,init])=>url.includes('wrong')&&JSON.parse(init.body as string).method==='chain.read_contract')).toHaveLength(0);
});

it("never retries a read with an authoritative contract rejection on another node", async () => {
  vi.useFakeTimers(); const fetch=vi.fn(async()=>new Response(JSON.stringify({error:{message:'access denied',data:JSON.stringify({logs:['private group']})}})));
  vi.stubGlobal('fetch',fetch); const provider=new BrowserRpcProvider(['https://authoritative-one.test','https://authoritative-two.test']);
  const check=expect(provider.call('chain.read_contract',{})).rejects.toThrow('access denied'); await vi.runAllTimersAsync(); await check; expect(fetch).toHaveBeenCalledOnce();
});
