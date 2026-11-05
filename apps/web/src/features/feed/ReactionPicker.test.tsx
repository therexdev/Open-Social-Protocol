import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { toBase64url } from "@osp/sdk";
import { ReactionPicker } from "./ReactionPicker";

const h = vi.hoisted(() => ({ react: vi.fn(), send: vi.fn() }));
vi.mock("../session", () => ({
  useCanAct: () => ({ ok: true }), useMe: () => ({ account: "alice" }),
  useSubmitContext: () => ({ signer: { getAddress: () => "alice" }, client: { ops: { publications: { react: h.react } } } }),
}));
vi.mock("../../tx/submit", () => ({ submitAction: h.send, humanizeError: (e: Error) => e.message }));

it("opens five choices, switches a legacy heart, and removes the selected reaction", async () => {
  const box = document.createElement("div"); document.body.append(box);
  const root = createRoot(box), key = new Uint8Array(32).fill(1);
  const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const click = async (label: string) => act(async () => { button(label).click(); });
  try {
    await act(async () => root.render(<ReactionPicker id={toBase64url(key)} reactions={{ total: 2, byType: { "1": 2 }, viewer: [1] }}/>));
    await click("Change reaction, Love");
    expect(document.querySelectorAll(".reaction-options button")).toHaveLength(5);
    await click("Sad");
    expect(h.react).toHaveBeenLastCalledWith({ actor: "alice", post_id: key, reaction: 3, remove: false });
    expect(button("Change reaction, Sad").textContent).toContain("2");
    await click("Change reaction, Sad"); await click("Remove Sad reaction");
    expect(h.react).toHaveBeenLastCalledWith({ actor: "alice", post_id: key, reaction: 3, remove: true });
    expect(button("React").textContent).toContain("1");
  } finally { await act(async () => root.unmount()); box.remove(); }
});
