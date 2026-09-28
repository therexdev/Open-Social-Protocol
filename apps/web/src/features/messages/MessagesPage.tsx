import { useState } from "react";
import { AccountLink, Button, Card, Field, Notice } from "../../components/ui";
import { useCanAct } from "../session";
import { usePrivateMessaging } from "./PrivateMessagingProvider";

const labels = {
  incoming: "Message request",
  outgoing: "Request sent",
  accepting: "Connecting",
  ready: "Connected",
  closed: "Closed",
};
export function MessagesPage() {
  const { service, snapshot } = usePrivateMessaging(),
    can = useCanAct();
  const [input, setInput] = useState(""),
    [selected, setSelected] = useState(""),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const chat = snapshot.chats.find((c) => c.id === selected);
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
    <div className="page-stack private-messages">
      <div>
        <h1>Messages</h1>
        <p className="muted">
          Private conversations with a fresh encryption key for every message.
        </p>
      </div>
      {!can.ok && <Notice>{can.reason}</Notice>}
      {(error || snapshot.error) && (
        <Notice kind="error">
          {error || snapshot.error}{" "}
          <Button variant="ghost" onClick={() => void service?.sync()}>
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
          {!snapshot.registered && (
            <Notice>
              This browser is being connected. You can continue using Open
              Social while it finishes.
            </Notice>
          )}
          <Card title="Start a conversation">
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  setSelected(await service!.start(input.trim()));
                  setText("");
                });
              }}
            >
              <Field label="Their account address">
                {(id) => (
                  <input
                    id={id}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    autoComplete="off"
                    disabled={busy}
                  />
                )}
              </Field>
              <Button
                type="submit"
                variant="primary"
                disabled={
                  !can.ok || !service || !snapshot.registered || !input.trim()
                }
                busy={busy}
              >
                Start private conversation
              </Button>
            </form>
          </Card>
          <div className="messages-grid">
            <Card title="Conversations">
              {snapshot.chats.length === 0 ? (
                <p className="muted">
                  Your message requests and conversations will appear here.
                </p>
              ) : (
                snapshot.chats.map((c) => (
                  <Button
                    key={c.id}
                    aria-pressed={c.id === selected}
                    className="private-chat-choice"
                    onClick={() => {
                      setSelected(c.id);
                      setText("");
                      setError("");
                    }}
                  >
                    <span>{c.peer.slice(0, 10)}…</span>
                    <small>{labels[c.status]}</small>
                  </Button>
                ))
              )}
              <Button variant="ghost" onClick={() => void service?.sync()}>
                Refresh
              </Button>
            </Card>
            {chat && (
              <Card
                title={<AccountLink account={chat.peer} />}
                actions={<small className="muted">{labels[chat.status]}</small>}
              >
                {chat.status === "incoming" && (
                  <Button
                    variant="primary"
                    busy={busy}
                    onClick={() => void run(() => service!.accept(chat.id))}
                  >
                    Accept message request
                  </Button>
                )}
                {chat.status === "outgoing" && (
                  <Notice>
                    Your encrypted request is being delivered. Messages become
                    available after they accept.
                  </Notice>
                )}
                {chat.status === "accepting" && (
                  <Notice>
                    Setting up your private conversation in the background.
                  </Notice>
                )}
                <div className="message-history" aria-live="polite">
                  {chat.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`message-bubble ${m.mine ? "mine" : ""}`}
                    >
                      <small>
                        {m.mine ? "You" : "Them"} ·{" "}
                        {m.state === "sending"
                          ? "Sending…"
                          : new Date(m.timestamp).toLocaleString()}
                      </small>
                      <p>{m.text}</p>
                    </div>
                  ))}
                </div>
                {chat.status === "ready" && (
                  <form
                    className="form-stack"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        await service!.send(chat.id, text);
                        setText("");
                      });
                    }}
                  >
                    <Field label="Message">
                      {(id) => (
                        <textarea
                          id={id}
                          rows={3}
                          maxLength={2500}
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          disabled={busy}
                        />
                      )}
                    </Field>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={!can.ok || !text.trim()}
                      busy={busy}
                    >
                      Send message
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
          browser is online and unlocked.
        </p>
      )}
      <details className="private-message-details">
        <summary>Privacy and message history</summary>
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
