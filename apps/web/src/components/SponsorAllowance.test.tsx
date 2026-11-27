import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { SponsorAllowance } from "./SponsorAllowance";
const mocks = vi.hoisted(() => ({
 services: { protocol: { chainId: "test", deployment: { contracts: { identity: { address: "identity" } } } }, resolved: { sponsorUrls: ["https://sponsor.example"] } },
 me: { account: "owner", signer: { getAddress: () => "owner" } },
}));
vi.mock("../api/services", () => ({ useServices: () => mocks.services }));
vi.mock("../features/session", () => ({ useMe: () => mocks.me }));
vi.mock("@osp/sdk", async original => ({ ...await original<typeof import("@osp/sdk")>(), signPrivateStatement: vi.fn().mockResolvedValue("proof"), SponsorClient: class { async discover() { return { policy: { perUser: { dailyRc: "5000000000" } } }; } } }));
afterEach(() => vi.unstubAllGlobals());
it("shows receipt spending separately from pending transaction maximums", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ dailyRc: "5000000000", usedRc: "108199796", reservedRc: "200000000", remainingRc: "4691800204" }))));
  const box = document.createElement("div"), root = createRoot(box);
  try {
    await act(async () => root.render(<MemoryRouter><SponsorAllowance/></MemoryRouter>));
    expect(box.querySelector("strong")?.textContent).toBe("1.08 / 50 Mana used");
    expect(box.querySelector("small")?.textContent).toBe("46.92 available · 2 pending");
    expect(box.querySelector("a")?.title).toContain("maximums, not charges");
  } finally { await act(async () => root.unmount()); }
});
