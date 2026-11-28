import { afterEach, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/react";
import { Signer } from "@osp/sdk";
import { RichPostEditor } from "./RichPostEditor";
import { encodeMention } from "../../util/mentions";
const mocks = vi.hoisted(() => ({ search: vi.fn().mockResolvedValue([]) }));
vi.mock("../../api/services", () => { const indexer = { configured: true, searchPeople: mocks.search }; return { useServices: () => ({ indexer }) }; });
vi.mock("../messages/useMessagePeople", () => ({ useMessagePeople: () => ({ friends: [], blocked: [], graph: { blockedBy: [] }, name: (a: string) => a, loading: false }) }));
let root: Root, host: HTMLDivElement, editor: Editor;
const saved = vi.fn();
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); saved.mockClear(); mocks.search.mockReset().mockResolvedValue([]); });
async function render(value = "", limit = 100000) {
  function Harness() { const [text, set] = useState(value); return <RichPostEditor id="post" value={text} account="me" onValueChange={s => { saved(s); set(s); }} label="Write a post" placeholder="Write a post…" maxLength={limit}/>; }
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness/>));
  editor = (host.querySelector(".tiptap") as HTMLElement & { editor: Editor }).editor;
}
async function button(label: string) { await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click()); }
it("edits visible bold text with a real selection and supports undo and redo while emitting Markdown", async () => {
  await render("A simple post");
  await act(async () => { editor.commands.setTextSelection({ from: 1, to: 9 }); });
  await button("Bold");
  expect(host.querySelector(".tiptap strong")?.textContent).toBe("A simple");
  expect(host.querySelector(".tiptap")?.textContent).toBe("A simple post");
  expect(saved).toHaveBeenLastCalledWith("**A simple** post");
  await button("Undo"); expect(host.querySelector(".tiptap strong")).toBeNull();
  await button("Redo"); expect(host.querySelector(".tiptap strong")?.textContent).toBe("A simple");
});
it("imports saved Markdown, keeps the original draft unchanged until edited, and preserves mentions with special names", async () => {
  const account = Signer.fromSeed("rich-editor-mentioned").getAddress(), mention = encodeMention("Alex [Team] **Stars**", account);
  const text = `## Heading\n\n**Bold** and *italic*. Hello ${mention}!\n\n- One\n- Two`;
  await render(text);
  expect(host.querySelector(".tiptap h2")?.textContent).toBe("Heading");
  expect(host.querySelector(".editor-mention")?.textContent).toBe("@Alex [Team] **Stars**");
  expect(host.querySelector(".editor-mention")?.getAttribute("data-osp-mention")).toBe(account);
  expect(saved).not.toHaveBeenCalled();
  await act(async () => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, "!"); });
  expect(saved.mock.lastCall![0]).toContain(mention);
});
it("pastes rich document HTML as semantic formatting and Markdown without scripts, images or unsafe links", async () => {
  await render();
  await act(async () => { editor.view.pasteHTML('<h2>Copied heading</h2><p><span style="font-weight:700">Bold</span> and <em>italic</em> <a href="https://example.com">source</a><script>alert(1)</script><img src="https://tracker.test/pixel"><a href="javascript:alert(1)">unsafe</a></p><ol><li>First</li><li>Second</li></ol><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>', new Event('paste') as ClipboardEvent); });
  expect(host.querySelector(".tiptap h2")?.textContent).toBe("Copied heading");
  expect(host.querySelector(".tiptap strong")?.textContent).toBe("Bold");
  expect(host.querySelector(".tiptap em")?.textContent).toBe("italic");
  expect(host.querySelectorAll(".tiptap ol li")).toHaveLength(2);
  expect(host.querySelector(".tiptap td")?.textContent).toBe("1");
  expect(host.querySelector(".tiptap script,.tiptap img,.tiptap a[href^='javascript:']")).toBeNull();
  const markdown = saved.mock.lastCall![0];
  expect(markdown).toContain("## Copied heading"); expect(markdown).toContain("**Bold**"); expect(markdown).toContain("*italic*"); expect(markdown).toContain("[source](https://example.com)");
  expect(markdown).not.toMatch(/<script|tracker\.test|javascript:/);
});
it("converts Word list paragraphs into a real list", async () => {
  await render();
  await act(async () => { editor.view.pasteHTML('<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">1. </span>One</p><p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">2. </span>Two</p>', new Event('paste') as ClipboardEvent); });
  expect(host.querySelectorAll(".tiptap ol li")).toHaveLength(2);
  expect(editor.getMarkdown()).toMatch(/1\. One\n2\. Two/);
});
it("rejects an oversized paste without cutting the existing draft", async () => {
  await render("Keep this draft", 50);
  await act(async () => { editor.commands.insertContent("x".repeat(100)); });
  expect(editor.getMarkdown()).toBe("Keep this draft");
  expect(host.querySelector('[role="status"]')?.textContent).toContain("50 characters");
  expect(saved).not.toHaveBeenCalled();
});
it("keeps raw HTML from an existing Markdown post literal", async () => {
  await render('<strong>Literal tags</strong>\n\n<script>alert(1)</script>');
  expect(host.querySelector(".tiptap strong,.tiptap script")).toBeNull();
  expect(host.querySelector(".tiptap")?.textContent).toContain("<strong>Literal tags</strong>");
});

