/**
 * Test-only helpers (excluded from the build): a synthetic deployment, a block builder that
 * turns `osp.*` events into RPC-shaped block items, and a fake koilib provider that serves
 * them (with fork switching and a configurable last irreversible block).
 */
import { createHash } from "node:crypto";
import { Signer, encode, toBase64url, type Deployment, type EventName, type ProtoObject, type ProviderInterface } from "@osp/sdk";
import type { BlockItem } from "../chain.js";

export const FIXTURE_CHAIN_ID = "EiBncD4pKRIQWco_WRqo5Q-xnXR7JuO3PtZv983mKdKHSQ==";

/** A synthetic deployment whose contract addresses derive from fixed seeds (never on chain). */
export function testDeployment(startHeight = 100): Deployment {
  const address = (name: string) => Signer.fromSeed(`osp-indexer-test-contract-${name}`).getAddress();
  const entry = (name: string) => ({ address: address(name), txId: "0x1220" + "00".repeat(32), block: String(startHeight) });
  return {
    network: "test",
    chainId: FIXTURE_CHAIN_ID,
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
    startHeight: String(startHeight),
  };
}

function sha256hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function multihash(text: string): string {
  return "0x1220" + sha256hex(text);
}

export interface RawEvent {
  sequence: number;
  source: string;
  name: string;
  data: string;
  impacted: string[];
}

export type EventInput = Omit<RawEvent, "sequence">;

export interface RawTx {
  id: string;
  events: RawEvent[];
  reverted: boolean;
}

/** Encodes a protocol event as the contract would emit it. */
export function ospEvent(deployment: Deployment, name: EventName, data: ProtoObject, impacted: string[]): EventInput {
  const contract = name.split(".")[1] as keyof Deployment["contracts"];
  const type = `${contract}.${name.slice(`osp.${contract}.`.length)}_event`;
  return { source: deployment.contracts[contract].address, name, data: toBase64url(encode(type, data)), impacted };
}

/** An event from an unrelated contract (must be ignored by the indexer). */
export function foreignEvent(name = "koinos.contracts.token.transfer_event"): EventInput {
  return { source: Signer.fromSeed("osp-indexer-test-foreign").getAddress(), name, data: toBase64url(new Uint8Array([1, 2, 3])), impacted: [] };
}

let txCounter = 0;

/** A transaction receipt with the given events (ids are content-derived, so forks differ). */
export function tx(events: EventInput[], options: { reverted?: boolean; salt?: string } = {}): RawTx {
  const salt = options.salt ?? String(txCounter++);
  const numbered = events.map((event, sequence) => ({ ...event, sequence }));
  return { id: multihash(`tx|${salt}|${JSON.stringify(numbered)}`), events: numbered, reverted: options.reverted ?? false };
}

export interface BuilderOptions {
  startHeight?: number;
  baseTimestamp?: number;
  blockIntervalMs?: number;
}

/** Builds RPC-shaped block items in order; `fork(height)` starts an alternative history. */
export class ChainBuilder {
  readonly blocks: BlockItem[] = [];
  readonly startHeight: number;
  readonly baseTimestamp: number;
  readonly blockIntervalMs: number;
  readonly genesisId: string;

  constructor(
    readonly deployment: Deployment,
    options: BuilderOptions = {},
  ) {
    this.startHeight = options.startHeight ?? Number(deployment.startHeight ?? 100);
    this.baseTimestamp = options.baseTimestamp ?? 1_760_000_000_000;
    this.blockIntervalMs = options.blockIntervalMs ?? 3000;
    this.genesisId = multihash(`genesis|${this.startHeight - 1}`);
  }

  get height(): number {
    return this.startHeight - 1 + this.blocks.length;
  }

  get headId(): string {
    return this.blocks[this.blocks.length - 1]?.block_id ?? this.genesisId;
  }

  /** Appends a block holding `txs` (in order). */
  block(txs: RawTx[] = [], options: { salt?: string; timestamp?: string } = {}): BlockItem {
    const height = this.height + 1;
    const previous = this.headId;
    const timestamp = options.timestamp ?? String(this.baseTimestamp + (height - this.startHeight) * this.blockIntervalMs);
    const id = multihash(`block|${height}|${previous}|${timestamp}|${options.salt ?? ""}|${txs.map((t) => t.id).join(",")}`);
    const item: BlockItem = {
      block_id: id,
      block_height: String(height),
      block: {
        id,
        header: { previous, height: String(height), timestamp, signer: Signer.fromSeed("osp-indexer-test-producer").getAddress() },
        transactions: txs.map((t) => ({ id: t.id })),
        signature: "",
      },
      receipt: {
        id,
        height: String(height),
        events: [],
        transaction_receipts: txs.map((t) => ({
          id: t.id,
          payer: "",
          max_payer_rc: "0",
          rc_limit: "0",
          rc_used: "0",
          disk_storage_used: "0",
          network_bandwidth_used: "0",
          compute_bandwidth_used: "0",
          reverted: t.reverted,
          events: t.events,
          state_delta_entries: [],
          logs: [],
        })),
      },
    };
    this.blocks.push(item);
    return item;
  }

  /** Appends a block with one transaction carrying `events`. */
  blockWith(...events: EventInput[]): BlockItem {
    return this.block(events.length > 0 ? [tx(events)] : []);
  }

