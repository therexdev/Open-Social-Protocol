import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AUDIENCE } from "@osp/sdk";
import type { DraftRecord } from "../../vault/store";
import type { PublishRequest } from "./usePublish";
import { ComposerForm } from "./ComposerForm";

const transport = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("./usePublish", () => ({ usePublish: () => ({ ...transport, ready: true }) }));
vi.mock("../session", () => ({ useCanAct: () => ({ ok: true }) }));
vi.mock("../../vault/context", () => ({
  useVault: (selector: (state: { account: string }) => unknown) => selector({ account: "saved-test-account" }),
  useVaultStore: () => ({ getState: () => ({ account: "saved-test-account" }) }),
}));
vi.mock("../../api/services", () => ({ useServices: () => ({ resolved: { sponsorUrls: [] } }) }));

let root: Root;
let container: HTMLDivElement;
const dialogMethods = {
  showModal: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"),
  close: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close"),
};

beforeEach(() => {
  transport.start.mockReset();
  // jsdom lacks the native dialog methods; keep native close/cancel event behavior.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } },
  });
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  vi.restoreAllMocks();
  for (const [name, descriptor] of Object.entries(dialogMethods)) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

async function render(audience: number) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onSubmitted = vi.fn();
  await act(async () => { root.render(<ComposerForm defaultAudience={audience} onSubmitted={onSubmitted} />); });
  const textarea = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "A post to test publishing");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Review and publish");
  return { textarea, onSubmitted };
}

function button(label: string): HTMLButtonElement {
  const element = [...container.querySelectorAll("button")].find((node) => node.textContent === label);
  expect(element).toBeDefined();
  return element!;
}

async function click(label: string) {
  await act(async () => { button(label).click(); });
}

describe("ComposerForm publish confirmation", () => {
  it.each([[AUDIENCE.EVERYONE, "Everyone"], [AUDIENCE.FRIENDS, "Friends"]] as const)("publishes to %s exactly once after local saving, without waiting for network confirmation", async (audience, label) => {
    let finish!: (value: DraftRecord) => void;
    transport.start.mockImplementation(() => new Promise<DraftRecord>((resolve) => { finish = resolve; }));
    const { textarea, onSubmitted } = await render(audience);
    await click(`Publish to ${label}`);
    expect(transport.start).toHaveBeenCalledTimes(1);
    expect(transport.start.mock.calls[0]![0].draft.audience).toBe(audience);
    expect(button("Saving…").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);
    await act(async () => { container.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })); });
    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    await click("Saving…");
    expect(transport.start).toHaveBeenCalledTimes(1);
    await act(async () => { finish(transport.start.mock.calls[0]![0].draft); });
    expect(onSubmitted).toHaveBeenCalledWith(transport.start.mock.calls[0]![0].draft);
    expect(textarea.value).toBe("");
    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(false);
    expect(container.querySelector("form form")).toBeNull();
  });

  it.each([[AUDIENCE.EVERYONE, "Everyone"], [AUDIENCE.FRIENDS, "Friends"]] as const)("shows a failed local save to %s and preserves the post text", async (audience, label) => {
    transport.start.mockRejectedValue(new Error("Device storage unavailable"));
    const { textarea, onSubmitted } = await render(audience);
    await click(`Publish to ${label}`);
    expect(transport.start).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[role='alert']")?.textContent).toContain("Device storage unavailable");
    expect(textarea.value).toBe("A post to test publishing");
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(false);
  });

  it("cancels the review without publishing or changing the text", async () => {
    const { textarea } = await render(AUDIENCE.EVERYONE);
    await click("Cancel");
    expect(transport.start).not.toHaveBeenCalled();
    expect(textarea.value).toBe("A post to test publishing");
    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(false);
  });
});
