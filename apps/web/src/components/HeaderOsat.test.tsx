import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { HeaderOsat } from "./HeaderOsat";
const h = vi.hoisted(() => ({ balance: vi.fn(), services: { protocol: { deployment: { economy: "token-free" } }, resolved: { deployment: { economy: "token-free" }, network: "mainnet" } } }));
vi.mock("../api/services", () => ({ useServices: () => h.services }));
vi.mock("../features/session", () => ({ useMe: () => ({ account: "owner" }) }));
vi.mock("@osp/sdk", async original => ({ ...await original<typeof import("@osp/sdk")>(), walletBalance: h.balance }));
it("keeps token-free headers empty without polling for balances or allowance", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const box = document.createElement("div"), root = createRoot(box);
  try {
    await act(async () => root.render(<MemoryRouter><HeaderOsat/></MemoryRouter>));
    expect(box.innerHTML).toBe(""); expect(fetcher).not.toHaveBeenCalled(); expect(h.balance).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
