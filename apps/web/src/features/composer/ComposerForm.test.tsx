import type { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AUDIENCE, encryptContent, newEpochKey, toBase64url } from "@osp/sdk";
import type { DraftRecord } from "../../vault/store";
import type { PublishRequest } from "./usePublish";
import { ComposerForm } from "./ComposerForm";
import { MemoryRouter } from "react-router-dom";
import { Signer } from "@osp/sdk";
import { encodeMention } from "../../util/mentions";

import { HARBINGER_CHAIN_ID } from "../../testing/fixtures";
const transport = vi.hoisted(() => ({ start: vi.fn(), group: vi.fn(), collections: vi.fn(), session: vi.fn(), hosted: false }));
vi.mock("../../api/mediaStorage", async original => ({ ...await original<typeof import("../../api/mediaStorage")>(), usesExternalMedia: () => transport.hosted }));
vi.mock("./usePublish", () => ({ usePublish: () => ({ ...transport, ready: true }) }));
vi.mock("../session", () => ({ useCanAct: () => ({ ok: true }), useSession: transport.session }));
vi.mock("../../vault/context", () => ({
  useVault: (selector: (state: { account: string }) => unknown) => selector({ account: "saved-test-account" }),
  useVaultStore: () => ({ getState: () => ({ account: "saved-test-account" }) }),
}));
vi.mock("../../api/services", () => {
  const services = { resolved: { sponsorUrls: [] }, indexer: { configured: false, collections: transport.collections, post: async () => undefined },
    protocol: { get chainId() { return HARBINGER_CHAIN_ID; }, reads: { publications: { get_collection: transport.group } } } };
  return { useServices: () => services, useOptionalServices: () => undefined };
});

let root: Root;
let container: HTMLDivElement;
const dialogMethods = {
  showModal: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"),
  close: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close"),
};

beforeEach(() => {
  transport.hosted = false;
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

type RichInput = HTMLElement & { editor: Editor };
const richInput = () => container.querySelector<RichInput>('.tiptap')!;
const setPostText = (element: RichInput, text: string) => element.editor.commands.setContent(text, { contentType: "markdown" });
async function render(audience: number) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onSubmitted = vi.fn();
  await act(async () => { root.render(<ComposerForm defaultAudience={audience} onSubmitted={onSubmitted} />); });
  const textarea = richInput();
  await act(async () => {
    setPostText(textarea, "A post to test publishing");
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
  it("accepts a full short story in a hosted post and keeps all its text through review", async () => {
    transport.hosted = true;
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    const text = "A full story, with paragraphs.\n\n".repeat(2000);
    const draft = { id: "story", attemptId: "00".repeat(16), account: "saved-test-account", state: "draft", text, audience: AUDIENCE.EVERYONE, mediaUrls: [], createdAt: Date.now(), updatedAt: Date.now() } as DraftRecord;
    transport.start.mockImplementation(async (r: PublishRequest) => r.draft);
    await act(async () => root.render(<ComposerForm draft={draft}/>));
    const textarea = richInput();
    expect(textarea.getAttribute("data-max-characters")).toBe("100000"); expect(textarea.textContent!.length).toBeGreaterThan(50000);
    expect(container.textContent).toContain("characters left");
    expect(button("Review and publish").disabled).toBe(false);
    await click("Review and publish"); await click("Publish to Everyone");
    expect(transport.start.mock.calls[0]![0].draft.text).toBe(text);
  });
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
    expect(textarea.editor.getText()).toBe("");
    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(false);
    expect(container.querySelector("form form")).toBeNull();
  });

  it.each([[AUDIENCE.EVERYONE, "Everyone"], [AUDIENCE.FRIENDS, "Friends"]] as const)("shows a failed local save to %s and preserves the post text", async (audience, label) => {
    transport.start.mockRejectedValue(new Error("Device storage unavailable"));
    const { textarea, onSubmitted } = await render(audience);
    await click(`Publish to ${label}`);
    expect(transport.start).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[role='alert']")?.textContent).toContain("Device storage unavailable");
    expect(textarea.editor.getText()).toBe("A post to test publishing");
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(false);
  });

  it("cancels the review without publishing or changing the text", async () => {
    const { textarea } = await render(AUDIENCE.EVERYONE);
    await click("Cancel");
    expect(transport.start).not.toHaveBeenCalled();
    expect(textarea.editor.getText()).toBe("A post to test publishing");
    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(false);
  });
});


