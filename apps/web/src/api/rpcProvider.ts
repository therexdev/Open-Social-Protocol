import { Provider } from "@osp/sdk";

export class RpcUnavailableError extends Error {
  override name = "RpcUnavailableError";
  constructor(readonly retryAt: number) {
    super("The network is busy or temporarily unavailable. Please try again shortly.");
  }
}

// All clients in this browser share an endpoint's pacing and circuit breaker.
// Never cache completed reads: authorizations and finality must stay current.
type Gate = { tail: Promise<void>; next: number; retryAt: number; failures: number; chainId?: string; pending: Map<string, Promise<unknown>> };
const gates = new Map<string, Gate>();
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const readOnly = new Set(["chain.read_contract", "chain.get_head_info", "chain.get_chain_id", "chain.get_account_nonce", "chain.get_account_rc", "block_store.get_blocks_by_id", "block_store.get_blocks_by_height", "transaction_store.get_transactions_by_id", "mempool.get_pending_transactions"]);

/** koilib's browser transport otherwise starts every concurrent read immediately,
 * and a CORS-hidden 429 becomes an unhelpful, repeatedly retried TypeError. */
export class BrowserRpcProvider extends Provider {
  constructor(nodes: string[], private readonly expectedChainId?: string) {
    super([...new Set(nodes)]);
  }

  override async call<T = unknown>(method: string, params: unknown): Promise<T> {
    const candidates = this.rpcNodes.map((endpoint, index) => {
      let gate = gates.get(endpoint);
      if (!gate) { gate = { tail: Promise.resolve(), next: 0, retryAt: 0, failures: 0, pending: new Map() }; gates.set(endpoint, gate); }
      return { endpoint, gate, index };
    });
    // Prefer the primary again when its cooldown ends; skip unhealthy nodes.
    const available = candidates.filter(({ gate }) => Date.now() >= gate.retryAt);
    if (!available.length) throw new RpcUnavailableError(Math.min(...candidates.map(c => c.gate.retryAt)));
    let lastError: unknown;
    for (const { endpoint, gate, index } of available) {
      this.currentNodeId = index;
      const key = readOnly.has(method) ? JSON.stringify([this.expectedChainId, method, params]) : undefined;
      let task = key ? gate.pending.get(key) : undefined;
      if (!task) {
        task = gate.tail.then(async () => {
          // Each endpoint must identify the intended network before it supplies data.
          if (this.expectedChainId && gate.chainId !== this.expectedChainId) {
            const chain = await this.request<{ chain_id: string }>(endpoint, gate, "chain.get_chain_id", {});
            if (chain.chain_id !== this.expectedChainId) {
              gate.retryAt = Date.now() + 300_000;
              throw new RpcUnavailableError(gate.retryAt);
            }
            gate.chainId = chain.chain_id;
            if (method === "chain.get_chain_id") return chain;
          }
          return this.request<T>(endpoint, gate, method, params);
        });
        gate.tail = task.then(() => {}, () => {});
        if (key) gate.pending.set(key, task);
      }
      try { return structuredClone(await task) as T; }
      catch (error) {
        lastError = error;
        // Retry only explicit reads on transport failure. A write may already
        // have reached a node and must use transaction reconciliation instead.
        if (!(error instanceof RpcUnavailableError) || !readOnly.has(method)) throw error;
      } finally { if (key && gate.pending.get(key) === task) gate.pending.delete(key); }
    }
    throw lastError;
  }

  private async request<T>(endpoint: string, gate: Gate, method: string, params: unknown): Promise<T> {
    // One in-flight RPC per endpoint, with a minimum gap between starts.
    if (Date.now() < gate.retryAt) throw new RpcUnavailableError(gate.retryAt);
    await pause(Math.max(0, gate.next - Date.now()));
    if (Date.now() < gate.retryAt) throw new RpcUnavailableError(gate.retryAt);
    gate.next = Date.now() + 400;
    const unavailable = (retryMs = 0) => {
      const delay = Math.max(retryMs, Math.min(60_000, 5000 * 2 ** Math.min(gate.failures++, 4)));
      gate.retryAt = Math.max(gate.retryAt, Date.now() + delay);
      return new RpcUnavailableError(gate.retryAt);
    };
    let response: Response;
    try {
      response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20_000) });
    } catch { throw unavailable(); }
    if (!response.ok) {
      const retry = response.headers.get("retry-after"), seconds = Number(retry);
      const retryMs = retry ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now()) : 0;
      throw unavailable(Number.isFinite(retryMs) ? Math.min(300_000, Math.max(0, retryMs)) : 0);
    }
    let json: { result?: T; error?: { code?: number; message?: string; data?: string } };
    try { json = await response.json(); } catch { throw unavailable(); }
    if (json.error && (json.error.code === 429 || /too many requests|rate.?limit/i.test(json.error.message ?? ""))) throw unavailable();
    gate.failures = 0;
    if (json.result !== undefined) return json.result;
    // Contract rejections are authoritative, not transport failures. Never retry
    // a submission here; koilib retains its unknown-transaction recovery rules.
    if (!json.error?.data) throw Error(json.error?.message ?? "The RPC returned an invalid response.");
    let data: unknown;
    try { data = JSON.parse(json.error.data); } catch { data = { data: json.error.data }; }
    throw Error(JSON.stringify({ ...(json.error.message && { error: json.error.message }), ...Object(data) }));
  }
}

export function rpcRetryAt(error: unknown): number | undefined {
  if (error instanceof RpcUnavailableError) return error.retryAt;
  if (error instanceof Error && error.cause && error.cause !== error) return rpcRetryAt(error.cause);
  if (error instanceof Error && /failed to fetch|networkerror|too many requests|\b429\b/i.test(error.message)) return Date.now() + 5000;
}
