import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { toBase64url } from "@osp/sdk";
import type { PostView } from "../../api/indexer";
const h = vi.hoisted(() => ({ read: vi.fn(), answer: vi.fn(), submit: vi.fn(), vote: vi.fn() }));
vi.mock("../../api/services", () => { const protocol = { reads: { publications: { get_poll: h.read } } }; return { useServices: () => ({ protocol }) }; });
vi.mock("../session", () => ({ useCanAct: () => ({ ok: true }), useSubmitContext: () => ({ signer: { getAddress: () => "alice" }, client: { ops: { publications: { answer_poll: h.answer }, token: { vote: h.vote } }, reads: { publications: { get_poll: h.read } } } }) }));
vi.mock("../../tx/submit", () => ({ submitAction: h.submit }));
import { PollCard } from "./PollCard";
let root: Root, container: HTMLDivElement;
const id = new Uint8Array(32).fill(1);
const poll = { definition: { question: "Choose?", options: ["A", "B"], closes_at: String(Date.now() + 3600000) }, counts: [0, 0], participants: 0, engagement_participants: 0, engagement_milli: "0" };
const post = { postId: toBase64url(id), poll } as PostView;
beforeEach(() => { vi.clearAllMocks(); h.read.mockResolvedValue({ value: poll, now: String(Date.now()) }); h.answer.mockResolvedValue({ poll: true }); h.submit.mockResolvedValue({}); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() { await act(async () => root.render(<PollCard post={post}/>)); }
it("submits option zero without an automatic upvote", async () => {
  await render();
  await act(async () => container.querySelector<HTMLInputElement>("input")!.click());
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(h.answer).toHaveBeenCalledWith({ actor: "alice", post_id: id, option: 0 });
  expect(h.submit).toHaveBeenCalledTimes(1); expect(h.vote).not.toHaveBeenCalled();
});
it("preselects an existing ballot and requires a changed answer", async () => {
  h.read.mockResolvedValue({ value: poll, ballot: { option: 0 }, now: String(Date.now()) }); await render();
  expect(container.querySelector<HTMLInputElement>("input")!.checked).toBe(true);
  expect(container.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
  await act(async () => container.querySelectorAll<HTMLInputElement>("input")[1]!.click());
  expect(container.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
});
it("disables voting when chain verification fails", async () => {
  h.read.mockRejectedValue(new Error("RPC unavailable")); await render();
  expect(container.textContent).toContain("RPC unavailable");
  expect(container.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
});
it("shows closed polls without a submit action", async () => {
  h.read.mockResolvedValue({ value: { ...poll, definition: { ...poll.definition, closes_at: "1" } }, now: String(Date.now()) }); await render();
  expect(container.textContent).toContain("Closed"); expect(container.querySelector("button")).toBeNull();
});
