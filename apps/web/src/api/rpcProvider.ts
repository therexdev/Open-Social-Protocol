import { Provider } from "@osp/sdk";

export class RpcUnavailableError extends Error {
  override name = "RpcUnavailableError";
  constructor(readonly retryAt: number) {
    super("The network is busy or temporarily unavailable. Please try again shortly.");
  }
}

// All clients in this browser share an endpoint's pacing and circuit breaker.
// Never cache completed reads: authorizations and finality must stay current.
type Gate = { tail: Promise<void>; next: number; retryAt: number; failures: number; pending: Map<string, Promise<unknown>> };
const gates = new Map<string, Gate>();
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const readOnly = new Set(["chain.read_contract", "chain.get_head_info", "chain.get_chain_id", "chain.get_account_nonce", "chain.get_account_rc"]);

/** koilib's browser transport otherwise starts every concurrent read immediately,
 * and a CORS-hidden 429 becomes an unhelpful, repeatedly retried TypeError. */
export class BrowserRpcProvider extends Provider {
  override async call<T = unknown>(method: string, params: unknown): Promise<T> {
    const endpoint = this.rpcNodes[this.currentNodeId]!;
    let gate = gates.get(endpoint);
    if (!gate) { gate = { tail: Promise.resolve(), next: 0, retryAt: 0, failures: 0, pending: new Map() }; gates.set(endpoint, gate); }
    const key = readOnly.has(method) ? JSON.stringify([method, params]) : undefined;
    const pending = key && gate.pending.get(key);
    const failed = (error: unknown): never => {
      // A subsequent call can use the next configured node. Never silently
      // replay the current call: submissions may already have reached a node.
      if (error instanceof RpcUnavailableError && this.rpcNodes.length > 1 && this.rpcNodes[this.currentNodeId] === endpoint)
        this.currentNodeId = (this.currentNodeId + 1) % this.rpcNodes.length;
      throw error;
    };
    if (pending) { try { return structuredClone(await pending) as T; } catch (error) { return failed(error); } }
    const task = gate.tail.then(() => this.request<T>(endpoint, gate, method, params));
    gate.tail = task.then(() => {}, () => {});
    if (key) gate.pending.set(key, task);
    try { return structuredClone(await task); }
    catch (error) { return failed(error); }
    finally { if (key && gate.pending.get(key) === task) gate.pending.delete(key); }
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
    let json: { result?: T; error?: { message?: string; data?: string } };
    try { json = await response.json(); } catch { throw unavailable(); }
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
