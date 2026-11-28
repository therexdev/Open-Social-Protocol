import { Provider } from "koilib";

const reads = new Set([
  "chain.get_chain_id", "chain.get_head_info", "chain.get_account_nonce", "chain.get_account_rc",
  "chain.read_contract", "chain.invoke_system_call", "chain.get_fork_heads", "chain.get_resource_limits",
  "block_store.get_blocks_by_id", "block_store.get_blocks_by_height", "transaction_store.get_transactions_by_id",
  "mempool.get_pending_transactions",
]);

/** Koilib-compatible transport for deployment scripts and services. Strict RPC
 * gateways require an explicit JSON content type. Only reads may fail over;
 * uncertain writes are left to the caller's transaction reconciliation. */
export class JsonRpcProvider extends Provider {
  override async call<T = unknown>(method: string, params: unknown): Promise<T> {
    if (!this.rpcNodes.length) throw Error("No RPC endpoints configured.");
    const start = this.currentNodeId;
    let failure: unknown;
    for (let offset = 0; offset < this.rpcNodes.length; offset++) {
      const index = (start + offset) % this.rpcNodes.length;
      this.currentNodeId = index;
      let json: { result?: T; error?: { message?: string; data?: string } };
      try {
        const response = await fetch(this.rpcNodes[index]!, {
          method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) throw Error(`RPC HTTP ${response.status}`);
        json = await response.json();
        if (!json || typeof json !== "object") throw Error("Invalid RPC response.");
      } catch (error) {
        failure = error;
        this.currentNodeId = (index + 1) % this.rpcNodes.length;
        if (!reads.has(method)) throw error;
        continue;
      }
      if (json.result !== undefined) return json.result;
      // An RPC/contract rejection is authoritative. Preserve koilib's error data
      // shape, including reverted receipts and resource/nonce errors.
      if (!json.error?.data) throw Error(json.error?.message ?? "The RPC returned an invalid response.");
      let data: unknown;
      try { data = JSON.parse(json.error.data); } catch { data = { data: json.error.data }; }
      throw Error(JSON.stringify({ ...(json.error.message && { error: json.error.message }), ...Object(data) }));
    }
    throw failure;
  }
}
