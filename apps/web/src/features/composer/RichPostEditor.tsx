import Placeholder from "@tiptap/extension-placeholder";
import { editorMarkdownSource } from "./editorMarkdownSource";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { isAddress, normalizeNickname } from "@osp/sdk";
import { useServices } from "../../api/services";
import { parseProfileUri } from "../../api/profiles";
import { Avatar } from "../../components/Icon";
import { useMessagePeople } from "../messages/useMessagePeople";
import { shortAddress } from "../../util/format";
import { mentionName } from "../../util/mentions";
import { findMentionQuery } from "./mentionText";
import { emptyRichDocument, richEditorExtensions, safeEditorLink } from "./richEditorSchema";
import { cleanPastedHtml } from "./richPaste";

interface Props { id: string; account?: string; value: string; onValueChange: (value: string) => void; maxLength: number; label: string; placeholder: string; disabled?: boolean; required?: boolean; invalid?: boolean; compact?: boolean }
interface Person { account: string; name: string }
type Query = { from: number; to: number; text: string };
export function RichPostEditor(props: Props) {
  const { indexer } = useServices(), host = useRef<HTMLDivElement>(null);
  const latest = useRef(props); latest.current = props;
  const emitted = useRef(props.value), external = useRef(false);
  const [tick, setTick] = useState(0), [error, setError] = useState(""), [query, setQuery] = useState<Query>();
  const [activated, setActivated] = useState(false), [active, setActive] = useState(-1);
  const [directory, setDirectory] = useState<Person[]>([]), [results, setResults] = useState<Person[]>([]), [searching, setSearching] = useState(false);
  const [link, setLink] = useState<string>(), [linkError, setLinkError] = useState("");
  const [above, setAbove] = useState(false);
  const contacts = useMessagePeople(activated ? props.account : undefined, []);
  const picker = useRef<{ query?: Query; people: Person[]; active: number; choose?: (p: Person) => void }>({ people: [], active: -1 });
  const updateQuery = (editor: Editor) => {
    const { selection } = editor.state;
    if (!editor.isFocused || !selection.empty || editor.isActive("codeBlock") || editor.isActive("code") || editor.view.composing) { setQuery(undefined); return; }
    const before = selection.$from.parent.textBetween(0, selection.$from.parentOffset, undefined, "\ufffc");
    const found = findMentionQuery({ text: before, mentions: [] }, before.length);
    setQuery(found ? { from: selection.$from.start() + found.start, to: selection.from, text: found.query.trim() } : undefined);
  };
  const extensions = useMemo(() => [...richEditorExtensions(), Placeholder.configure({ placeholder: () => latest.current.placeholder }), Extension.create({
    name: "postLengthLimit", addProseMirrorPlugins() {
      const editor = this.editor;
      return [new Plugin({ filterTransaction: (transaction, state) => {
        if (!transaction.docChanged || external.current || transaction.getMeta("preventUpdate")) return true;
        const markdown = editor.markdown!.serialize(transaction.doc.toJSON());
        if (markdown.length <= latest.current.maxLength || transaction.doc.content.size < state.doc.content.size) return true;
        setError(`Posts can contain up to ${latest.current.maxLength.toLocaleString()} characters, including formatting.`); return false;
      } })];
    },
  })], [props.account]);
  const editor = useEditor({
    extensions, content: editorMarkdownSource(props.value), contentType: "markdown", immediatelyRender: true,
    editable: !props.disabled, injectCSS: false,
    editorProps: {
      attributes: { id: props.id, role: "textbox", "aria-label": props.label, "aria-multiline": "true", "aria-required": String(!!props.required), "data-placeholder": props.placeholder, "data-max-characters": String(props.maxLength), class: "rich-post-content post-markdown", spellcheck: "true" },
      transformPastedHTML: cleanPastedHtml,
      handlePaste: (_view, event) => {
        if (event.clipboardData?.getData("text/html")) return false;
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (!text) return false;
        editor?.commands.insertContent(editorMarkdownSource(text), { contentType: "markdown" }); return true;
      },
      handleKeyDown: (_view, event) => {
        const state = picker.current;
        if (!state.query || event.isComposing) return false;
        if (event.key === "Escape") { setQuery(undefined); return true; }
        if (state.people.length && ["ArrowDown", "ArrowUp"].includes(event.key)) { setActive(n => n < 0 ? event.key === "ArrowDown" ? 0 : state.people.length - 1 : (n + (event.key === "ArrowDown" ? 1 : state.people.length - 1)) % state.people.length); return true; }
        if (event.key === "Enter" && !event.shiftKey && state.active >= 0) { state.choose?.(state.people[state.active]!); return true; }
        return false;
      },
    },
    onFocus: ({ editor }) => { setActivated(true); updateQuery(editor); },
    onSelectionUpdate: ({ editor }) => { setTick(n => n + 1); updateQuery(editor); },
    onUpdate: ({ editor }) => {
      if (external.current) return;
      const markdown = editor.isEmpty ? "" : editor.getMarkdown(); emitted.current = markdown;
      latest.current.onValueChange(markdown); setError(""); setTick(n => n + 1); updateQuery(editor);
    },
  }, [props.account]);
  useEffect(() => {
    if (!editor || props.value === emitted.current) return;
    external.current = true;
    try { editor.commands.setContent(props.value ? editorMarkdownSource(props.value) : emptyRichDocument(), { contentType: props.value ? "markdown" : "json", emitUpdate: false }); emitted.current = props.value; setQuery(undefined); }
    finally { external.current = false; }
  }, [editor, props.value]);
  useEffect(() => {
    if (!editor) return;
    editor.setOptions({ editable: !props.disabled, editorProps: { ...editor.options.editorProps, attributes: {
      id: props.id, role: "textbox", "aria-label": props.label, "aria-multiline": "true", "aria-required": String(!!props.required),
      "aria-invalid": String(!!props.invalid), "data-max-characters": String(props.maxLength), "data-placeholder": props.placeholder,
      class: "rich-post-content post-markdown", spellcheck: "true",
    } } });
  }, [editor, props.disabled, props.invalid, props.maxLength, props.label, props.placeholder, props.id, props.required]);
  useEffect(() => {
    let alive = true; setDirectory([]);
    if (activated && indexer.configured) void indexer.searchPeople("", 100).then(values => { if (alive) setDirectory(values.filter(v => isAddress(v.account)).map(v => ({ account: v.account, name: parseProfileUri(v.profileUri)?.display_name?.trim() || shortAddress(v.account) }))); }).catch(() => {});
    return () => { alive = false; };
  }, [activated, indexer, props.account]);
  useEffect(() => {
    let alive = true; setResults([]); setActive(-1); setSearching(false);
    if (!query?.text || !indexer.configured) return;
    const timer = window.setTimeout(() => { setSearching(true); void indexer.searchPeople(query.text, 20).then(values => { if (alive) setResults(values.filter(v => isAddress(v.account)).map(v => ({ account: v.account, name: parseProfileUri(v.profileUri)?.display_name?.trim() || shortAddress(v.account) }))); }).catch(() => {}).finally(() => { if (alive) setSearching(false); }); }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [query?.text, indexer, props.account]);
  const blocked = new Set([...contacts.blocked, ...(contacts.graph?.blockedBy ?? []), props.account ?? ""]), friends = new Set(contacts.friends);
  const choices = new Map<string, Person>(contacts.friends.map(account => [account, { account, name: contacts.name(account) }]));
  for (const p of [...directory, ...results]) choices.set(p.account, p);
  const normalized = normalizeNickname(query?.text ?? "");
  const people = [...choices.values()].filter(p => !blocked.has(p.account) && isAddress(p.account) && (!normalized || normalizeNickname(p.name).includes(normalized) || p.account.startsWith(query!.text)))
    .sort((a,b) => Number(friends.has(b.account)) - Number(friends.has(a.account)) || a.name.localeCompare(b.name) || a.account.localeCompare(b.account)).slice(0,20);
  const choose = (person: Person) => {
    if (!editor || !query) return;
    editor.chain().focus().insertContentAt({ from: query.from, to: query.to }, [{ type: "ospMention", attrs: { account: person.account, label: mentionName(person.name, person.account) } }, { type: "text", text: " " }]).run();
    setQuery(undefined); setActive(-1);
  };
  picker.current = { query, people, active, choose };
  useLayoutEffect(() => {
    if (!query || !host.current) return;
    const place = () => { const rect = host.current!.getBoundingClientRect(); setAbove(window.innerHeight - rect.bottom < 240 && rect.top > 240); };
    place(); window.addEventListener("resize",place); window.addEventListener("scroll",place,true);
    return () => { window.removeEventListener("resize",place); window.removeEventListener("scroll",place,true); };
  }, [!!query]);
  useEffect(() => { if (active >= 0) document.getElementById(`${props.id}-mention-${active}`)?.scrollIntoView?.({ block: "nearest" }); }, [active, props.id]);
  const applyLink = () => {
    if (!editor || link === undefined) return;
    if (link && !safeEditorLink(link)) { setLinkError("Enter a valid https:// link."); return; }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!link) chain.unsetLink().run();
    else if (editor.state.selection.empty && !editor.isActive("link")) chain.insertContent({ type: "text", text: link, marks: [{ type: "link", attrs: { href: link } }] }).run();
    else chain.setLink({ href: link }).run();
    setLink(undefined); setLinkError("");
  };
  const run = (command: () => void) => { command(); setTick(n => n + 1); };
  void tick;
  const buttons = editor ? [
    ["Bold", "B", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run()],
    ["Italic", "I", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run()],
    ["Heading", "H2", editor.isActive("heading"), () => editor.chain().focus().toggleHeading({ level: 2 }).run()],
    ["Bulleted list", "• List", editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run()],
    ["Numbered list", "1.", editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run()],
    ["Quote", "❝", editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run()],
    ["Code", "</>", editor.isActive("code"), () => editor.chain().focus().toggleCode().run()],
  ] as const : [];
  return <div ref={host} className={`rich-post-editor mention-editor${props.compact ? " rich-post-compact" : ""}`} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setQuery(undefined); }}>
    <div className="markdown-toolbar" role="group" aria-label="Post formatting">
      {buttons.filter(([label]) => !props.compact || ["Bold", "Italic", "Code"].includes(label)).map(([label,glyph,pressed,command]) => <button key={label} type="button" aria-label={label} title={label} aria-pressed={pressed} disabled={props.disabled} onMouseDown={e => e.preventDefault()} onClick={() => run(command)}>{label === "Bold" ? <strong>{glyph}</strong> : label === "Italic" ? <em>{glyph}</em> : glyph}</button>)}
      <button type="button" aria-label="Link" title="Link" aria-pressed={editor?.isActive("link") ?? false} disabled={props.disabled} onMouseDown={e => e.preventDefault()} onClick={() => { setLink(String(editor?.getAttributes("link").href ?? "")); setLinkError(""); setQuery(undefined); }}>Link</button>
      <button type="button" aria-label="Undo" title="Undo" disabled={props.disabled || !editor?.can().undo()} onMouseDown={e => e.preventDefault()} onClick={() => run(() => { editor?.chain().focus().undo().run(); })}>↶</button>
      <button type="button" aria-label="Redo" title="Redo" disabled={props.disabled || !editor?.can().redo()} onMouseDown={e => e.preventDefault()} onClick={() => run(() => { editor?.chain().focus().redo().run(); })}>↷</button>
    </div>
    {link !== undefined && <div className="editor-link-tools"><label>Link URL<input type="url" value={link} placeholder="https://…" onChange={event => setLink(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); applyLink(); } if (event.key === "Escape") { event.preventDefault(); setLink(undefined); } }}/></label><button type="button" className="btn" onClick={applyLink}>Apply</button><button type="button" className="btn btn-ghost" onClick={() => setLink(undefined)}>Cancel link</button>{linkError && <p role="status">{linkError}</p>}</div>}
    <EditorContent editor={editor}/>
    {error && <p className="hint" role="status">{error}</p>}
    {query && <div className="mention-dropdown" data-placement={above ? "above" : "below"}>
      <p className="hint">Friends first · type a name or address to filter</p>
      <div role="listbox" aria-label="People to tag" className="mention-options" style={{ maxHeight: 220 }}>
        {people.map((person,i) => <button key={person.account} id={`${props.id}-mention-${i}`} type="button" role="option" aria-selected={active === i} className="mention-person" onMouseDown={event => event.preventDefault()} onClick={() => choose(person)}><Avatar account={person.account} name={person.name}/><span className="mention-person-copy"><strong>{person.name}</strong><small>{person.account}</small></span>{friends.has(person.account) && <small className="mention-friend">Friend</small>}</button>)}
      </div><p className="hint" role="status">{searching || contacts.loading ? "Finding people…" : !people.length ? "No matching people." : "Use ↑ ↓ and Enter, or select a person."}</p>
    </div>}
  </div>;
}
