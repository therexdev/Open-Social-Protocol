import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UsageLimitDialog } from "./UsageLimitDialog";
import { useSettings } from "../stores/settings";
import { useUsagePrompt, type UsagePrompt } from "../stores/usagePrompt";
const h = vi.hoisted(() => ({ address: "signing-wallet", network: "mainnet", chainId: "mainnet-chain" }));
vi.mock("../api/services", () => ({ useServices: () => ({ protocol: { chainId: h.chainId }, resolved: { network: h.network } }) }));
vi.mock("../features/session", () => ({ useMe: () => ({ account: "profile-owner", signer: { getAddress: () => h.address } }) }));
let box: HTMLDivElement, root: Root;
const originals = { showModal: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"), close: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close") };
const notice: UsagePrompt = { kind: "daily", chainId: "mainnet-chain", payer: "signing-wallet", canUseOwnAccount: true, resetAt: Date.UTC(2026,10,28) };
beforeEach(() => {
  h.address = "signing-wallet"; h.chainId = "mainnet-chain"; h.network = "mainnet";
  useSettings.getState().update({ payment: "sponsor-only" });
  useUsagePrompt.setState({ notice, dismissed: {} });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
  box = document.createElement("div"); root = createRoot(box);
});
afterEach(async () => { await act(async () => root?.unmount());
  for (const [key, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor); else Reflect.deleteProperty(HTMLDialogElement.prototype, key); }
  vi.restoreAllMocks(); vi.unstubAllGlobals(); useUsagePrompt.setState({ notice: undefined, dismissed: {} }); });
const show = async (value = notice) => { await act(async () => root.render(<UsageLimitDialog notice={value}/>)); };
const click = async (label: string) => { await act(async () => [...box.querySelectorAll("button")].find(b => b.textContent === label)!.click()); };
it("explains the daily reset and funds the current signing wallet instead of the profile address", async () => {
  await show();
  expect(box.querySelector("dialog[open]")).toBeTruthy();
  expect(box.textContent).toContain("Free usage limit reached");
  expect(box.textContent).toContain("midnight UTC");
  expect(box.querySelector("code")?.textContent).toBe("signing-wallet");
  expect(box.textContent).not.toContain("profile-owner");
  expect(useSettings.getState().payment).toBe("sponsor-only");
});
it("enables free-first fallback only after an explicit click and asks the user to retry", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await show(); await click("Use my account for extra usage");
  expect(useSettings.getState().payment).toBe("sponsor-then-self");
  expect(box.querySelector('[role="status"]')?.textContent).toContain("retry the action");
  expect(fetcher).not.toHaveBeenCalled();
  await click("Done"); expect(useUsagePrompt.getState().notice).toBeUndefined();
});
it("lets the user wait without enabling self-payment", async () => {
  await show(); await click("Wait for free usage");
  expect(useUsagePrompt.getState().notice).toBeUndefined(); expect(useSettings.getState().payment).toBe("sponsor-only");
});
it("hides a stale funding prompt on an account or network switch", async () => {
  await show(); h.address = "different-wallet"; await show();
  expect(box.querySelector("dialog[open]")).toBeNull();
  h.address = notice.payer; h.chainId = "different-chain"; await show();
  expect(box.querySelector("dialog[open]")).toBeNull();
});
it("never asks users to fund a privacy alias or a sponsor-owned message allocation", async () => {
  await show({ ...notice, canUseOwnAccount: false });
  expect(box.textContent).toContain("messages will retry");
  expect(box.querySelector("code")).toBeNull();
  expect(box.textContent).not.toContain("Copy funding address");
  await click("Done"); expect(useSettings.getState().payment).toBe("sponsor-only");
});
it("labels a shared pool shortage accurately without claiming the daily allowance was spent", async () => {
  await show({ ...notice, kind: "service", resetAt: undefined });
  expect(box.textContent).toContain("service is busy"); expect(box.textContent).not.toContain("reached your free daily");
});

it("copies the exact funding address", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined); vi.stubGlobal("navigator", { clipboard: { writeText } });
  await show(); await click("Copy funding address");
  expect(writeText).toHaveBeenCalledWith("signing-wallet");
});
