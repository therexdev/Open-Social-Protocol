import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { isAddress } from "@osp/sdk";
import { Avatar, Icon } from "../../components/Icon";
import { AccountLink, Button, Card, Field, Notice } from "../../components/ui";
import { useCanAct } from "../session";
import { usePrivateMessaging } from "./PrivateMessagingProvider";
import { MessageRecipientPicker } from "./MessageRecipientPicker";
import { useMessagePeople } from "./useMessagePeople";
import type { PrivateSnapshot } from "./privateService";
import { RichText } from "../../components/RichText";

const labels = {
  incoming: "Message request",
  outgoing: "Connecting",
  accepting: "Connecting",
  ready: "Connected",
  closed: "Closed",
};
function chatLabel(chat: PrivateSnapshot["chats"][number]): string {
  if (chat.error) return "Needs attention";
  if (chat.closing) return "Closing · notifying peer";
  if (chat.status !== "outgoing") return labels[chat.status];
  return chat.requestDelivery === "failed" ? "Needs attention" : "Connecting";
}
export function MessagesPage() {
  const { service, snapshot } = usePrivateMessaging(),
    can = useCanAct();
  const [params] = useSearchParams();
  const [input, setInput] = useState(""),
    [selected, setSelected] = useState(""),
    [text, setText] = useState(""),
    [newText, setNewText] = useState(""),
    [error, setError] = useState(""),
    [chatSearch, setChatSearch] = useState(""),
    [conversationView, setConversationView] = useState<"open" | "closed">("open"),
    [composing, setComposing] = useState(false),
    [busy, setBusy] = useState(false);
  const account = service?.me.account;
  const history = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  const lastChat = useRef("");
  const requested = params.get("to") ?? "";
  const target = isAddress(requested) && requested !== account ? requested : "";
  const people = useMessagePeople(account, [...snapshot.chats.map(c => c.peer), ...(input ? [input] : [])]);
  const linkedChat = snapshot.chats.find(c => c.peer === target && c.status !== "closed")?.id;
  const existingChat = snapshot.chats.find(c => c.peer === input && c.status !== "closed");
  useEffect(() => {
    setInput(target);
    setSelected(linkedChat ? target : "");
    setComposing(!!target && !linkedChat);
    setConversationView("open");
    setText("");
    setError("");
  }, [target, linkedChat, account]);
  const scopedChats = snapshot.chats.filter(c => (c.status === "closed") === (conversationView === "closed"));
  const visibleChats = scopedChats.filter(c =>
    `${people.name(c.peer)} ${c.peer}`.toLocaleLowerCase().includes(chatSearch.trim().toLocaleLowerCase()));
  const chat = scopedChats.find(c => c.id === selected)
    ?? scopedChats.find(c => c.peer === selected && c.status !== "closed");
  useEffect(() => {
    if (selected && snapshot.chats.some(c => (c.id === selected || c.peer === selected) && c.status === "closed") && !chat) setSelected("");
  }, [selected, snapshot.chats, chat]);
  const requests = snapshot.autoConnect === false ? snapshot.chats.filter(c => c.status === "incoming") : [];
  useLayoutEffect(() => {
    const node = history.current;
    if (node && (lastChat.current !== chat?.id || followMessages.current)) node.scrollTop = node.scrollHeight;
    lastChat.current = chat?.id ?? "";
  }, [chat?.id, chat?.messages.length]);
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`page private-messages${chat || composing ? " has-conversation" : ""}`}>
      <div className="page-header">
        <div>
        <h1>Messages</h1>
        <p className="page-subtitle">
          Private conversations with a fresh encryption key for every message.
        </p>
        </div>
        {snapshot.enabled && <Button aria-label="New message" title="New message" onClick={() => { setComposing(true); setSelected(""); setInput(""); setConversationView("open"); }}><Icon name="edit" /></Button>}
      </div>
      {!can.ok && <Notice>{can.reason}</Notice>}
      {(error || snapshot.error) && (
        <Notice kind="error">
          {error || snapshot.error}{" "}
          <Button variant="ghost" busy={busy} disabled={!service || !can.ok} onClick={() => void run(() => service!.sync())}>
            Retry
          </Button>
        </Notice>
      )}
      {!snapshot.enabled ? (
        <Card title="Private messages on this browser">
          <p>
            Your conversations and history stay on this device. An account
            recovery file restores your profile, but cannot restore these
            messages.
          </p>
          <Button
            variant="primary"
            disabled={!can.ok || !service}
            busy={busy}
            onClick={() => void run(() => service!.enable())}
          >
            Enable private messages
          </Button>
        </Card>
      ) : (
        <>
          {!snapshot.registered && !(error || snapshot.error) && (
            <Notice>
              This browser is being connected. You can continue using Open
              Social while it finishes.
            </Notice>
          )}
          {requests.length > 0 && <Card title={`Message requests (${requests.length})`}>
            <ul className="list">{requests.map(request => <li key={request.id} className="message-request-row">
              <Avatar account={request.peer} name={people.name(request.peer)} />
              <div className="message-person-copy"><AccountLink account={request.peer} name={people.name(request.peer)} /><small className="mono muted">{request.peer}</small></div>
              <Button variant="primary" disabled={!can.ok || !service} busy={busy} onClick={() => void run(async () => { await service!.accept(request.id); setSelected(request.id); setText(""); })}>Accept request</Button>
              <Button variant="ghost" onClick={() => { setSelected(request.id); setText(""); }}>View</Button>
            </li>)}</ul>
          </Card>}
          <div className="messages-grid">
            <Card className="conversation-list" title="Conversations" actions={<select aria-label="Conversation view" value={conversationView} onChange={event => { setConversationView(event.target.value as "open" | "closed"); setSelected(""); setComposing(false); setText(""); }}><option value="open">Open</option><option value="closed">Closed</option></select>}>
              <Field label="Search conversations">
                {id => <input id={id} type="search" placeholder="Search a name or address" value={chatSearch} onChange={event => setChatSearch(event.target.value)} />}
              </Field>
              <div className="conversation-choices">
                {visibleChats.map(c => <Button key={c.id} aria-pressed={c.id === chat?.id} className="private-chat-choice" onClick={() => { setSelected(c.status === "closed" ? c.id : c.peer); setComposing(false); setText(""); setError(""); }}>
                  <Avatar account={c.peer} name={people.name(c.peer)} />
                  <span className="private-chat-person"><strong>{people.name(c.peer)}</strong><span className="chat-preview">{c.messages.at(-1)?.text || "Start a conversation"}</span></span>
                  <small className="private-chat-status">{chatLabel(c)}</small>
                </Button>)}
                {visibleChats.length === 0 && <p className="empty">{chatSearch ? "No conversations match that name or address." : conversationView === "closed" ? "No closed conversations." : "No open conversations yet. Send someone a message to get started."}</p>}
              </div>
              <Button variant="ghost" onClick={() => void service?.sync()}><Icon name="refresh" size={16} />Refresh</Button>
            </Card>
          {(composing || (!chat && snapshot.chats.length === 0 && conversationView === "open")) && <Card className="new-message-card conversation-pane" title="New message" actions={<Button variant="ghost" aria-label="Back to conversations" onClick={() => setComposing(false)}><Icon name="close" /></Button>}>
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await service!.queueMessage(input.trim(), newText);
                  setSelected(input.trim());
                  setComposing(false);
                  setConversationView("open");
                  setNewText("");
                });
              }}
            >
              <MessageRecipientPicker account={account} value={input} onChange={setInput}
                friends={people.friends} blocked={people.blocked} name={people.name}
                loading={people.loading} friendsError={people.error}
                retryFriends={() => void people.refresh()} disabled={busy} />
              <Field label="Your message">
                {id => <textarea id={id} rows={3} maxLength={2500} value={newText} onChange={event => setNewText(event.target.value)} disabled={busy} placeholder="Write a message…" />}
              </Field>
              <Button
                type="submit"
                variant="primary"
                disabled={
                  !can.ok || !service || !input || !newText.trim()
                }
                busy={busy}
              >
                Send message
              </Button>
              {existingChat && <Button type="button" variant="ghost" onClick={() => { setSelected(input); setComposing(false); setText(""); }}>Open conversation</Button>}
            </form>
          </Card>}
            {!chat && !composing && (snapshot.chats.length > 0 || conversationView === "closed") && <div className="conversation-placeholder"><span className="feature-icon"><Icon name="message" size={30} /></span><h2>A little closer to your people.</h2><p>Choose a conversation, or start a new one.</p><Button variant="primary" onClick={() => { setComposing(true); setConversationView("open"); }}>New message <Icon name="plus" size={18} /></Button></div>}
            {chat && (
              <Card
                className="conversation-pane"
                title={<span className="chat-heading"><Button className="chat-back" variant="ghost" aria-label="Back to conversations" onClick={() => setSelected("")}><Icon name="back" /></Button><Avatar account={chat.peer} name={people.name(chat.peer)} /><AccountLink account={chat.peer} name={people.name(chat.peer)} /></span>}
                actions={<small className="muted">{chatLabel(chat)}</small>}
              >
                {chat.status === "incoming" && snapshot.autoConnect === false && (
                  <Button
                    variant="primary"
                    busy={busy}
                    onClick={() => void run(() => service!.accept(chat.id))}
                  >
                    Accept message request
                  </Button>
                )}
                {chat.error && <Notice kind="error">{chat.error}</Notice>}
                {["incoming", "outgoing", "accepting"].includes(chat.status) && !chat.error && (
                  <Notice>
                    Encrypted setup runs automatically. You can write and send now.
                    Both messaging browsers need to be online and unlocked to finish the first connection.
                    {chat.progress && <details><summary>Connection status</summary>{chat.progress}</details>}
                  </Notice>
                )}
                {chat.closing && !chat.error && <Notice>{chat.progress} Keep this account unlocked until the notice is sent.</Notice>}
                <div ref={history} className="message-history" aria-live="polite" onScroll={event => { const node = event.currentTarget; followMessages.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }}>
                  {chat.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`message-bubble ${m.mine ? "mine" : ""}`}
                    >
                      <small>
                        {m.mine ? "You" : "Them"} ·{" "}
                        {m.state === "sending"
                          ? "Sending…"
                          : m.state === "not-sent" ? "Not sent · conversation closed"
                          : m.state === "stopped" ? "Delivery stopped · conversation closed"
                          : m.state === "confirming" ? (m.mine ? "Sent · confirming" : "Confirming")
                          : new Date(m.timestamp).toLocaleString()}
                      </small>
                      <p><RichText text={m.text}/></p>
                    </div>
                  ))}
                </div>
                {chat.status !== "closed" && (
                  <form
                    className="form-stack chat-composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        await service!.queueMessage(chat.peer, text);
                        setText("");
                      });
                    }}
                  >
                    <Field label="Message">
                      {(id) => (
                        <textarea
                          id={id}
                          rows={2}
                          maxLength={2500}
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          disabled={busy}
                          placeholder="Write a message…"
                        />
                      )}
                    </Field>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={!can.ok || !service || !text.trim()}
                      busy={busy}
                    >
                      <Icon name="send" size={18} /> Send message
                    </Button>
                  </form>
                )}
                {chat.status !== "closed" && (
                  <Button
                    variant="ghost"
                    busy={busy}
                    onClick={() => void run(() => service!.close(chat.id))}
                  >
                    {chat.status === "incoming"
                      ? "Decline"
                      : "Close conversation"}
                  </Button>
                )}
              </Card>
            )}
          </div>
        </>
      )}
      {snapshot.pending > 0 && (
        <p className="hint" role="status">
          {snapshot.pending} encrypted{" "}
          {snapshot.pending === 1 ? "message is" : "messages are"} sending in
          the background. You can leave this page; delivery resumes when this
          account is online and unlocked in this browser. Switching accounts or
          closing the browser pauses unfinished delivery.
        </p>
      )}
      <details className="private-message-details">
        <summary>Privacy and message history</summary>
        {snapshot.enabled && <label className="checkbox-row">
          <input type="checkbox" checked={snapshot.autoConnect !== false} disabled={busy || !service}
            onChange={event => void run(() => service!.setAutoConnect(event.target.checked))} />
          Connect incoming conversations automatically
        </label>}
        <p>Automatic connections use your message credits. Turn this off to approve new conversations yourself. Block a profile to stop unwanted connections.</p>
        {snapshot.enabled && <label className="checkbox-row">
          <input type="checkbox" checked={snapshot.prepareInAdvance !== false} disabled={busy || !service}
            onChange={event => void run(() => service!.setPrepareInAdvance(event.target.checked))} />
          Prepare the next conversation in advance
        </label>}
        <p>Reserve four usage credits in the background for your next conversation so sending starts faster. Unused prepaid credits stay with that conversation wallet; this uses your existing allowance.</p>
        <p>
          Conversation wallets keep your profile address out of message
          transactions. Timing and encrypted data remain public. Your sponsor
          can connect your account to its conversation wallets.
        </p>
        <p>
          Messages use small prepaid batches of your existing usage credits.
          Recharge starts when a batch is reserved. Creating another
          conversation wallet does not give you more free credits.
        </p>
        <p>
          Message keys cannot be recreated from your account recovery file. Keep
          this browser's data to retain your chat history. Someone who accesses
          an unlocked device or a device backup may still read saved messages. A
          stolen account seed can still be used to impersonate you and register
          another messaging browser.
        </p>
      </details>
      {!!snapshot.devices?.length && (
        <details className="private-message-details">
          <summary>Messaging browsers</summary>
          <p>
            Removing a browser stops new message requests to it. It cannot erase
            messages already saved there.
          </p>
          {snapshot.devices.map((d) => (
            <div className="row" key={d.id}>
              <span>
                {d.current ? "This browser" : d.label || "Browser"} ·{" "}
                {new Date(Number(d.updatedAt)).toLocaleDateString()}
              </span>
              <Button
                variant="ghost"
                busy={busy}
                onClick={() => void run(() => service!.revokeDevice(d.id))}
              >
                Remove
              </Button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