it("preserves the poll definition through review and background publishing", async () => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  const poll = { question: "Which choice?", options: ["First", "Second"], closes_at: String(Date.now() + 3600000) };
  const draft = { id: "poll", attemptId: "00".repeat(16), account: "saved-test-account", state: "draft", text: poll.question, audience: AUDIENCE.EVERYONE, mediaUrls: [], createdAt: Date.now(), updatedAt: Date.now(), poll } as DraftRecord;
  transport.start.mockImplementation(async (r: PublishRequest) => r.draft);
  await act(async () => root.render(<ComposerForm draft={draft}/>));
  expect(container.textContent).toContain("Poll answers");
  await click("Review and publish");
  expect(container.querySelector("dialog")?.textContent).toContain("First");
  await click("Publish to Everyone");
  expect(transport.start.mock.calls[0]![0].draft.poll).toEqual(poll);
});

it.each([AUDIENCE.EVERYONE, AUDIENCE.FRIENDS])("preserves a saved mention target when publishing audience %s", async audience => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  const target = Signer.fromSeed("composer-mention-target").getAddress();
  const text = `Hello ${encodeMention("Alex Kim", target)}!`;
  const draft = { id: "mention", attemptId: "00".repeat(16), account: "saved-test-account", state: "draft", text, audience, mediaUrls: [], createdAt: Date.now(), updatedAt: Date.now() } as DraftRecord;
  transport.start.mockImplementation(async (r: PublishRequest) => r.draft);
  await act(async () => root.render(<MemoryRouter><ComposerForm draft={draft}/></MemoryRouter>));
  expect(richInput().textContent).toBe("Hello @Alex Kim!");
  await click("Review and publish");
  expect(container.querySelector("dialog .mention-link")?.getAttribute("href")).toBe(`/u/${target}`);
  await click(`Publish to ${audience === AUDIENCE.EVERYONE ? "Everyone" : "Friends"}`);
  expect(transport.start.mock.calls[0]![0].draft.text).toBe(text);
});

it("puts the poll button below the framed content box and omits the removed prompts", async () => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><ComposerForm/></MemoryRouter>));
  expect(container.textContent).not.toContain("What's on your mind?");
  expect(container.textContent).not.toContain("Type @ followed by a name or address to tag someone.");
  const content = container.querySelector(".composer-content")!, tools = container.querySelector(".composer-tools")!;
  expect(content.querySelector("[contenteditable=true]")).toBeTruthy();
  expect(content.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(tools.textContent).toContain("Add photos"); expect(tools.textContent).toContain("Add poll");
  await click("Add poll"); expect(container.querySelector(".poll-editor")).toBeTruthy();
});

it("chooses the photo budget before opening files and can dismiss either attachment dialog", async () => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(<ComposerForm/>));
  expect(container.textContent).not.toContain("Post content");
  expect(richInput()?.getAttribute("spellcheck")).toBe("true");
  const chooseFile = vi.spyOn(container.querySelector<HTMLInputElement>('input[aria-label="Choose photos"]')!, "click");
  await click("Add photos");
  expect(container.querySelector("dialog[open] h2")?.textContent).toBe("Photo size budget");
  expect(chooseFile).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>('dialog[open] button[aria-label="Close"]')!.click());
  expect(container.querySelector("dialog[open]")).toBeNull();
  await click("Add photos");
  await click("Up to 64 KiB2 usage units");
  expect(chooseFile).toHaveBeenCalledTimes(1);
  expect(container.querySelector("dialog[open]")).toBeNull();
  expect(container.textContent).not.toContain("Add media by URL");
  expect(container.querySelector("dialog[open]")).toBeNull();
  expect(transport.start).not.toHaveBeenCalled();
});

