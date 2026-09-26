import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { MessagesPage } from "./MessagesPage";

const mocks = vi.hoisted(() => ({
  me: { account: "1JcHNmvo2PVNuan8GyBMjW9HdGXV1opsPM" },
  peer: "1AWc6UmnBoavsW2a4m33N61tPuEeFX5b9U",
  indexer: { configured: true, conversations: vi.fn(), messages: vi.fn() },
  protocol: { deployment: { chainId: "test", contracts: { messaging: { address: "messages" } } }, reads: { messaging: { get_conversation: vi.fn() } } },
}));
vi.mock("../../api/services", () => ({ useServices: () => mocks }));
vi.mock("../session", () => ({ useMe: () => mocks.me, useSubmitContext: () => undefined, useCanAct: () => ({ ok: false }) }));
vi.mock("./verified", () => ({ openVerifiedMessage: async (_p: unknown, _m: unknown, _peer: unknown, row: unknown) => row }));
let root: Root;
let container: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.useRealTimers(); });

it("receives new messages without losing loaded history or resetting the older-page cursor", async () => {
  vi.useFakeTimers();
  const conversation = { a: mocks.me.account, b: mocks.peer, status: 2 };
  mocks.indexer.conversations.mockResolvedValue({ items: [conversation] });
  mocks.protocol.reads.messaging.get_conversation.mockResolvedValue({ value: conversation });
  const row = (n: number) => ({ id: String(n), sequence: String(n), text: `message ${n}`, timestamp: "1", sender: mocks.peer });
  mocks.indexer.messages.mockResolvedValue({ items: [row(3)], nextBefore: "3" });
  container = document.createElement("div"); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><MessagesPage /></MemoryRouter>));
  const click = async (label: string) => {
    const button = [...container.querySelectorAll("button")].find(b => b.textContent?.includes(label));
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };
  await click(mocks.peer.slice(0, 9));
  mocks.indexer.messages.mockResolvedValueOnce({ items: [row(2)], nextBefore: "2" });
  await click("Load older messages");
  mocks.indexer.messages.mockResolvedValue({ items: [row(4), row(3)], nextBefore: "3" });
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(container.textContent).toContain("message 2");
  expect(container.textContent).toContain("message 4");
  mocks.indexer.messages.mockResolvedValueOnce({ items: [row(1)], nextBefore: null });
  await click("Load older messages");
  expect(mocks.indexer.messages).toHaveBeenLastCalledWith(mocks.me.account, mocks.peer, "2");
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(container.textContent).toContain("message 1");
  expect(container.textContent).not.toContain("Load older messages");
});
