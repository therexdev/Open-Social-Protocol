/**
 * Test-only helpers (excluded from the build): deterministic randomness, a deployment
 * fixture and a fake koilib provider.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { Signer, Transaction } from "koilib";
import type { CallContractOperationJson, ProviderInterface, TransactionJson, TransactionReceipt } from "koilib";
import { concat, toBase64url, u32be, utf8 } from "../encoding.js";
import type { Deployment } from "../client/deployments.js";
import type { Rng } from "../crypto/keys.js";

/** A deterministic byte stream: sha256(label || counter) blocks. */
export function deterministicRng(label: string): Rng {
  let counter = 0;
  return (length: number) => {
    const out = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const block = sha256(concat(utf8(label), u32be(counter++)));
      const n = Math.min(block.length, length - offset);
      out.set(block.subarray(0, n), offset);
      offset += n;
    }
    return out;
  };
}

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
  /** submit_transaction handler; receives the tx and broadcast flag, returns a receipt. */
  onSend?: (tx: TransactionJson, broadcast: boolean) => Partial<TransactionReceipt> | undefined;
}

export interface FakeProvider extends ProviderInterface {
  sent: Array<{ transaction: TransactionJson; broadcast: boolean }>;
  reads: CallContractOperationJson[];
  /** Accounts `getNextNonce` was called for, in order. */
  nonceCalls: string[];
  /** Accounts `getAccountRc` was called for, in order. */
  rcCalls: string[];
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
  const nonces = { ...(options.nonces ?? {}) };
  const notImplemented = (name: string) => () => Promise.reject(new Error(`fake provider: ${name} not implemented`));
  const provider: FakeProvider = {
    sent: [],
    reads: [],
    nonceCalls: [],
    rcCalls: [],
    call: notImplemented("call") as ProviderInterface["call"],
    getNonce: async (account: string) => nonces[account] ?? 0,
    getNextNonce: async (account: string) => {
      provider.nonceCalls.push(account);
      const next = (nonces[account] ?? 0) + 1;
      return nonceValue(next);
    },
    getAccountRc: async (account: string) => {
      provider.rcCalls.push(account);
      return options.rc?.[account] ?? "500000000";
    },
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

/** base64url `koinos.chain.value_type{uint64_value}` as koilib's getNextNonce returns it. */
export function nonceValue(n: number): string {
  // field 1 (uint64_value) varint
  const bytes: number[] = [0x08];
  let v = n;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v);
  return toBase64url(new Uint8Array(bytes));
}

/** Signs a prepared transaction with `signer` as an additional signature (sponsor co-sign). */
export async function coSign(tx: TransactionJson, signer: Signer): Promise<TransactionJson> {
  const copy: TransactionJson = { ...tx, signatures: [...(tx.signatures ?? [])] };
  return signer.signTransaction(copy);
}

export { Transaction };
