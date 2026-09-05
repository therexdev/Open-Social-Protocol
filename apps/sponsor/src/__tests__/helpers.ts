/**
 * Offline test fixtures: a synthetic deployment, a fake koilib provider and a fetch adapter
 * over `fastify.inject` so the real @osp/sdk SponsorClient can talk to the in-process server.
 *
 * `fixtureDeployment`, `fakeProvider`, `fakeReceipt` and `nonceValue` mirror
 * packages/sdk/src/testing/fixtures.ts, which is not part of the published SDK build.
 */
import type { FastifyInstance } from "fastify";
import { Signer, toBase64url, type Deployment, type FetchLike } from "@osp/sdk";
import type { CallContractOperationJson, ProviderInterface, TransactionJson, TransactionReceipt } from "@osp/sdk";
import { loadConfig, type SponsorConfig } from "../config.js";

export const HARBINGER_CHAIN_ID = "EiBncD4pKRIQWco_WRqo5Q-xnXR7JuO3PtZv983mKdKHSQ==";

export function fixtureDeployment(): Deployment {
  const address = (name: string) => Signer.fromSeed(`osp-fixture-contract-${name}`).getAddress();
  const entry = (name: string) => ({ address: address(name), txId: "0x1220" + "00".repeat(32), block: "100" });
  return {
    network: "fixture",
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
  };
}

export interface FakeProviderOptions {
  chainId?: string;
  rc?: Record<string, string>;
  nonces?: Record<string, number>;
  /** read_contract handler: returns encoded result bytes (or undefined for empty). */
  onRead?: (op: CallContractOperationJson) => Uint8Array | undefined;
  /** submit_transaction handler; may throw to simulate RPC/chain failures. */
  onSend?: (tx: TransactionJson, broadcast: boolean) => Partial<TransactionReceipt> | undefined;
}

export interface FakeProvider extends ProviderInterface {
  sent: Array<{ transaction: TransactionJson; broadcast: boolean }>;
  reads: CallContractOperationJson[];
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

/** base64url `koinos.chain.value_type{uint64_value}` as koilib's getNextNonce returns it. */
export function nonceValue(n: number): string {
  const bytes: number[] = [0x08];
  let v = n;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v);
  return toBase64url(new Uint8Array(bytes));
}

export function fakeProvider(options: FakeProviderOptions = {}): FakeProvider {
  const nonces = { ...(options.nonces ?? {}) };
  const notImplemented = (name: string) => () => Promise.reject(new Error(`fake provider: ${name} not implemented`));
  const provider: FakeProvider = {
    sent: [],
    reads: [],
    call: notImplemented("call") as ProviderInterface["call"],
    getNonce: async (account: string) => nonces[account] ?? 0,
    getNextNonce: async (account: string) => nonceValue((nonces[account] ?? 0) + 1),
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
      const withWait = { ...transaction, wait: async () => ({ blockId: `block-for-${transaction.id}`, blockNumber: 101 }) };
      return { receipt, transaction: withWait };
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

/** A configuration for tests: in-memory quota db, https public URL, defaults otherwise. */
export function testConfig(overrides: Partial<SponsorConfig> = {}): SponsorConfig {
  return { ...loadConfig({}), dbPath: ":memory:", publicUrl: "https://sponsor.test", register: false, ...overrides };
}

/** `fetch` over `fastify.inject`, so the SDK SponsorClient can be exercised without sockets. */
export function injectFetch(app: FastifyInstance): FetchLike {
  return async (url, init) => {
    const target = new URL(url);
    const method = (init?.method ?? "GET").toUpperCase() as "GET" | "POST";
    const response = await app.inject({
      method,
      url: target.pathname + target.search,
      headers: (init?.headers as Record<string, string> | undefined) ?? {},
      ...(typeof init?.body === "string" && { payload: init.body }),
    });
    return new Response(response.body, {
      status: response.statusCode,
      headers: { "content-type": String(response.headers["content-type"] ?? "application/json") },
    });
  };
}
