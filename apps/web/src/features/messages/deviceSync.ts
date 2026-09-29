import { canonicalJson, contentHash, fromBase64url, isAddress, toBase64url, toHex, utf8, utf8Decode, PRIVATE_MESSAGE_LIMIT } from "@osp/sdk";
import { validId, type LocalMessage, type MirroredThread, type PrivateChat, type PrivateFile } from "./privateStore";

export const threadId = (chat: PrivateChat) => chat.threadId ?? chat.id;
export const deviceLinkCode = (id: string) => toHex(contentHash(utf8(`osp/device-link/v1:${id}`))).slice(0, 16).toUpperCase().match(/.{1,4}/g)!.join(" ");
export const messageKey = (message: LocalMessage) => `${message.mine ? "out" : "in"}:${message.logicalId ?? message.id}`;
const states: LocalMessage["state"][] = ["queued", "sending", "submitted", "stopped", "not-sent", "confirming", "sent"];
const rank = (state: LocalMessage["state"]) => states.indexOf(state);

/** Copies of one logical message converge without overwriting different plaintext. */
export function mergeMessage(messages: LocalMessage[], incoming: LocalMessage): void {
  const old = messages.find(m => messageKey(m) === messageKey(incoming));
  if (old) {
    if (old.text !== incoming.text || old.mine !== incoming.mine) throw new Error("Linked browsers returned conflicting message history");
    if (rank(incoming.state) > rank(old.state)) old.state = incoming.state;
    old.timestamp = Math.min(old.timestamp, incoming.timestamp);
    old.sourceDeviceId ??= incoming.sourceDeviceId;
    return;
  }
  messages.push(structuredClone(incoming));
  messages.sort((a, b) => a.timestamp - b.timestamp || messageKey(a).localeCompare(messageKey(b)));
}

export function historyThreads(data: PrivateFile): MirroredThread[] {
  const threads = new Map<string, MirroredThread>();
  for (const item of [...data.chats.filter(c => !c.kind && !c.supersededBy).map(c => ({
    id: threadId(c), peer: c.peer, createdAt: c.createdAt, messages: c.messages,
    ...(c.status === "closed" && !c.routeOnlyClosed && !c.supersededBy && { closedAt: c.closedAt ?? c.createdAt }),
  })), ...(data.mirrors ?? [])]) {
    let target = threads.get(item.id);
    if (target && target.peer !== item.peer) throw new Error("Conflicting conversation identity");
    if (!target) { target = { id: item.id, peer: item.peer, createdAt: item.createdAt, messages: [] }; threads.set(item.id, target); }
    target.createdAt = Math.min(target.createdAt, item.createdAt);
    if (item.closedAt !== undefined) target.closedAt = Math.min(target.closedAt ?? item.closedAt, item.closedAt);
    for (const message of item.messages) mergeMessage(target.messages, message);
  }
  return [...threads.values()];
}

export type HistoryRecord = {
  version: 1;
  threadId: string;
  peer: string;
  createdAt: number;
} & ({ kind: "thread"; closedAt?: number } | { kind: "message"; message: LocalMessage });

export function recordKey(record: HistoryRecord): string {
  return record.kind === "thread" ? `thread:${record.threadId}` : `message:${record.threadId}:${messageKey(record.message)}`;
}
export const recordHash = (record: HistoryRecord) => toBase64url(contentHash(utf8(canonicalJson(record))));

/** Whitelist the export: no seed, alias secret, pickle, one-time key or live ratchet. */
export function historyRecords(data: PrivateFile): HistoryRecord[] {
  const records: HistoryRecord[] = [];
  for (const thread of historyThreads(data)) {
    const base = { version: 1 as const, threadId: thread.id, peer: thread.peer, createdAt: thread.createdAt };
    records.push({ ...base, kind: "thread", ...(thread.closedAt !== undefined && { closedAt: thread.closedAt }) });
    for (const m of thread.messages) records.push({ ...base, kind: "message", message: {
      id: m.logicalId ?? m.id, text: m.text, mine: m.mine, timestamp: m.timestamp, state: m.state,
      ...(m.sourceDeviceId && { sourceDeviceId: m.sourceDeviceId }),
    } });
  }
  // New traffic precedes older history. A large initial copy must not delay replies.
  return records.sort((a, b) => (b.kind === "message" ? b.message.timestamp : b.createdAt) - (a.kind === "message" ? a.message.timestamp : a.createdAt));
}

