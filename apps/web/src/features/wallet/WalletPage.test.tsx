import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ balance: vi.fn(), operation: vi.fn(), send: vi.fn(), store: vi.fn(), check: vi.fn(), load: vi.fn(), session: { identity: { account: "alice", signer: { getAddress: () => "alice" } } }, client: { chainId: "test", deployment: { contracts: { token: { address: "osat" } } } } }));
vi.mock("@osp/sdk", async original => ({ ...await original<typeof import("@osp/sdk")>(), walletBalance: h.balance, walletTransferOperation: h.operation }));
vi.mock("../../api/services", () => ({ useServices: () => ({ protocol: h.client, resolved: { network: "harbinger" } }) }));
vi.mock("../session", () => ({ useMe: () => h.session.identity, useSession: () => h.session, useSubmitContext: () => ({ client: h.client, signer: h.session.identity.signer, payment: "self-only" }) }));
vi.mock("./walletService", () => ({ walletTransferStore: h.store, sendWalletTransfer: h.send, checkWalletTransfer: h.check }));
import { WalletPage } from "./WalletPage";
let root: Root, container: HTMLDivElement;
const osat = { token: "osat", address: "alice", contract: "osat", symbol: "OSAT", decimals: 0, balance: "100", available: "7", locked: "93" };
const native = { token: "native", address: "alice", contract: "native", symbol: "tKOIN", decimals: 8, balance: "100000001", available: "100000001", locked: "0" };
beforeEach(() => {
  vi.clearAllMocks();
  h.balance.mockImplementation(async (_client, token) => token === "osat" ? osat : native);
  h.store.mockResolvedValue({ load: h.load }); h.load.mockResolvedValue(undefined);
  h.operation.mockResolvedValue({ call_contract: {} }); h.send.mockResolvedValue("tx-1");
});
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); });
async function render() { container = document.createElement("div"); document.body.append(container); root = createRoot(container); await act(async () => root.render(<MemoryRouter><WalletPage/></MemoryRouter>)); }
async function click(text: string) { const button = [...container.querySelectorAll("button")].find(b => b.textContent === text)!; expect(button).toBeTruthy(); await act(async () => button.click()); }
async function fill(label: string, value: string) {
  const id = [...container.querySelectorAll("label")].find(l => l.textContent?.includes(label))!.htmlFor;
  const element = document.getElementById(id) as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(element,value); element.dispatchEvent(new Event("input",{bubbles:true})); });
}
it("shows OSAT locks and reviews Send all before transmitting", async () => {
  await render(); expect(container.textContent).toContain("93 OSAT recharging");
  await fill("Recipient address","bob"); await click("Send all"); await click("Review transfer");
  expect(h.send).not.toHaveBeenCalled(); expect(container.textContent).toContain("no transfer fee");
  await click("Confirm send"); expect(h.send.mock.calls[0]?.[1]).toMatchObject({ amount: "7", to: "bob", all: true });
  expect(container.textContent).toContain("Sent 7 OSAT");
});
it("switches tokens, clears the old amount and sends every native fractional unit", async () => {
  await render(); await click("Send all");
  await act(async () => { const select=container.querySelector("select")!; select.value="native"; select.dispatchEvent(new Event("change",{bubbles:true})); });
  expect(container.textContent).toContain("1.00000001 tKOIN");
  const amount=container.querySelectorAll("input")[1]!; expect(amount.value).toBe("");
  await fill("Recipient address","bob"); await click("Send all"); await click("Review transfer"); await click("Confirm send");
  expect(h.send.mock.calls[0]?.[1]).toMatchObject({ amount: "100000001", balance: { token: "native" } });
});
it("accepts a chosen amount and rejects excessive decimal precision before review", async () => {
  await render(); await fill("Recipient address","bob"); await fill("Amount", "1.5"); await click("Review transfer");
  expect(container.textContent).toContain("whole tokens"); expect(h.send).not.toHaveBeenCalled();
  await fill("Amount", "3"); await click("Review transfer"); await click("Confirm send");
  expect(h.send.mock.calls[0]?.[1]).toMatchObject({ amount: "3", all: false });
});
it("restores a pending transfer after reload and disables new sends", async () => {
  h.load.mockResolvedValue({ balance: native, amount: "100000001", to: "bob", transaction: { id: "pending-id" } });
  await render(); expect(container.textContent).toContain("pending-id");
  expect([...container.querySelectorAll("button")].find(b=>b.textContent==="Review transfer")?.disabled).toBe(true);
  h.check.mockResolvedValue("confirmed"); await click("Check transfer status");
  expect(container.textContent).toContain("Transfer confirmed"); expect(h.send).not.toHaveBeenCalled();
});
