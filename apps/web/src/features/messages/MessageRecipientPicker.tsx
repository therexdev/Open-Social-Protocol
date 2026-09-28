import { useEffect, useId, useRef, useState } from "react";
import { isAddress } from "@osp/sdk";
import { useServices } from "../../api/services";
import { parseProfileUri } from "../../api/profiles";
import { Avatar, Icon } from "../../components/Icon";
import { Button } from "../../components/ui";
import { shortAddress } from "../../util/format";

interface Person { account: string; name: string }
interface Props {
  account?: string;
  value: string;
  onChange: (account: string) => void;
  friends: string[];
  blocked: string[];
  name: (account: string) => string;
  loading: boolean;
  friendsError?: string;
  retryFriends: () => void;
  disabled?: boolean;
}

export function MessageRecipientPicker(props: Props) {
  const { indexer } = useServices();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const chosen = useRef<Person | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [results, setResults] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const text = query.trim();

  useEffect(() => {
    // Profile links select an address; async name hydration must not replace typing.
    if (props.value) {
      setQuery(chosen.current?.account === props.value ? chosen.current.name : props.name(props.value));
      setOpen(false);
    }
  }, [props.value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    setResults([]);
    setError("");
    setActive(-1);
    if (!open || !text || !indexer.configured) { setSearching(false); return; }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void indexer.searchPeople(text, 20).then(people => {
        if (alive) setResults(people.map(person => ({
          account: person.account,
          name: parseProfileUri(person.profileUri)?.display_name || shortAddress(person.account),
        })));
      }).catch(() => {
        if (alive) setError("People search is unavailable. You can still choose a friend or enter an account address.");
      }).finally(() => { if (alive) setSearching(false); });
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [text, open, indexer, revision]);

  const matches = (person: Person) => !text ||
    `${person.name} ${person.account}`.toLocaleLowerCase().includes(text.toLocaleLowerCase());
  const choices = new Map<string, Person>();
  props.friends.map(account => ({ account, name: props.name(account) }))
    .filter(matches).sort((a, b) => a.name.localeCompare(b.name))
    .forEach(person => choices.set(person.account, person));
  results.forEach(person => { if (!choices.has(person.account)) choices.set(person.account, person); });
  if (isAddress(text) && !choices.has(text)) choices.set(text, { account: text, name: props.name(text) });
  choices.delete(props.account ?? "");
  props.blocked.forEach(account => choices.delete(account));
  const people = [...choices.values()].slice(0, 20);
  const choose = (person: Person) => {
    chosen.current = person;
    props.onChange(person.account);
    setQuery(person.name);
    setOpen(false);
    setActive(-1);
  };

  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, open, id]);

  return <div className="field message-recipient" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <label htmlFor={id}>Find a person</label>
    <div className="message-recipient-input">
      <Icon name="search" />
      <input ref={input} id={id} role="combobox" aria-autocomplete="list"
        aria-expanded={open} aria-controls={`${id}-options`}
        aria-activedescendant={open && active >= 0 && people[active] ? `${id}-${active}` : undefined}
        placeholder="Name or account address" autoComplete="off" maxLength={64}
        value={query} disabled={props.disabled}
        onFocus={() => setOpen(true)}
        onChange={event => { props.onChange(""); setQuery(event.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={event => {
          if (event.key === "Escape") { setOpen(false); setActive(-1); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            setActive(index => people.length ? (index + (event.key === "ArrowDown" ? 1 : people.length - 1) + people.length) % people.length : -1);
          }
          if (event.key === "Enter" && open) {
            event.preventDefault();
            // Duplicate nicknames are never resolved automatically.
            if (people[active]) choose(people[active]);
            else if (isAddress(text)) {
              const exact = people.find(person => person.account === text);
              if (exact) choose(exact);
            }
          }
        }} />
      <Button variant="ghost" aria-label={open ? "Hide people" : "Choose a friend"}
        disabled={props.disabled} onClick={() => { if (!open) input.current?.focus(); setOpen(!open); }}>
        <Icon name="people" />
      </Button>
    </div>
    {props.value && <p className="hint message-recipient-selected"><Icon name="check" size={16} />
      <strong>{chosen.current?.account === props.value ? chosen.current.name : props.name(props.value)}</strong><span className="mono">{props.value}</span>
    </p>}
    {open && <div className="message-recipient-dropdown">
      <p className="hint">{text ? "Friends first, then other people" : "Your friends · type to search everyone"}</p>
      <div id={`${id}-options`} role="listbox" aria-label="People" className="message-recipient-options">
        {people.map((person, index) => <button key={person.account} id={`${id}-${index}`}
          type="button" role="option" aria-selected={props.value === person.account}
          className={`message-person ${active === index ? "is-active" : ""}`}
          tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => choose(person)}>
          <Avatar account={person.account} name={person.name} />
          <span className="message-person-copy"><strong>{person.name}</strong><small className="mono">{person.account}</small></span>
          {props.friends.includes(person.account) && <small className="message-friend-tag">Friend</small>}
        </button>)}
      </div>
      <div aria-live="polite">
        {(searching || props.loading) && <p className="hint">Loading people…</p>}
        {!people.length && !searching && !props.loading && <p className="hint">{text ? "No matches. Try another name or paste their full address." : "No friends yet. Search a name or paste an account address."}</p>}
        {choices.size > 20 && <p className="hint">Keep typing to narrow the list.</p>}
        {props.friendsError && <p className="hint">Your friends couldn’t be loaded. <Button variant="ghost" onClick={props.retryFriends}>Retry friends</Button></p>}
        {error && <p className="hint">{error} <Button variant="ghost" onClick={() => setRevision(n => n + 1)}>Retry search</Button></p>}
      </div>
    </div>}
  </div>;
}
