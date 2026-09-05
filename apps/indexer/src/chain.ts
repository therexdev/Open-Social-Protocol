/**
 * Chain access: a thin wrapper over the koilib Provider that returns blocks with their
 * decoded protocol events (ADR 0006: only events whose `source` is a configured protocol
 * contract address are kept; decoding uses the @osp/proto descriptors through @osp/sdk).
 */
import { Provider, decodeEvent, type BlockReceipt, type BlockJson, type DecodedEvent, type Deployment, type ProviderInterface } from "@osp/sdk";

export interface ChainHead {
  height: number;
  id: string;
  lastIrreversible: number;
  /** Head block time (ms, decimal string). */
  time: string;
}

/** A decoded protocol event with its canonical position in the block. */
export interface ChainEvent extends DecodedEvent {
  txIndex: number;
  /** Position of the event within its transaction receipt (canonical ordering key). */
  sequence: number;
  txId: string;
  /** Raw event data as the RPC reports it (base64url of the canonical `*_event` bytes). */
  raw: string;
}

export interface ChainBlock {
  height: number;
  id: string;
  previous: string;
  /** Block timestamp (ms, decimal string). */
  timestamp: string;
  events: ChainEvent[];
}

/** What the sync loop needs from a node; implemented by KoinosChain and by test fakes. */
export interface ChainSource {
  getHead(): Promise<ChainHead>;
  /** Blocks `fromHeight .. fromHeight + count - 1` on the chain ending at `headId` (ascending). */
  getBlocks(fromHeight: number, count: number, headId?: string): Promise<ChainBlock[]>;
  getChainId(): Promise<string>;
}

/** Block item as `block_store.get_blocks_by_height` returns it through koilib. */
export interface BlockItem {
  block_id: string;
  block_height: string;
  block?: BlockJson;
  receipt?: Partial<BlockReceipt>;
}

export class ChainError extends Error {
  override name = "ChainError";
}

/** Creates a koilib provider with RPC failover across `rpc`. */
export function createProvider(rpc: string[]): Provider {
  if (rpc.length === 0) throw new ChainError("no RPC endpoints configured (set OSP_RPC or use a deployment manifest)");
  return new Provider(rpc);
}

/** Converts an RPC block item into a ChainBlock (decoding protocol events, skipping reverted transactions). */
export function parseBlockItem(item: BlockItem, deployment: Deployment): ChainBlock {
  const height = Number(item.block_height ?? item.block?.header?.height);
  if (!Number.isInteger(height) || height < 0) throw new ChainError(`block item without a valid height: ${JSON.stringify(item.block_height)}`);
  const id = item.block_id ?? item.block?.id;
  if (!id) throw new ChainError(`block ${height} has no id`);
  const header = item.block?.header;
  if (!header) throw new ChainError(`block ${height} was returned without its header (returnBlock must be true)`);
  const events: ChainEvent[] = [];
  const receipts = item.receipt?.transaction_receipts ?? [];
  receipts.forEach((receipt, txIndex) => {
    if (receipt.reverted) return;
    const txId = receipt.id ?? "";
    (receipt.events ?? []).forEach((event, sequence) => {
      const decoded = decodeEvent(event.source, event.name, event.data ?? "", deployment, {
        txId,
        blockHeight: String(height),
        blockId: id,
        impacted: event.impacted ?? [],
        sequence,
      });
      if (!decoded) return;
      events.push({ ...decoded, txIndex, sequence, txId, raw: event.data ?? "" });
    });
  });
  return {
    height,
    id,
    previous: header.previous ?? "",
    timestamp: String(header.timestamp ?? "0"),
    events,
  };
}

export class KoinosChain implements ChainSource {
  constructor(
    readonly provider: ProviderInterface,
    readonly deployment: Deployment,
  ) {}

  async getHead(): Promise<ChainHead> {
    const info = await this.provider.getHeadInfo();
    const height = Number(info.head_topology?.height);
    if (!Number.isInteger(height)) throw new ChainError("chain.get_head_info returned no head height");
    return {
      height,
      id: info.head_topology.id,
      lastIrreversible: Number(info.last_irreversible_block ?? 0),
      time: String(info.head_block_time ?? "0"),
    };
  }

  async getBlocks(fromHeight: number, count: number, headId?: string): Promise<ChainBlock[]> {
    if (count <= 0) return [];
    const items = (await this.provider.getBlocks(fromHeight, count, headId, { returnBlock: true, returnReceipt: true })) as BlockItem[];
    return (items ?? [])
      .map((item) => parseBlockItem(item, this.deployment))
      .filter((block) => block.height >= fromHeight && block.height < fromHeight + count)
      .sort((a, b) => a.height - b.height);
  }

  getChainId(): Promise<string> {
    return this.provider.getChainId();
  }
}
