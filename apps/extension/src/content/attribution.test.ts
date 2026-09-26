import { afterEach, expect, it, vi } from "vitest";
import { ComposerAttribution, ATTRIBUTION_TEXT, ATTRIBUTION_URL } from "./attribution";
import { facebookAdapter, startFacebookAdapter, type RunningAdapter } from "./facebookAdapter";
import { CONTROL_ATTR } from "./adapter";

let running: RunningAdapter | null;
afterEach(() => { running?.stop(); running = null; document.body.innerHTML = ""; vi.restoreAllMocks(); });

function composer() {
  document.body.innerHTML = '<div role="dialog"><div role="textbox" contenteditable="true"><span data-mention="friend">Friend</span> says hello</div><footer><button aria-label="Post">Post</button></footer></div>';
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  const textbox = dialog.querySelector<HTMLElement>('[role="textbox"]')!;
  // Emulate the native editing boundary that jsdom lacks. Actual browser acceptance is separate.
  document.execCommand = vi.fn((command: string, _ui?: boolean, value?: string) => {
    const range = document.getSelection()!.getRangeAt(0);
    range.deleteContents();
    if (command === "insertText") range.insertNode(document.createTextNode(value!));
    textbox.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: command === "delete" ? "deleteContentBackward" : "insertText", data: value }));
    return true;
  });
  return { dialog, textbox };
}

it("appends through native editing, keeps mentions intact, strips only its own footer from the protocol copy, and removes it on opt-out", () => {
  const { dialog, textbox } = composer();
  const mention = textbox.firstChild;
  const controller = new ComposerAttribution(dialog, facebookAdapter);
  controller.sync(true); controller.sync(true);
  expect(textbox.textContent).toBe(`Friend says hello\n\n${ATTRIBUTION_TEXT}`);
  expect(controller.text()).toBe("Friend says hello");
  expect(textbox.firstChild).toBe(mention);
  expect(document.execCommand).toHaveBeenCalledTimes(1);
  controller.sync(false);
  expect(textbox.textContent).toBe("Friend says hello");
  expect(textbox.firstChild).toBe(mention);
});

it("moves the managed footer below later edits without duplicate links and leaves an author's own link alone", () => {
  const { dialog, textbox } = composer();
  const controller = new ComposerAttribution(dialog, facebookAdapter);
  controller.sync(true); textbox.append(document.createTextNode("\nMore to say")); controller.sync(true);
  expect(textbox.textContent?.endsWith(ATTRIBUTION_TEXT)).toBe(true);
  expect(textbox.textContent?.split(ATTRIBUTION_URL)).toHaveLength(2);
  expect(controller.text()).toBe("Friend says hello\nMore to say");
  const other = new ComposerAttribution(dialog, facebookAdapter);
  other.sync(false); expect(textbox.textContent).toContain(ATTRIBUTION_TEXT);
});

it("shows a visible failure when a host refuses native editing, without replacing the draft DOM", () => {
  const { dialog, textbox } = composer();
  const host = document.createElement("div"); host.setAttribute(CONTROL_ATTR, "1"); dialog.append(host);
  document.execCommand = vi.fn(() => false);
  new ComposerAttribution(dialog, facebookAdapter).sync(true);
  expect(textbox.textContent).toBe("Friend says hello");
  expect(host.textContent).toContain("Facebook did not accept");
});

it.each([true, false])("honors the stored setting (%s), opt-in and trusted Post; Facebook gets the footer while Open Social gets the original text", async enabled => {
  const { textbox } = composer();
  let facebookDraft = textbox.textContent;
  textbox.addEventListener("input", () => { facebookDraft = textbox.textContent; });
  const sendMessage = vi.fn(async (message: unknown) => (message as { type: string }).type === "adapter.preferences"
    ? { ok: true, result: { facebookAttribution: enabled } }
    : { ok: true, result: { status: "published", message: "Published" } });
  running = startFacebookAdapter({ document, sendMessage, location: () => "https://www.facebook.com/", randomAttemptId: () => "ab".repeat(16), trustedEvent: () => true });
  await Promise.resolve(); await Promise.resolve();
  expect(textbox.textContent).toBe("Friend says hello");
  const checkbox = document.querySelector<HTMLInputElement>(`[${CONTROL_ATTR}] input`)!;
  checkbox.checked = true; checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  expect(facebookDraft?.includes(ATTRIBUTION_URL)).toBe(enabled);
  document.querySelector<HTMLButtonElement>('[aria-label="Post"]')!.click();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "crosspost.publish", payload: expect.objectContaining({ text: "Friend says hello" }) }));
  await Promise.resolve();
  checkbox.checked = false; checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  expect(textbox.textContent).toBe("Friend says hello");
});