function validTime(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function validateRecord(value: unknown, account: string): HistoryRecord {
  const r = value as HistoryRecord;
  if (!r || r.version !== 1 || !validId(r.threadId) || !isAddress(r.peer) || r.peer === account || !validTime(r.createdAt))
    throw new Error("Invalid linked conversation record");
  const base = { version: 1 as const, threadId: r.threadId, peer: r.peer, createdAt: r.createdAt };
  if (r.kind === "thread") {
    if (r.closedAt !== undefined && !validTime(r.closedAt)) throw new Error("Invalid linked conversation closure");
    return { ...base, kind: "thread", ...(r.closedAt !== undefined && { closedAt: r.closedAt }) };
  }
  const m = r.kind === "message" ? r.message : undefined;
  if (!m || !validId(m.id) || typeof m.text !== "string" || !m.text.trim() || utf8(m.text).length > PRIVATE_MESSAGE_LIMIT
    || typeof m.mine !== "boolean" || !validTime(m.timestamp) || !states.includes(m.state)
    || (m.sourceDeviceId !== undefined && !validId(m.sourceDeviceId))) throw new Error("Invalid linked message record");
  return { ...base, kind: "message", message: { id: m.id, text: m.text, mine: m.mine, timestamp: m.timestamp, state: m.state,
    ...(m.sourceDeviceId && { sourceDeviceId: m.sourceDeviceId }) } };
}

/** Pack several small records together. Long text is split into authenticated parts. */
export function encodeHistoryFrames(records: HistoryRecord[]): string[] {
  const frames: string[] = [];
  let batch: HistoryRecord[] = [];
  const encode = (items: HistoryRecord[]) => JSON.stringify({ domain: "osp/device-sync/v1", records: items });
  // Frames are themselves strings inside the encrypted message JSON. Account
  // for that second escape layer, especially pasted quotes/control characters.
  const fits = (value: string) => utf8(JSON.stringify(value)).length <= PRIVATE_MESSAGE_LIMIT;
  const flush = () => { if (batch.length) { frames.push(encode(batch)); batch = []; } };
  for (const record of records) {
    if (fits(encode([record]))) {
      if (batch.length >= 20 || !fits(encode([...batch, record]))) flush();
      batch.push(record);
    } else {
      flush();
      const bytes = utf8(canonicalJson(record)), total = Math.ceil(bytes.length / 1300);
      if (total > 16) throw new Error("Linked history record is too large");
      for (let index = 0; index < total; index++) frames.push(JSON.stringify({ domain: "osp/device-sync/v1", part: {
        key: recordKey(record), hash: recordHash(record), index, total, data: toBase64url(bytes.subarray(index * 1300, (index + 1) * 1300)),
      } }));
    }
  }
  flush();
  if (frames.some(frame => utf8(frame).length > PRIVATE_MESSAGE_LIMIT)) throw new Error("Linked history frame is too large");
  return frames;
}

/** Called only after chain verification and authentication by an approved link ratchet. */
export function receiveHistoryFrame(data: PrivateFile, link: PrivateChat, text: string, account: string): string[] {
  if (link.kind !== "device-link" || !link.syncApproved) throw new Error("Approve this browser before sharing history");
  const frame = JSON.parse(text);
  if (frame?.domain !== "osp/device-sync/v1") throw new Error("Invalid linked-browser frame");
  let raw: unknown[];
  if (Array.isArray(frame.records) && frame.records.length <= 20) raw = frame.records;
  else {
    const p = frame.part;
    if (!p || typeof p.key !== "string" || p.key.length > 160 || !validId(p.hash) || !Number.isInteger(p.total) || p.total < 1 || p.total > 16
      || !Number.isInteger(p.index) || p.index < 0 || p.index >= p.total || typeof p.data !== "string" || p.data.length > 1800)
      throw new Error("Invalid linked history part");
    const pending = link.syncParts ??= {};
    if (!pending[p.hash] && Object.keys(pending).length >= 32) throw new Error("Too many unfinished linked history records");
    const parts = pending[p.hash] ??= { hash: p.hash, total: p.total, parts: Array(p.total).fill("") };
    if (parts.total !== p.total || (parts.parts[p.index] && parts.parts[p.index] !== p.data)) throw new Error("Conflicting linked history parts");
    parts.parts[p.index] = p.data;
    if (parts.parts.some(part => !part)) return [];
    const bytes = Uint8Array.from(parts.parts.flatMap(part => [...fromBase64url(part)]));
    if (toBase64url(contentHash(bytes)) !== p.hash) throw new Error("Linked history hash mismatch");
    const record = validateRecord(JSON.parse(utf8Decode(bytes)), account);
    if (recordKey(record) !== p.key) throw new Error("Linked history identity mismatch");
    raw = [record];
    delete pending[p.hash];
  }
  const records = raw.map(record => validateRecord(record, account));
  const closed: string[] = [];
  for (const record of records) {
    const native = data.chats.find(c => !c.kind && threadId(c) === record.threadId);
    if (native && native.peer !== record.peer) throw new Error("Linked history belongs to a different person");
    const mirrors = data.mirrors ??= [];
    let mirror = mirrors.find(m => m.id === record.threadId);
    if (mirror && mirror.peer !== record.peer) throw new Error("Linked history belongs to a different person");
    if (!mirror) { mirror = { id: record.threadId, peer: record.peer, createdAt: record.createdAt, messages: [] }; mirrors.push(mirror); }
    mirror.createdAt = Math.min(mirror.createdAt, record.createdAt);
    if (record.kind === "message") mergeMessage(mirror.messages, record.message);
    else if (record.closedAt !== undefined) { mirror.closedAt = Math.min(mirror.closedAt ?? record.closedAt, record.closedAt); closed.push(mirror.id); }
    // Don't echo an unchanged record to the browser that just sent it.
    (link.syncSent ??= {})[recordKey(record)] = recordHash(record);
  }
  return closed;
}
