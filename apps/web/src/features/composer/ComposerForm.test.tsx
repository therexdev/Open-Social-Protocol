import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AUDIENCE } from "@osp/sdk";
import type { PublishPlan } from "./publish";
import type { PublishOutcome, PublishRequest } from "./usePublish";
import { ComposerForm } from "./ComposerForm";

const transport = vi.hoisted(() => ({ plan: vi.fn(), publish: vi.fn() }));
vi.mock("./usePublish", () => ({ usePublish: () => ({ ...transport, ready: true }) }));
vi.mock("../session", () => ({ useCanAct: () => ({ ok: true }) }));
vi.mock("../../vault/context", () => ({
  useVault: (selector: (state: { account: string }) => unknown) => selector({ account: "saved-test-account" }),
}));

let root: Root;
let container: HTMLDivElement;
const dialogMethods = {
  showModal: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"),
  close: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close"),
};

beforeEach(() => {
  transport.plan.mockReset().mockImplementation(async ({ draft }: PublishRequest): Promise<PublishPlan> => ({
    operations: [], postId: new Uint8Array(32), contentHash: new Uint8Array(32), idempotencyKey: new Uint8Array(32),
    audience: draft.audience, epoch: 1, sequence: "1", versionNumber: 1, envelopeBytes: 100, recipients: [], skipped: [],
  }));
  transport.publish.mockReset();
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
  const onPublished = vi.fn();
  await act(async () => { root.render(<ComposerForm defaultAudience={audience} onPublished={onPublished} />); });
  const textarea = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "A post to test publishing");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Review and publish");
  return { textarea, onPublished };
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
  it.each([[AUDIENCE.EVERYONE, "Everyone"], [AUDIENCE.FRIENDS, "Friends"]] as const)("publishes to %s exactly once without starting another review", async (audience, label) => {
    let finish!: (value: PublishOutcome) => void;
    transport.publish.mockImplementation(() => new Promise<PublishOutcome>((resolve) => { finish = resolve; }));
    const { textarea, onPublished } = await render(audience);
    const preparedDraft = transport.plan.mock.calls[0]![0].draft;
    await click(`Publish to ${label}`);
    expect(transport.publish).toHaveBeenCalledTimes(1);
    expect(transport.publish.mock.calls[0]![0].draft).toBe(preparedDraft);
    expect(transport.publish.mock.calls[0]![1].audience).toBe(audience);
    expect(transport.plan).toHaveBeenCalledTimes(1);
    expect(button("Publishing…").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);
    await act(async () => { container.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })); });
    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    await click("Publishing…");
    expect(transport.publish).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ postId: "published-post", reconciled: false }); });
    expect(onPublished).toHaveBeenCalledWith({ postId: "published-post", reconciled: false });
    expect(textarea.value).toBe("");
    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(false);
    expect(container.querySelector("form form")).toBeNull();
  });

  it.each([[AUDIENCE.EVERYONE, "Everyone"], [AUDIENCE.FRIENDS, "Friends"]] as const)("shows a failed publish to %s and preserves the post text", async (audience, label) => {
    transport.publish.mockRejectedValue(new Error("Sponsor temporarily unavailable"));
    const { textarea, onPublished } = await render(audience);
    await click(`Publish to ${label}`);
    expect(transport.plan).toHaveBeenCalledTimes(1);
    expect(transport.publish).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[role='alert']")?.textContent).toContain("Sponsor temporarily unavailable");
    expect(textarea.value).toBe("A post to test publishing");
    expect(onPublished).not.toHaveBeenCalled();
    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(false);
  });

  it("cancels the review without publishing or changing the text", async () => {
    const { textarea } = await render(AUDIENCE.EVERYONE);
    await click("Cancel");
    expect(transport.publish).not.toHaveBeenCalled();
    expect(transport.plan).toHaveBeenCalledTimes(1);
    expect(textarea.value).toBe("A post to test publishing");
    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(false);
  });
});