  /** A new builder sharing every block below `height` (blocks at and above it can differ). */
  fork(height: number): ChainBuilder {
    const other = new ChainBuilder(this.deployment, {
      startHeight: this.startHeight,
      baseTimestamp: this.baseTimestamp,
      blockIntervalMs: this.blockIntervalMs,
    });
    for (const block of this.blocks) if (Number(block.block_height) < height) other.blocks.push(block);
    return other;
  }

  /** Block timestamp at a height (as the builder assigns it). */
  timestampAt(height: number): string {
    return String(this.baseTimestamp + (height - this.startHeight) * this.blockIntervalMs);
  }
}

export interface FakeProviderOptions {
  chainId?: string;
  /** Last irreversible height (default: head - 10, floored at start - 1). */
  lib?: number;
  /**
   * Highest height `getBlocks` serves (default: the head). Simulates a node whose block store
   * lags `chain.get_head_info`: the head advances but blocks above this height are not returned.
   */
  blockStoreHeight?: number;
}

/** A koilib provider serving the blocks of a ChainBuilder. `use(builder)` switches forks. */
export class FakeProvider implements ProviderInterface {
  private builder: ChainBuilder;
  private libOverride: number | undefined;
  readonly calls: string[] = [];
  chainId: string;
  /** Blocks above this height are not served by `getBlocks` (undefined: serve everything). */
  blockStoreHeight: number | undefined;

  constructor(builder: ChainBuilder, options: FakeProviderOptions = {}) {
    this.builder = builder;
    this.chainId = options.chainId ?? builder.deployment.chainId;
    this.libOverride = options.lib;
    this.blockStoreHeight = options.blockStoreHeight;
  }

  /** Number of RPC calls made so far (getHeadInfo, getChainId and getBlocks). */
  get callCount(): number {
    return this.calls.length;
  }

  /** Switches the served chain (a fork) and optionally the LIB. */
  use(builder: ChainBuilder, lib?: number): void {
    this.builder = builder;
    if (lib !== undefined) this.libOverride = lib;
  }

  set lib(height: number | undefined) {
    this.libOverride = height;
  }

  get lib(): number {
    if (this.libOverride !== undefined) return this.libOverride;
    return Math.max(this.builder.startHeight - 1, this.builder.height - 10);
  }

  private notImplemented(name: string): never {
    throw new Error(`FakeProvider: ${name} not implemented`);
  }

  call<T = unknown>(method: string, params: unknown): Promise<T> {
    void params;
    return this.notImplemented(`call(${method})`);
  }
  getNonce(): Promise<number | string> {
    return this.notImplemented("getNonce");
  }
  getNextNonce(): Promise<string> {
    return this.notImplemented("getNextNonce");
  }
  getAccountRc(): Promise<string> {
    return this.notImplemented("getAccountRc");
  }
  getTransactionsById(): ReturnType<ProviderInterface["getTransactionsById"]> {
    return this.notImplemented("getTransactionsById");
  }
  getBlocksById(): ReturnType<ProviderInterface["getBlocksById"]> {
    return this.notImplemented("getBlocksById");
  }
  async getHeadInfo(): ReturnType<ProviderInterface["getHeadInfo"]> {
    this.calls.push("getHeadInfo");
    const head = this.builder.blocks[this.builder.blocks.length - 1];
    return {
      head_block_time: head?.block?.header?.timestamp ?? "0",
      head_topology: {
        id: this.builder.headId,
        height: String(this.builder.height),
        previous: head?.block?.header?.previous ?? "",
      },
      head_state_merkle_root: "",
      last_irreversible_block: String(this.lib),
    };
  }
  async getChainId(): Promise<string> {
    this.calls.push("getChainId");
    return this.chainId;
  }
  async getBlocks(height: number, numBlocks = 1, idRef?: string): ReturnType<ProviderInterface["getBlocks"]> {
    this.calls.push(`getBlocks(${height},${numBlocks})`);
    let chain = this.builder.blocks;
    if (idRef !== undefined && idRef !== this.builder.genesisId) {
      const index = chain.findIndex((b) => b.block_id === idRef);
      if (index < 0) throw new Error(`FakeProvider: unknown head block ${idRef}`);
      chain = chain.slice(0, index + 1);
    }
    // A lagging block store knows the head (chain.get_head_info) but cannot serve the blocks above its own height.
    if (this.blockStoreHeight !== undefined) chain = chain.filter((b) => Number(b.block_height) <= this.blockStoreHeight!);
    return chain
      .filter((b) => Number(b.block_height) >= height && Number(b.block_height) < height + numBlocks)
      .map((b) => ({ block_id: b.block_id, block_height: b.block_height, block: b.block!, receipt: b.receipt! })) as Awaited<
      ReturnType<ProviderInterface["getBlocks"]>
    >;
  }
  async getBlock(height: number): ReturnType<ProviderInterface["getBlock"]> {
    return (await this.getBlocks(height, 1))[0]!;
  }
  wait(): ReturnType<ProviderInterface["wait"]> {
    return this.notImplemented("wait");
  }
  sendTransaction(): ReturnType<ProviderInterface["sendTransaction"]> {
    return this.notImplemented("sendTransaction");
  }
  readContract(): ReturnType<ProviderInterface["readContract"]> {
    return this.notImplemented("readContract");
  }
  invokeSystemCall<T = Record<string, unknown>>(): Promise<T | undefined> {
    return this.notImplemented("invokeSystemCall");
  }
}
