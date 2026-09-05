/**
 * Event decoding (spec section 12): `osp.<contract>.<event>` names, canonical `*_event` data.
 */
import type { EventData, TransactionReceipt } from "koilib";
import { EVENTS } from "@osp/proto";
import { CONTRACT_NAMES, type ContractName } from "./constants.js";
import { decode, EncodingError, fromBase64url, type ProtoObject } from "./encoding.js";
import type { Deployment } from "./client/deployments.js";
import type { EventName, EventPayloads } from "./client/types.js";

export interface DecodedEvent<T = ProtoObject> {
  contract: ContractName;
  /** Full event name, e.g. `osp.publications.published`. */
  name: string;
  /** Protobuf type of `data`, e.g. `publications.published_event`. */
  type: string;
  data: T;
  impacted: string[];
  /** Emitting contract address. */
  source: string;
  sequence?: number;
  txId?: string;
  blockHeight?: string;
  blockId?: string;
}

const EVENT_TYPES: ReadonlyMap<string, { contract: ContractName; type: string }> = (() => {
  const map = new Map<string, { contract: ContractName; type: string }>();
  for (const contract of CONTRACT_NAMES) {
    for (const event of EVENTS[contract]) map.set(event.name, { contract, type: event.type });
  }
  return map;
})();

/** The contract and protobuf type behind a full event name. */
export function eventTypeForName(name: string): { contract: ContractName; type: string } | undefined {
  return EVENT_TYPES.get(name);
}

/** True when `name` is a protocol event name. */
export function isProtocolEventName(name: string): name is EventName {
  return EVENT_TYPES.has(name);
}

/** The protocol contract deployed at `source`, if any. */
export function protocolSource(deployment: Deployment, source: string): ContractName | undefined {
  return CONTRACT_NAMES.find((name) => deployment.contracts[name].address === source);
}

/** Decodes event data by name alone (no source check). */
export function decodeEventData<N extends EventName>(name: N, data: string | Uint8Array): EventPayloads[N];
export function decodeEventData(name: string, data: string | Uint8Array): ProtoObject | undefined;
export function decodeEventData(name: string, data: string | Uint8Array): ProtoObject | undefined {
  const info = EVENT_TYPES.get(name);
  if (!info) return undefined;
  return decode(info.type, typeof data === "string" ? fromBase64url(data) : data);
}

export interface EventContext {
  txId?: string;
  blockHeight?: string;
  blockId?: string;
}

/**
 * Decodes one event. When a deployment is given, events whose `source` is not the contract
 * the name belongs to are ignored (returns undefined), so forged names from other contracts
 * never decode as protocol events.
 */
export function decodeEvent(
  source: string,
  name: string,
  data: string | Uint8Array,
  deployment?: Deployment,
  extra: EventContext & { impacted?: string[]; sequence?: number } = {},
): DecodedEvent | undefined {
  const info = EVENT_TYPES.get(name);
  if (!info) return undefined;
  if (deployment && deployment.contracts[info.contract].address !== source) return undefined;
  let decoded: ProtoObject;
  try {
    decoded = decode(info.type, typeof data === "string" ? fromBase64url(data) : data);
  } catch (error) {
    if (error instanceof EncodingError) return undefined;
    throw error;
  }
  return {
    contract: info.contract,
    name,
    type: info.type,
    data: decoded,
    impacted: extra.impacted ?? [],
    source,
    ...(extra.sequence !== undefined && { sequence: extra.sequence }),
    ...(extra.txId !== undefined && { txId: extra.txId }),
    ...(extra.blockHeight !== undefined && { blockHeight: extra.blockHeight }),
    ...(extra.blockId !== undefined && { blockId: extra.blockId }),
  };
}

/** A raw event as the RPC reports it (`sequence` and `impacted` may be absent on some nodes). */
export type EventLike = Pick<EventData, "source" | "name" | "data"> & Partial<Pick<EventData, "sequence" | "impacted">>;
/** A transaction receipt (or the subset of it that carries events). */
export type ReceiptLike = Pick<Partial<TransactionReceipt>, "id"> & { events?: EventLike[] };
/** A block item as `chain.get_blocks` / `block_store` return it (only the parts that matter). */
export interface BlockLike {
  block_id?: string;
  block_height?: string;
  receipt?: { transaction_receipts?: ReceiptLike[]; events?: EventLike[] };
}

/** Decodes every protocol event of a transaction receipt (events from other contracts are skipped). */
export function decodeReceiptEvents(receipt: ReceiptLike, deployment: Deployment, context: EventContext = {}): DecodedEvent[] {
  const out: DecodedEvent[] = [];
  for (const event of receipt.events ?? []) {
    const decoded = decodeEvent(event.source, event.name, event.data ?? "", deployment, {
      ...context,
      txId: context.txId ?? receipt.id,
      impacted: event.impacted ?? [],
      sequence: event.sequence,
    });
    if (decoded) out.push(decoded);
  }
  return out;
}

/** Decodes protocol events from a block receipt (`block_store` / `chain.get_blocks`), for indexers. */
export function decodeBlockEvents(block: BlockLike, deployment: Deployment): DecodedEvent[] {
  const context: EventContext = {
    ...(block.block_id !== undefined && { blockId: block.block_id }),
    ...(block.block_height !== undefined && { blockHeight: block.block_height }),
  };
  const out: DecodedEvent[] = [];
  for (const receipt of block.receipt?.transaction_receipts ?? []) {
    out.push(...decodeReceiptEvents(receipt, deployment, context));
  }
  return out;
}

/** Narrow a decoded event to a known payload type. */
export function isEvent<N extends EventName>(event: DecodedEvent<unknown>, name: N): event is DecodedEvent<EventPayloads[N]> {
  return event.name === name;
}

export type { EventData };
