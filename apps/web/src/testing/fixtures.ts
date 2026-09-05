/**
 * Offline test doubles: a synthetic Deployment, a fake koilib provider (mirrors
 * packages/sdk/src/testing/fixtures.ts, which is not part of the SDK build) and a fake
 * indexer served through an injectable fetch.
 */
import { Signer, encode, type CallContractOperationJson, type Deployment, type ProviderInterface, type TransactionJson, type TransactionReceipt } from "@osp/sdk";
import { toBase64url } from "../util/bytes";
import type { FetchLike } from "../api/indexer";

export const HARBINGER_CHAIN_ID = "EiBncD4pKRIQWco_WRqo5Q-xnXR7JuO3PtZv983mKdKHSQ==";

export function fixtureDeployment(network = "fixture"): Deployment {
  const address = (name: string) => Signer.fromSeed(`osp-web-fixture-contract-${name}`).getAddress();
  const entry = (name: string) => ({ address: address(name), txId: "0x1220" + "00".repeat(32), block: "100" });
  return {
    network,
    chainId: HARBINGER_CHAIN_ID,
    rpc: ["http://fake.invalid"],
    protocolVersion: 1,
    contracts: {
      identity: entry("identity"),
      relationships: entry("relationships"),
      publications: entry("publications"),
      communities: entry("communities"),
      sponsorship: entry("sponsorship"),
      registry: entry("registry"),
    },
    startHeight: "100",
    indexers: ["https://indexer.test"],
    sponsors: [],
  };
}

export interface FakeProviderOptions {
  chainId?: string;
  rc?: Record<string, string>;
  onRead?: (op: CallContractOperationJson) => Uint8Array | undefined;
  onSend?: (tx: TransactionJson, broadcast: boolean) => Partial<TransactionReceipt> | undefined;
}

export interface FakeProvider extends ProviderInterface {
  sent: Array<{ transaction: TransactionJson; broadcast: boolean }>;
  reads: CallContractOperationJson[];
}

function nonceValue(n: number): string {
  const bytes: number[] = [0x08];
  let v = n;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v);
  return toBase64url(new Uint8Array(bytes));
}

export function fakeReceipt(tx: TransactionJson, extra: Partial<TransactionReceipt> = {}): TransactionReceipt {
  return {
    id: tx.id ?? "",
    payer: tx.header?.payer ?? "",
    max_payer_rc: "1000000000",
    rc_limit: String(tx.header?.rc_limit ?? "0"),
    rc_used: "123456",
    disk_storage_used: "0",
    network_bandwidth_used: "0",
    compute_bandwidth_used: "0",
    reverted: false,
    events: [],
    state_delta_entries: [],
    logs: [],
    ...extra,
  };
}

export function fakeProvider(options: FakeProviderOptions = {}): FakeProvider {
  const notImplemented = (name: string) => () => Promise.reject(new Error(`fake provider: ${name} not implemented`));
  const provider: FakeProvider = {
    sent: [],
    reads: [],
    call: notImplemented("call") as ProviderInterface["call"],
    getNonce: async () => 0,
    getNextNonce: async () => nonceValue(1),
    getAccountRc: async (account: string) => options.rc?.[account] ?? "500000000",
    getTransactionsById: notImplemented("getTransactionsById") as ProviderInterface["getTransactionsById"],
    getBlocksById: notImplemented("getBlocksById") as ProviderInterface["getBlocksById"],
    getHeadInfo: notImplemented("getHeadInfo") as ProviderInterface["getHeadInfo"],
    getChainId: async () => options.chainId ?? HARBINGER_CHAIN_ID,
    getBlocks: notImplemented("getBlocks") as ProviderInterface["getBlocks"],
    getBlock: notImplemented("getBlock") as ProviderInterface["getBlock"],
    wait: async (txId: string) => ({ blockId: `block-for-${txId}`, blockNumber: 101 }),
    sendTransaction: async (transaction, broadcast = true) => {
      provider.sent.push({ transaction, broadcast });
      const receipt = fakeReceipt(transaction, options.onSend?.(transaction, broadcast));
      return { receipt, transaction: { ...transaction, wait: async () => ({ blockId: `block-for-${transaction.id ?? ""}`, blockNumber: 101 }) } };
    },
    readContract: async (operation) => {
      provider.reads.push(operation);
      const result = options.onRead?.(operation);
      return { result: result ? toBase64url(result) : "", logs: "" };
    },
    invokeSystemCall: notImplemented("invokeSystemCall") as ProviderInterface["invokeSystemCall"],
  };
  return provider;
}

/** Encodes a read-only result for `onRead` handlers. */
export function readResult(typeName: string, value: Record<string, unknown>): Uint8Array {
  return encode(typeName, value);
}

export type RouteHandler = (url: URL, init?: RequestInit) => unknown | Promise<unknown>;

/** A fake indexer: `routes` maps a path (without query) to a JSON body or a handler. */
export function fakeIndexerFetch(routes: Record<string, unknown | RouteHandler>, calls: string[] = []): FetchLike {
  return async (input, init) => {
    const url = new URL(input);
    calls.push(url.pathname + url.search);
    const handler = routes[url.pathname];
    if (handler === undefined) {
      return new Response(JSON.stringify({ error: { code: "not_found", message: `no route ${url.pathname}` } }), { status: 404, headers: { "content-type": "application/json" } });
    }
    const body = typeof handler === "function" ? await (handler as RouteHandler)(url, init) : handler;
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
}