it("pastes Markdown as visible formatting and preserves a maximum-length story with paragraphs", async () => {
  await render();
  const paste = async (text: string) => { await act(async () => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event,"clipboardData",{ value: { getData: (type: string) => type === "text/plain" ? text : "" } });
    editor.view.pasteText(text,event as ClipboardEvent);
  }); };
  await paste("## Heading\n\n**Bold** and *italic*.");
  expect(host.querySelector(".tiptap h2")?.textContent).toBe("Heading");
  expect(host.querySelector(".tiptap strong")?.textContent).toBe("Bold");
  await act(async () => { editor.commands.clearContent(); });
  const ending = "The very last sentence.";
  const story = ("A complete story with paragraphs. ".repeat(5)+"\n\n").repeat(800).slice(0,100000-ending.length)+ending;
  await paste(story);
  expect(editor.getMarkdown()).toBe(story); expect(saved).toHaveBeenLastCalledWith(story);
});
it("finds people while typing and inserts an account-bound mention into formatted text", async () => {
  const target = Signer.fromSeed("rich-picker").getAddress();
  const { buildProfileDocument } = await import("../../api/profiles");
  mocks.search.mockResolvedValue([{ account: target, profileUri: buildProfileDocument({ display_name: "Zoë Friend" }).uri }]);
  await render();
  await act(async () => { editor.view.focus(); editor.commands.insertContent("Hello @"); });
  await vi.waitFor(() => expect(host.querySelector('[role="option"]')?.textContent).toContain("Zoë Friend"));
  await act(async () => { host.querySelector<HTMLButtonElement>('[role="option"]')!.click(); });
  expect(editor.getMarkdown()).toContain(encodeMention("Zoë Friend",target));
  expect(host.querySelector(".editor-mention")?.textContent).toBe("@Zoë Friend");
});

it("inserts a visible link at the cursor and applies it with Enter without submitting a post", async () => {
  await render(); await button("Link");
  const input = host.querySelector<HTMLInputElement>('input[type=url]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"https://example.com/story"); input.dispatchEvent(new Event("input",{ bubbles: true })); });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown",{ key: "Enter", bubbles: true, cancelable: true })); });
  expect(host.querySelector(".tiptap a")?.getAttribute("href")).toBe("https://example.com/story");
  expect(editor.getText()).toBe("https://example.com/story");
  expect(editor.getMarkdown()).toContain("https://example.com/story");
});
