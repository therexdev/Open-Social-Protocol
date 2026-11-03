import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type TextareaHTMLAttributes } from "react";
import { isAddress, normalizeNickname } from "@osp/sdk";
import { useServices } from "../../api/services";
import { parseProfileUri } from "../../api/profiles";
import { Avatar } from "../../components/Icon";
import { useMessagePeople } from "../messages/useMessagePeople";
import { shortAddress } from "../../util/format";
import { editMentionText, findMentionQuery, insertMention, readMentionText, writeMentionText } from "./mentionText";

interface Person { account: string; name: string }
interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
  account?: string;
  value: string;
  onValueChange: (value: string) => void;
}

export function MentionTextarea({ account, value, onValueChange, ...props }: Props) {
  const { indexer } = useServices();
  const id = useId(), input = useRef<HTMLTextAreaElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const nextCaret = useRef<number | undefined>(undefined);
  const composing = useRef(false);
  const [activated, setActivated] = useState(false);
  const [focused, setFocused] = useState(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [dismissed, setDismissed] = useState(false);
  const [activeAccount, setActiveAccount] = useState<string>();
  const [results, setResults] = useState<Person[]>([]);
  const [directory, setDirectory] = useState<Person[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [placement, setPlacement] = useState({ above: false, height: 270 });
  const contacts = useMessagePeople(activated ? account : undefined, []);
  const draft = useMemo(() => readMentionText(value), [value]);
  const query = focused && !dismissed && !props.disabled && !props.readOnly && !composing.current
    ? findMentionQuery(draft, selection.start, selection.end) : undefined;
  const text = query?.query.trim();
  const open = !!query;

  // Warm the public names alongside friend profiles. Filtering can then happen
  // immediately, including while a subsequent name-search request is in flight.
  useEffect(() => {
    let alive = true;
    setDirectory([]);
    if (!activated || !indexer.configured) { setLoadingDirectory(false); return; }
    setLoadingDirectory(true);
    void indexer.searchPeople("", 100).then(people => {
      if (alive) setDirectory(people.filter(person => isAddress(person.account)).map(person => ({
        account: person.account,
        name: parseProfileUri(person.profileUri)?.display_name?.trim() || shortAddress(person.account),
      })));
    }).catch(() => {
      // Friends and individual name searches remain usable without the warm-up.
    }).finally(() => { if (alive) setLoadingDirectory(false); });
    return () => { alive = false; };
  }, [activated, indexer, account]);

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      if (!editor.current) return;
      const rect = editor.current.getBoundingClientRect(), viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0, bottom = top + (viewport?.height ?? window.innerHeight);
      const aboveRoom = rect.top - top - 8, belowRoom = bottom - rect.bottom - 8;
      const above = belowRoom < 200 && aboveRoom > belowRoom;
      const height = Math.max(58, Math.min(270, Math.floor((above ? aboveRoom : belowRoom) - 100)));
      setPlacement(current => current.above === above && current.height === height ? current : { above, height });
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (nextCaret.current === undefined || !input.current) return;
    input.current.setSelectionRange(nextCaret.current, nextCaret.current);
    nextCaret.current = undefined;
  }, [value]);

  useEffect(() => {
    let alive = true;
    setResults([]); setSearchError(false); setActiveAccount(undefined);
    if (!open || !text || !indexer.configured) { setSearching(false); return; }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void indexer.searchPeople(text, 20).then(people => {
        if (alive) setResults(people.filter(person => isAddress(person.account)).map(person => ({
          account: person.account,
          name: parseProfileUri(person.profileUri)?.display_name?.trim() || shortAddress(person.account),
        })));
      }).catch(() => { if (alive) setSearchError(true); })
        .finally(() => { if (alive) setSearching(false); });
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [text, open, indexer, account]);

  const blocked = new Set([...contacts.blocked, ...(contacts.graph?.blockedBy ?? []), account ?? ""]);
  const friends = new Set(contacts.friends);
  const choices = new Map<string, Person>();
  const publicPeople = new Map([...directory, ...results].map(person => [person.account, person]));
  for (const peer of contacts.friends) {
    // A public-directory name can arrive before a friend's profile request.
    const person = publicPeople.get(peer);
    choices.set(peer, person && person.name !== shortAddress(peer) ? person : { account: peer, name: contacts.name(peer) });
  }
  for (const person of publicPeople.values()) if (!choices.has(person.account)) choices.set(person.account, person);
  const normalized = normalizeNickname(text ?? "");
  const people = [...choices.values()].filter(person => !blocked.has(person.account) && isAddress(person.account) &&
    (!normalized || normalizeNickname(person.name).includes(normalized) || person.account.startsWith(text!)))
    .sort((a, b) => Number(friends.has(b.account)) - Number(friends.has(a.account)) || a.name.localeCompare(b.name) || a.account.localeCompare(b.account))
    .slice(0, 20);
  const active = people.findIndex(person => person.account === activeAccount);

  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, open, id]);

  const updateSelection = (element: HTMLTextAreaElement) => {
    setSelection({ start: element.selectionStart, end: element.selectionEnd });
  };
  const choose = (person: Person) => {
    if (!query) return;
    const next = insertMention(draft, query, person);
    const saved = writeMentionText(next.value);
    nextCaret.current = next.caret;
    setSelection({ start: next.caret, end: next.caret });
    setDismissed(true); setActiveAccount(undefined);
    onValueChange(saved);
    input.current?.focus();
  };

  return <div ref={editor} className="mention-editor" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setFocused(false); setDismissed(true); }
  }}>
    <textarea {...props} ref={input} value={draft.text}
      aria-autocomplete="list" aria-haspopup="listbox" aria-controls={open ? `${id}-options` : undefined}
      aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
      aria-describedby={[props["aria-describedby"], `${id}-hint`].filter(Boolean).join(" ")}
      onFocus={event => { setActivated(true); setFocused(true); setDismissed(false); updateSelection(event.currentTarget); props.onFocus?.(event); }}
      onClick={event => { setDismissed(false); updateSelection(event.currentTarget); props.onClick?.(event); }}
      onSelect={event => updateSelection(event.currentTarget)}
      onCompositionStart={() => { composing.current = true; setDismissed(true); }}
      onCompositionEnd={event => { composing.current = false; setDismissed(false); updateSelection(event.currentTarget); }}
      onChange={event => {
        const next = editMentionText(draft, event.currentTarget.value, event.currentTarget.selectionStart);
        updateSelection(event.currentTarget); setDismissed(false); setActiveAccount(undefined);
        onValueChange(writeMentionText(next));
      }}
      onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDismissed(true); return; }
        if (open && people.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          const next = active < 0 ? (event.key === "ArrowDown" ? 0 : people.length - 1)
            : (active + (event.key === "ArrowDown" ? 1 : people.length - 1)) % people.length;
          setActiveAccount(people[next]!.account); return;
        }
        if (open && active >= 0 && event.key === "Enter" && !event.shiftKey) {
          event.preventDefault(); choose(people[active]!); return;
        }
        if (event.key === "Enter" || event.key === "Tab") setDismissed(true);
        props.onKeyDown?.(event);
      }} />
    <p className="hint mention-hint" id={`${id}-hint`}>Type @ followed by a name or address to tag someone.</p>
    {open && <div className="mention-dropdown" data-placement={placement.above ? "above" : "below"}>
      <p className="hint">Friends first · type a name or address to filter</p>
      <div id={`${id}-options`} role="listbox" aria-label="People to tag" className="mention-options" style={{ maxHeight: placement.height }}>
        {people.map((person, i) => <button key={person.account} id={`${id}-${i}`} type="button"
          role="option" aria-selected={active === i} tabIndex={-1} className="mention-person"
          onPointerDown={event => { if (event.pointerType !== "touch") event.preventDefault(); }}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(person)}>
          <Avatar account={person.account} name={person.name}/>
          <span className="mention-person-copy"><strong>{person.name}</strong><small>{person.account}</small></span>
          {friends.has(person.account) && <small className="mention-friend">Friend</small>}
        </button>)}
      </div>
      <div role="status" className="hint">
        {(searching || contacts.loading || loadingDirectory) ? "Finding people…" : !people.length ? text ? "No matching people." : "Type a name to search for someone." : "Use ↑ ↓ and Enter, or select a person."}
        {contacts.error && <p>Your friends couldn’t be loaded. You can still search by name.</p>}
        {searchError && <p>People search is unavailable. You can still select a matching friend.</p>}
      </div>
    </div>}
  </div>;
}