it("selects a verified group from the regular composer and queues the post to that group", async () => {
  const owner = Signer.fromSeed("group-owner").getAddress();
  const groupId = newEpochKey(), epochKey = newEpochKey();
  const group = toBase64url(groupId);
  const groupContent = encryptContent({
    content: { version: 1, mime: "application/vnd.osp.collection+json", text: JSON.stringify({ name: "Film club" }) },
    epochKey,
    aad: { chainId: HARBINGER_CHAIN_ID, author: owner, audience: AUDIENCE.CUSTOM, audienceId: groupId, postId: groupId, epoch: 1, versionNumber: 2 },
  });
  transport.session.mockReturnValue({ identity: { account: "saved-test-account" }, keys: { resolveTrusted: async () => ({entry: {key: epochKey}}) } });
  transport.collections.mockResolvedValue({ items: [{ id: group }] });
  transport.group.mockResolvedValue({ value: { owner, kind: 2, closed: false, members: ["saved-test-account"], revision: 1, audience: AUDIENCE.CUSTOM, envelope: groupContent.bytes } });
  transport.start.mockImplementation(async (r: PublishRequest) => r.draft);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><ComposerForm/></MemoryRouter>));
  const audience = container.querySelector("select")!;
  await act(async () => { audience.value = "group"; audience.dispatchEvent(new Event("change", { bubbles: true })); });
  const groupSelect = [...container.querySelectorAll("select")].find(select => [...select.options].some(o => o.text === "Film club"));
  expect(groupSelect).toBeDefined();
  const text = richInput();
  await act(async () => {
    setPostText(text, "See you tonight");
  });
  expect(button("Review and publish").disabled).toBe(true);
  await act(async () => { groupSelect!.value = group; groupSelect!.dispatchEvent(new Event("change", { bubbles: true })); });
  await click("Review and publish");
  await click("Publish to group");
  expect(transport.start.mock.calls[0]![0].draft).toMatchObject({ collectionId: group, audience: AUDIENCE.CUSTOM, text: "See you tonight" });
});

it("opens hosted photo files directly without asking for a chain size budget", async () => {
  transport.hosted = true;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(<ComposerForm/>));
  const chooseFile = vi.spyOn(container.querySelector<HTMLInputElement>('input[aria-label="Choose photos"]')!, "click");
  await click("Add photos");
  expect(chooseFile).toHaveBeenCalledOnce();
  expect(container.textContent).not.toContain("Photo size budget");
});

it("formats the poll question and answer visually and publishes their Markdown intact", async () => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  const poll = { question: "Choose?", options: ["First", "Second"], closes_at: String(Date.now()+3600000) };
  const draft = { id: "formatted-poll", attemptId: "00".repeat(16), account: "saved-test-account", state: "draft", text: poll.question, audience: AUDIENCE.EVERYONE, mediaUrls: [], createdAt: Date.now(), updatedAt: Date.now(), poll } as DraftRecord;
  transport.start.mockImplementation(async (r: PublishRequest) => r.draft);
  await act(async () => root.render(<ComposerForm draft={draft}/>));
  const question = container.querySelector<RichInput>('[role="textbox"][aria-label="Your poll question"]')!;
  const first = container.querySelector<RichInput>('[role="textbox"][aria-label="Answer 1"]')!;
  await act(async () => { question.editor.commands.selectAll(); question.editor.commands.toggleBold(); first.editor.commands.selectAll(); first.editor.commands.toggleItalic(); });
  expect(question.querySelector("strong")?.textContent).toBe("Choose?");
  expect(first.querySelector("em")?.textContent).toBe("First");
  await click("Review and publish");
  expect(container.querySelector("dialog .preview strong")?.textContent).toBe("Choose?");
  expect(container.querySelector("dialog li em")?.textContent).toBe("First");
  await click("Publish to Everyone");
  expect(transport.start.mock.calls[0]![0].draft.poll).toEqual({ ...poll, question: "**Choose?**", options: ["*First*", "Second"] });
});

it("reviews a quote without requiring commentary and preserves the reference in the saved draft", async () => {
  transport.hosted=true;
  const quote={postId:toBase64url(new Uint8Array(32).fill(65)),version:toBase64url(new Uint8Array(32).fill(66))};
  container=document.createElement('div'); document.body.appendChild(container);root=createRoot(container);
  transport.start.mockImplementation(async (r:PublishRequest)=>r.draft);
  const onClose=vi.fn();
  await act(async()=>root.render(<MemoryRouter><ComposerForm quote={quote} onClose={onClose}/></MemoryRouter>));
  expect(button('Review and publish').disabled).toBe(false);
  expect(container.querySelector('.composer-author-row strong')?.textContent).toBe('You');
  expect(container.querySelector('.composer-author-row select')).toBeTruthy();expect(container.querySelector('.composer-identity .composer-modes')).toBeTruthy();
  expect(container.textContent).not.toContain('Add media by URL');
  await click('Review and publish'); await click('Publish to Everyone');
  expect(transport.start.mock.calls[0]![0].draft.quote).toEqual(quote);
  expect(transport.start.mock.calls[0]![0].draft.text).toBe('');
  await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Close composer"]')!.click());expect(onClose).toHaveBeenCalledOnce();
});
