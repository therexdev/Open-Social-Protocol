import { afterEach, expect, it, vi } from "vitest";
import { ComposerAttribution, attributionText, readFacebookText } from "./attribution";
import { facebookAdapter, startFacebookAdapter, type RunningAdapter } from "./facebookAdapter";
import { CONTROL_ATTR } from "./adapter";

const ATTRIBUTION_URL = "https://opensocial.online/u/1JgvtKNBKCxT3D1xb8mmUJLCBpZnHqC3Rr";
const ATTRIBUTION_TEXT = attributionText(ATTRIBUTION_URL);
let running: RunningAdapter | null;
afterEach(() => { running?.stop(); running = null; document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function composer() {
  document.body.innerHTML = '<div role="dialog"><div role="textbox" contenteditable="true"><span data-mention="friend">Friend</span> says hello</div><footer><button aria-label="Post">Post</button></footer></div>';
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  const textbox = dialog.querySelector<HTMLElement>('[role="textbox"]')!;
  class Transfer {
    value = "";
    setData(_type: string, value: string) { this.value = value; }
    getData() { return this.value; }
  }
  class Clipboard extends Event {
    clipboardData: Transfer;
    constructor(type: string, init: ClipboardEventInit) { super(type, init); this.clipboardData = init.clipboardData as unknown as Transfer; }
  }
  vi.stubGlobal("DataTransfer", Transfer); vi.stubGlobal("ClipboardEvent", Clipboard);
  for (const type of ["paste", "cut"]) textbox.addEventListener(type, event => {
    if (textbox.dataset.refuse) return;
    event.preventDefault();
    const range = document.getSelection()!.getRangeAt(0); range.deleteContents();
    if (type === "paste") range.insertNode(document.createTextNode((event as ClipboardEvent).clipboardData!.getData("text/plain")));
    textbox.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
  return { dialog, textbox };
}

it("appends through native editing, keeps mentions intact, strips only its own footer from the protocol copy, and removes it on opt-out", async () => {
  const { dialog, textbox } = composer();
  const mention = textbox.firstChild;
  const controller = new ComposerAttribution(dialog, facebookAdapter);
  const paste = vi.fn(); textbox.addEventListener("paste", paste);
  await controller.sync(true, ATTRIBUTION_URL); await controller.sync(true, ATTRIBUTION_URL);
  expect(textbox.textContent).toBe(`Friend says hello\n\n${ATTRIBUTION_TEXT}`);
  expect(controller.text()).toBe("Friend says hello");
  expect(textbox.firstChild).toBe(mention);
  expect(paste).toHaveBeenCalledTimes(1);
  await controller.sync(false);
  expect(textbox.textContent).toBe("Friend says hello");
  expect(textbox.firstChild).toBe(mention);
});

it("keeps later edits without duplicating the managed footer and leaves an author's own link alone", async () => {
  const { dialog, textbox } = composer();
  const controller = new ComposerAttribution(dialog, facebookAdapter);
  await controller.sync(true, ATTRIBUTION_URL); textbox.append(document.createTextNode("\nMore to say")); await controller.sync(true, ATTRIBUTION_URL);
  expect(textbox.textContent?.endsWith("More to say")).toBe(true);
  expect(textbox.textContent?.split(ATTRIBUTION_URL)).toHaveLength(2);
  expect(controller.text()).toBe("Friend says hello\nMore to say");
  const other = new ComposerAttribution(dialog, facebookAdapter);
  await other.sync(false); expect(textbox.textContent).toContain(ATTRIBUTION_TEXT);
});

it("shows a visible failure when a host refuses native editing, without replacing the draft DOM", async () => {
  const { dialog, textbox } = composer();
  const host = document.createElement("div"); host.setAttribute(CONTROL_ATTR, "1"); dialog.append(host);
  textbox.dataset.refuse = "true";
  const controller = new ComposerAttribution(dialog, facebookAdapter);
  await expect(controller.sync(true, ATTRIBUTION_URL)).rejects.toThrow("Facebook did not keep the draft intact");
  await expect(controller.sync(true, ATTRIBUTION_URL)).rejects.toThrow("insertion is stopped");
  expect(textbox.textContent).toBe("Friend says hello");
  expect(host.querySelector("textarea")?.value).toBe("Friend says hello");
});

it.each([true, false])("honors the stored setting (%s), opt-in and trusted Post; Facebook gets the footer while Open Social gets the original text", async enabled => {
  const { textbox } = composer();
  let facebookDraft = textbox.textContent;
  textbox.addEventListener("input", () => { facebookDraft = textbox.textContent; });
  const sendMessage = vi.fn(async (message: unknown) => (message as { type: string }).type === "adapter.preferences"
    ? { ok: true, result: { facebookAttribution: enabled, facebookAutoCheck: true } }
    : { ok: true, result: { status: "pending", awaitingFacebook: true, profileUrl: ATTRIBUTION_URL, message: "Waiting" } });
  running = startFacebookAdapter({ document, sendMessage, location: () => "https://www.facebook.com/", randomAttemptId: () => "ab".repeat(16), trustedEvent: () => true });
  await Promise.resolve(); await Promise.resolve();
  expect(textbox.textContent).toBe("Friend says hello");
  const checkbox = document.querySelector<HTMLInputElement>(`[${CONTROL_ATTR}] input`)!;
  checkbox.checked = true; checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  expect(facebookDraft?.includes(ATTRIBUTION_URL)).toBe(false); // no draft edits until Post
  document.querySelector<HTMLButtonElement>('[aria-label="Post"]')!.click();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "crosspost.publish", payload: expect.objectContaining({ text: "Friend says hello" }) }));
  await vi.waitFor(() => expect(facebookDraft?.includes(ATTRIBUTION_URL)).toBe(enabled));
  checkbox.checked = false; checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  await vi.waitFor(() => expect(textbox.textContent).toBe("Friend says hello"));
});

it("reads Lexical block and hard line breaks without joining a link to the next paragraph", () => {
  const { dialog, textbox } = composer(); textbox.dataset.lexicalEditor = "true";
  textbox.innerHTML = '<p>First<br>line<br><br></p><p><br></p><p><a href="https://opensocial.online/">https://opensocial.online/</a></p><p><br></p><p>Join Me On Open Social: profile</p>';
  expect(readFacebookText(dialog, facebookAdapter)).toBe("First\nline\n\n\nhttps://opensocial.online/\n\nJoin Me On Open Social: profile");
});
