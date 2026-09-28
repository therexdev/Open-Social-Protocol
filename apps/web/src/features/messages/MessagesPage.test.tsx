import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { buildProfileDocument } from "../../api/profiles";
import { MessagesPage } from "./MessagesPage";
const alice = "1EiR6tc8jtVK6boR5w1chjq17XEXXHiNk4";
const bob = "1WhPkYjyS1ChEKmbxNAyFUHLuRVQCjNMF";
const other = "16HVcW9kHPJYd8CgAwdw7smZuU1nqiNzAN";
const mocks = vi.hoisted(() => ({
  value: {
    service: { me: { account: "1EiR6tc8jtVK6boR5w1chjq17XEXXHiNk4" }, enable: vi.fn(), sync: vi.fn(), send: vi.fn(), start: vi.fn(), accept: vi.fn() },
    snapshot: { enabled: false, registered: false, chats: [] as any[], pending: 0, error: "" },
  },
  search: vi.fn(), friends: [] as string[], names: {} as Record<string, string>,
}));
vi.mock("./PrivateMessagingProvider", () => ({ usePrivateMessaging: () => mocks.value }));
vi.mock("../session", () => ({ useCanAct: () => ({ ok: true }) }));
vi.mock("../../api/services", () => {
  const indexer = { configured: true, searchPeople: mocks.search };
  return { useServices: () => ({ indexer }) };
});
vi.mock("./useMessagePeople", () => ({ useMessagePeople: () => ({ friends: mocks.friends, blocked: [], loading: false, refresh: vi.fn(), name: (account: string) => mocks.names[account] || account }) }));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.friends = [bob];
  mocks.names = { [bob]: "Jim Profits", [other]: "Jim Profits" };
  mocks.search.mockResolvedValue([]);
  mocks.value.service.start.mockResolvedValue("new-chat");
  mocks.value.snapshot = { enabled: false, registered: false, chats: [], pending: 0, error: "" };
});
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.useRealTimers(); });
async function mount(url = "/messages") {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter initialEntries={[url]}><MessagesPage /></MemoryRouter>));
}
const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === name)!;
async function type(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function chat(peer = bob) {
  return { id: "chat", peer, status: "ready", createdAt: 1,
    messages: [{ id: "m1", text: "Saved before sending", mine: true, state: "sending", timestamp: 1 }] };
}
function enabled() { mocks.value.snapshot.enabled = true; mocks.value.snapshot.registered = true; }
it("explains seed recovery does not restore chat history before enabling", async () => {
  await mount(); expect(container.textContent).toContain("cannot restore these messages");
  await act(async () => button("Enable private messages").click());
  expect(mocks.value.service.enable).toHaveBeenCalled();
});
it("shows pending local messages and names while delivery continues", async () => {
  enabled(); mocks.value.snapshot.pending = 1; mocks.value.snapshot.chats = [chat()];
  await mount();
  expect(container.querySelector(".private-chat-choice")?.textContent).toContain("Jim Profits");
  await act(async () => container.querySelector<HTMLButtonElement>(".private-chat-choice")!.click());
  expect(container.textContent).toContain("Saved before sending");
  expect(container.textContent).toContain("Sending…");
  expect(container.textContent).toContain("You can leave this page");
});
it("does not claim setup is progressing after a failure and Retry clears a local error", async () => {
  mocks.value.snapshot.enabled = true;
  mocks.value.snapshot.error = "Directory RPC unavailable";
  await mount();
  expect(container.textContent).toContain("Directory RPC unavailable");
  expect(container.textContent).not.toContain("This browser is being connected");
  await act(async () => button("Retry").click());
  expect(mocks.value.service.sync).toHaveBeenCalledTimes(1);
});
it("opens a friend's existing chat from a profile link without creating a request", async () => {
  enabled(); mocks.value.snapshot.chats = [chat()];
  await mount(`/messages?to=${bob}`);
  expect(container.textContent).toContain("Saved before sending");
  await act(async () => button("Open conversation").click());
  expect(mocks.value.service.start).not.toHaveBeenCalled();
});
it("preserves a profile recipient through browser setup without auto-sending", async () => {
  await mount(`/messages?to=${bob}`);
  expect(mocks.value.service.start).not.toHaveBeenCalled();
  enabled();
  await act(async () => root.render(<MemoryRouter initialEntries={[`/messages?to=${bob}`]}><MessagesPage /></MemoryRouter>));
  expect(container.querySelector<HTMLInputElement>('[role="combobox"]')?.value).toBe("Jim Profits");
  await act(async () => button("Start private conversation").click());
  expect(mocks.value.service.start).toHaveBeenCalledWith(bob);
});
it("chooses friends by name and shows their address before sending", async () => {
  enabled(); await mount();
  await act(async () => container.querySelector<HTMLInputElement>('[role="combobox"]')!.focus());
  const option = container.querySelector<HTMLButtonElement>('[role="option"]')!;
  expect(option.textContent).toContain("Jim Profits"); expect(option.textContent).toContain(bob);
  await act(async () => option.click());
  expect(container.querySelector(".message-recipient-selected")?.textContent).toContain(bob);
  await act(async () => button("Start private conversation").click());
  expect(mocks.value.service.start).toHaveBeenCalledWith(bob);
});
it("searches duplicate names, ignores stale results, and supports keyboard selection", async () => {
  vi.useFakeTimers(); enabled();
  let resolveOld!: (value: unknown) => void;
  mocks.search.mockImplementation((query: string) => query === "Old" ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve([
    { account: bob, profileUri: buildProfileDocument({ display_name: "Jim Profits" }).uri },
    { account: other, profileUri: buildProfileDocument({ display_name: "Jim Profits" }).uri },
  ]));
  await mount(); await type('[role="combobox"]', "Old");
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await type('[role="combobox"]', "Jim");
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await act(async () => resolveOld([{ account: alice, profileUri: buildProfileDocument({ display_name: "Old" }).uri }]));
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(2);
  expect(button("Start private conversation").disabled).toBe(true);
  const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!;
  for (const key of ["ArrowDown", "ArrowDown", "Enter"]) {
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
  }
  expect(container.querySelector(".message-recipient-selected")?.textContent).toContain(other);
  await act(async () => button("Start private conversation").click());
  expect(mocks.value.service.start).toHaveBeenCalledWith(other);
});
it("editing a chosen recipient disables sending until the new person is selected", async () => {
  enabled(); await mount(`/messages?to=${bob}`);
  await type('[role="combobox"]', "Someone else");
  expect(container.querySelector<HTMLInputElement>('[role="combobox"]')?.value).toBe("Someone else");
  expect(button("Start private conversation").disabled).toBe(true);
  expect(container.querySelector(".message-recipient-selected")).toBeNull();
});
it("filters existing conversations by nickname or address", async () => {
  enabled(); mocks.value.snapshot.chats = [chat()]; await mount();
  await type('input[type="search"]', "jim");
  expect(container.querySelectorAll(".private-chat-choice")).toHaveLength(1);
  await type('input[type="search"]', "nobody");
  expect(container.querySelectorAll(".private-chat-choice")).toHaveLength(0);
  await type('input[type="search"]', bob);
  expect(container.querySelectorAll(".private-chat-choice")).toHaveLength(1);
});

it("shows request preparation until the chain confirms delivery", async () => {
  enabled(); mocks.value.snapshot.chats = [{ ...chat(), status: "outgoing", requestDelivery: "preparing", messages: [] }];
  await mount();
  expect(container.querySelector(".private-chat-choice")?.textContent).toContain("Preparing request");
  expect(container.querySelector(".private-chat-choice")?.textContent).not.toContain("Request sent");
  await act(async () => container.querySelector<HTMLButtonElement>(".private-chat-choice")!.click());
  expect(container.textContent).toContain("Keep this account unlocked");
  mocks.value.snapshot.chats[0].requestDelivery = "sent";
  await act(async () => root.render(<MemoryRouter><MessagesPage /></MemoryRouter>));
  expect(container.querySelector(".private-chat-choice")?.textContent).toContain("Request sent");
});
it("offers incoming requests for approval without first opening a conversation", async () => {
  enabled(); mocks.value.snapshot.chats = [{ ...chat(), status: "incoming", messages: [] }];
  await mount();
  expect(container.textContent).toContain("Message requests (1)");
  await act(async () => button("Accept request").click());
  expect(mocks.value.service.accept).toHaveBeenCalledWith("chat");
});
it("shows the actual setup step and puts sidebar status below the identity", async () => {
  enabled(); mocks.value.snapshot.chats = [{ ...chat(), status: "accepting", progress: "Waiting for message allowance to become final (42 blocks remaining)." }];
  await mount();
  await act(async () => container.querySelector<HTMLButtonElement>(".private-chat-choice")!.click());
  expect(container.textContent).toContain("42 blocks remaining");
  expect(container.querySelector(".private-chat-status")?.textContent).toBe("Connecting");
});
it("distinguishes a local close from a delivered close and shows errors without a misleading setup notice", async () => {
  enabled(); mocks.value.snapshot.chats = [{ ...chat(), status: "closed", closing: true, progress: "Closed on this browser. Notifying the other messaging browser." }];
  await mount();
  await act(async () => container.querySelector<HTMLButtonElement>(".private-chat-choice")!.click());
  expect(container.querySelector(".private-chat-status")?.textContent).toContain("notifying peer");
  expect(container.textContent).toContain("Notifying the other messaging browser.");
  mocks.value.snapshot.chats[0] = { ...chat(), status: "accepting", error: "Sponsor unavailable" };
  await act(async () => root.render(<MemoryRouter><MessagesPage /></MemoryRouter>));
  expect(container.textContent).toContain("Sponsor unavailable");
  expect(container.textContent).not.toContain("Checking the private connection");
});
