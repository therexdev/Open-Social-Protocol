import { expect, it } from "vitest";
import { identityFromSeed, randomBytes, toBase64url } from "@osp/sdk";
import { deviceLinkCode, encodeHistoryFrames, historyRecords, receiveHistoryFrame } from "./deviceSync";
import type { HistoryRecord } from "./deviceSync";
import type { PrivateFile, PrivateChat } from "./privateStore";
const id = () => toBase64url(randomBytes(32));
const account = identityFromSeed(new Uint8Array(32).fill(81), 1).account;
const peer = identityFromSeed(new Uint8Array(32).fill(82), 1).account;
function fixture() {
  const link = { id: id(), kind: "device-link", syncApproved: true, syncSent: {} } as PrivateChat;
  const data = { version: 2, chats: [link], outbox: [], funding: {}, mirrors: [] } as unknown as PrivateFile;
  const record: HistoryRecord = { version: 1, kind: "message", threadId: id(), peer, createdAt: 1,
    message: { id: id(), text: "History copy", mine: false, state: "sent", timestamp: 2 } };
  return { link, data, record };
}
it("rejects unapproved history, conflicting logical messages, and another thread identity", () => {
  const { link, data, record } = fixture();
  const frame = encodeHistoryFrames([record])[0]!;
  link.syncApproved = false;
  expect(() => receiveHistoryFrame(data, link, frame, account)).toThrow("Approve");
  link.syncApproved = true; receiveHistoryFrame(data, link, frame, account);
  const conflict = { ...record, message: { ...record.message, text: "Rewritten by a conflicting copy" } };
  expect(() => receiveHistoryFrame(data, link, encodeHistoryFrames([conflict])[0]!, account)).toThrow("conflicting");
  expect(data.mirrors![0]!.messages[0]!.text).toBe("History copy");
  expect(() => receiveHistoryFrame(data, link, encodeHistoryFrames([{ ...record, peer: account }])[0]!, account)).toThrow("Invalid");
});
it("accepts out-of-order parts, deduplicates replay and exports only whitelisted fields", () => {
  const { link, data, record } = fixture();
  record.message.text = "😀".repeat(600);
  Object.assign(record.message, { ratchet: "must never be copied", privateKey: "nor this" });
  const frames = encodeHistoryFrames([record]);
  expect(frames.length).toBeGreaterThan(1);
  for (const frame of [...frames].reverse()) receiveHistoryFrame(data, link, frame, account);
  for (const frame of frames) receiveHistoryFrame(data, link, frame, account);
  expect(data.mirrors![0]!.messages).toHaveLength(1);
  expect(historyRecords(data).find(r => r.kind === "message")?.message.text).toBe(record.message.text);
  expect(JSON.stringify(historyRecords(data))).not.toMatch(/privateKey|ratchet|must never/);
});
it("shows a stable full 64-bit comparison code, distinct for each invitation", () => {
  const a = id(), b = id();
  expect(deviceLinkCode(a)).toMatch(/^[A-F0-9]{4}( [A-F0-9]{4}){3}$/);
  expect(deviceLinkCode(a)).toBe(deviceLinkCode(a));
  expect(deviceLinkCode(a)).not.toBe(deviceLinkCode(b));
});
