import { useCallback, useEffect, useRef, useState } from "react";
import {
  bytesEqual,
  contentHash,
  deriveEncryptionKeyPair,
  encryptDirectMessage,
  fromBase64url,
  isAddress,
  randomBytes,
  toBase64url,
  type ConversationRecord,
} from "@osp/sdk";
import { useServices } from "../../api/services";
import { AccountLink, Button, Card, Field, Notice } from "../../components/ui";
import { submitAction, humanizeError } from "../../tx/submit";
import { useCanAct, useMe, useSubmitContext } from "../session";
import { openVerifiedMessage } from "./verified";

type Opened = Awaited<ReturnType<typeof openVerifiedMessage>>;
interface Pending {
  id: string;
  envelope: string;
  generation: string;
}
export function MessagesPage() {
  const me = useMe(),
    ctx = useSubmitContext(),
    can = useCanAct(),
    { protocol, indexer } = useServices();
  const [input, setInput] = useState(""),
    [peer, setPeer] = useState(""),
    [text, setText] = useState("");
  const [list, setList] = useState<ConversationRecord[]>([]),
    [conversation, setConversation] = useState<ConversationRecord>();
  const [messages, setMessages] = useState<Opened[]>([]),
    [before, setBefore] = useState<string | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Pending>();
  const working = useRef(false),
    reading = useRef(false),
    historyLoaded = useRef(false),
    version = useRef(0),
    peerRef = useRef(peer);
  peerRef.current = peer;
  const storageKey =
    me && protocol && peer
      ? `osp:dm:${protocol.deployment.chainId}:${protocol.deployment.contracts.messaging.address}:${me.account}:${peer}`
      : "";
  const refresh = useCallback(
    async (older?: string) => {
      if (!me || !protocol) return;
      const current = ++version.current;
      reading.current = true;
      try {
        if (peer) {
          const c = (await protocol.reads.messaging.get_conversation({ a: me.account, b: peer }))?.value;
          if (current !== version.current) return;
          setConversation(c);
        }
        if (indexer.configured) {
          const all = await indexer.conversations(me.account);
          if (current === version.current) setList(all.items);
        }
        if (!peer) return;
        if (indexer.configured) {
          const page = await indexer.messages(me.account, peer, older);
          const settled = await Promise.allSettled(page.items.map((row) => openVerifiedMessage(protocol, me, peer, row)));
          if (current !== version.current) return;
          const verified = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
          if (settled.some((r) => r.status === "rejected"))
            setError("Some messages could not be verified or decrypted. Their contents are hidden; refresh to try again.");
          setMessages((prev) => {
            const items = [...prev, ...verified];
            return [...new Map(items.map((x) => [x.id, x])).values()].sort((a, b) => (BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1));
          });
          if (older || !historyLoaded.current) setBefore(page.nextBefore);
          historyLoaded.current = true;
        }
      } catch (e) {
        if (current === version.current) setError(humanizeError(e));
      } finally {
        if (current === version.current) reading.current = false;
      }
    },
    [me, protocol, indexer, peer]
  );
  useEffect(() => {
    historyLoaded.current = false;
    reading.current = false;
    setList([]);
    setMessages([]);
    setConversation(undefined);
    setBefore(null);
    setError("");
    setText("");
    setPending(undefined);
    if (storageKey) {
      try {
        const p = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (
          p &&
          typeof p.id === "string" &&
          fromBase64url(p.id).length === 32 &&
          typeof p.envelope === "string" &&
          fromBase64url(p.envelope).length <= 4096 &&
          /^[1-9]\d*$/.test(p.generation)
        )
          setPending(p);
      } catch {
        setError("The saved message could not be read.");
      }
    }
    void refresh();
    return () => {
      version.current++;
    };
  }, [refresh, storageKey]);
  useEffect(() => {
    const poll = () => { if (!working.current && !reading.current && document.visibilityState !== "hidden") void refresh(); };
    const timer = window.setInterval(poll, 15_000);
    window.addEventListener("focus", poll);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", poll); };
  }, [refresh]);
  const act = async (fn: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const change = (method: "request_conversation" | "accept_conversation" | "close_conversation") =>
    act(async () => {
      if (!ctx || !me || !peer) return;
      const current = (await ctx.client.reads.messaging.get_conversation({ a: me.account, b: peer }))?.value;
      const op = await ctx.client.ops.messaging[method]({ actor: me.account, peer, generation: current?.generation ?? "0" });
      await submitAction(ctx, [op], {
        waitForReceipt: true,
        label:
          method === "request_conversation"
            ? "Sending message request"
            : method === "accept_conversation"
            ? "Accepting conversation"
            : "Closing conversation",
      });
    });
  const send = () =>
    act(async () => {
      if (!ctx || !me || !peer || !protocol) return;
      const target = peer;
      let request = pending;
      if (!request) {
        const c = (await protocol.reads.messaging.get_conversation({ a: me.account, b: peer }))?.value;
        if (c?.status !== 2) throw new Error("The recipient needs to accept your request first.");
        const [self, other] = await Promise.all([
          protocol.reads.identity.get_identity({ account: me.account }),
          protocol.reads.identity.get_identity({ account: peer }),
        ]);
        if (!self?.value || !other?.value) throw new Error("Both accounts must be registered.");
        if (!bytesEqual(deriveEncryptionKeyPair(me.seed, self.value.key_version).publicKey, self.value.encryption_key))
          throw new Error("Restore the current encryption key before sending messages.");
        const id = randomBytes(32);
        const encrypted = encryptDirectMessage(
          {
            chainId: protocol.deployment.chainId,
            contract: protocol.deployment.contracts.messaging.address,
            sender: me.account,
            recipient: peer,
            messageId: id,
            generation: c.generation,
          },
          text,
          [
            { address: me.account, publicKey: self.value.encryption_key, keyVersion: self.value.key_version },
            { address: peer, publicKey: other.value.encryption_key, keyVersion: other.value.key_version },
          ]
        );
        request = { id: toBase64url(id), envelope: toBase64url(encrypted.envelope), generation: c.generation };
        // Persist ciphertext and id BEFORE submission so refresh/retry never duplicates a message.
        localStorage.setItem(storageKey, JSON.stringify(request));
        setPending(request);
      }
      const id = fromBase64url(request.id),
        existing = (await protocol.reads.messaging.get_message({ sender: me.account, message_id: id }))?.value;
      if (!existing) {
        const op = await protocol.ops.messaging.send_message({
          sender: me.account,
          recipient: target,
          message_id: id,
          generation: request.generation,
          envelope: fromBase64url(request.envelope),
        });
        await submitAction(ctx, [op], { label: "Sending encrypted message", success: "Message sent", waitForReceipt: true });
      } else if (
        existing.sender !== me.account ||
        !bytesEqual(existing.message_id, id) ||
        existing.recipient !== target ||
        existing.generation !== request.generation ||
        !bytesEqual(existing.content_hash, contentHash(fromBase64url(request.envelope)))
      )
        throw new Error("Saved message does not match the network record.");
      const confirmed = (await protocol.reads.messaging.get_message({ sender: me.account, message_id: id }))?.value;
      if (
        !confirmed ||
        confirmed.recipient !== target ||
        confirmed.generation !== request.generation ||
        !bytesEqual(confirmed.content_hash, contentHash(fromBase64url(request.envelope)))
      ) {
        throw new Error("Message submitted; confirmation is still pending. Keep the saved copy and check again.");
      }
      // Keep the durable ciphertext until this exact content is readable on chain.
      localStorage.removeItem(storageKey);
      if (peerRef.current === target) {
        setPending(undefined);
        setText("");
      }
    });
  const select = (address: string) => {
    if (busy) return;
    if (!isAddress(address) || address === me?.account) {
      setError("Enter another person's valid Koinos address.");
      return;
    }
    setPeer(address);
    setInput(address);
  };
  return (
    <div className="page-stack">
      <h1>Messages</h1>
      <p className="muted">Private conversations. Only you and the recipient can read the message text.</p>
      {!can.ok && <Notice>{can.reason}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <Card title="Start a conversation">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            select(input.trim());
          }}
          className="form-stack"
        >
          <Field label="Their account address">
            {(id) => <input id={id} value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} autoComplete="off" />}
          </Field>
          <Button type="submit" disabled={busy}>
            Open conversation
          </Button>
        </form>
      </Card>
      <div className="messages-grid">
        <Card title="Conversations">
          {list.length === 0 ? (
            <p className="muted">Your message requests and conversations appear here.</p>
          ) : (
            list.map((c) => {
              const p = c.a === me?.account ? c.b : c.a;
              return (
                <Button key={p} onClick={() => select(p)} disabled={busy} aria-pressed={peer === p}>
                  {p.slice(0, 9)}… · {c.status === 1 ? "Request" : c.status === 2 ? "Accepted" : "Closed"}
                </Button>
              );
            })
          )}
          <Button onClick={() => void refresh()} disabled={busy}>
            Refresh
          </Button>
        </Card>
        {peer && (
          <Card title={<AccountLink account={peer} />}>
            {(!conversation || conversation.status === 3) && (
              <Button onClick={() => void change("request_conversation")} disabled={!can.ok || busy}>
                Request to message
              </Button>
            )}
            {conversation?.status === 1 &&
              (conversation.requester === me?.account ? (
                <Notice>Waiting for their acceptance.</Notice>
              ) : (
                <Button onClick={() => void change("accept_conversation")} disabled={!can.ok || busy}>
                  Accept message request
                </Button>
              ))}
            {conversation && conversation.status !== 3 && (
              <Button variant="ghost" onClick={() => void change("close_conversation")} disabled={!can.ok || busy}>
                {conversation.status === 1 ? "Decline / cancel request" : "Close conversation"}
              </Button>
            )}
            {before && (
              <Button onClick={() => void refresh(before)} disabled={busy}>
                Load older messages
              </Button>
            )}
            <div className="message-history" aria-live="polite">
              {messages.map((m) => (
                <div key={m.id} className={`message-bubble ${m.sender === me?.account ? "mine" : ""}`}>
                  <small>
                    {m.sender === me?.account ? "You" : "Them"} · {new Date(Number(m.timestamp)).toLocaleString()}
                  </small>
                  <p>{m.text}</p>
                </div>
              ))}
            </div>
            {pending && (
              <Notice kind="warning">
                A saved message is awaiting confirmation. Retry checks the same message before sending.{" "}
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Remove the saved retry copy? A message already submitted to the network may still arrive.")) {
                      localStorage.removeItem(storageKey);
                      setPending(undefined);
                      setText("");
                    }
                  }}
                >
                  Remove saved retry copy
                </Button>
              </Notice>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className="form-stack"
            >
              <Field label="Message">
                {(id) => (
                  <textarea
                    id={id}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={2500}
                    disabled={busy || !!pending || conversation?.status !== 2}
                    rows={4}
                  />
                )}
              </Field>
              <Button
                type="submit"
                variant="primary"
                disabled={!can.ok || busy || (!pending && (conversation?.status !== 2 || !text.trim()))}
                busy={busy}
              >
                {pending ? "Check / retry saved message" : "Send encrypted message"}
              </Button>
            </form>
            <p className="hint">
              Account addresses, timing and message size are public. Message text is encrypted. Closing or blocking stops new messages; it
              cannot erase copies already received.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
