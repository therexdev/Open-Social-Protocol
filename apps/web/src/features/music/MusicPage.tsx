import { VoiceCommentForm } from "./VoiceCommentForm";
import { decodeMusicComment } from "./voiceComment";
import { ClipPlayer } from "../media/ClipPlayer";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  fromBase64url,
  musicCommentCipher,
  newEpochKey,
  randomBytes,
  toBase64url,
  utf8,
  type MusicAccess,
  type MusicComment,
  type MusicRecord,
} from "@osp/sdk";
import { useServices } from "../../api/services";
import { AccountLink, Button, Card, Empty, Field, Notice, Spinner } from "../../components/ui";
import { useVault, useVaultStore } from "../../vault/context";
import { submitAction } from "../../tx/submit";
import { useSubmitContext } from "../session";
import { deliverMusicRequest, readingKey, trackContext } from "./musicAccessService";
import { MusicArtworkEditor } from "./MusicArtworkEditor";
import { Icon } from "../../components/Icon";
import { MusicEngagement } from "./MusicEngagement";
import { MusicTrack } from "./MusicTrack";

function replyAuthor(comments: MusicComment[], reply: MusicComment) {
  const parent = comments.find(comment => toBase64url(comment.id) === toBase64url(reply.reply_to));
  return parent ? <AccountLink account={parent.author}/> : "an earlier comment";
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export function MusicPage() {
  const { id = "" } = useParams(),
    { protocol } = useServices(),
    session = useVault((s) => s.session);
  return (
    <TrackPage
      key={`${protocol?.chainId}:${protocol?.deployment.contracts.publications.address}:${id}:${session?.identity.account}`}
      id={id}
    />
  );
}
function TrackPage({ id }: { id: string }) {
  const { protocol } = useServices(),
    session = useVault((s) => s.session),
    vault = useVaultStore(),
    submit = useSubmitContext();
  const [record, setRecord] = useState<MusicRecord>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [access, setAccess] = useState<MusicAccess>(),
    [eligible, setEligible] = useState(false),
    [now, setNow] = useState("0"),
    [keyReady, setKeyReady] = useState(false),
    [keyError, setKeyError] = useState("");
  const [comments, setComments] = useState<MusicComment[]>([]),
    [after, setAfter] = useState<Uint8Array>(),
    [text, setText] = useState(""),
    [replyTo, setReplyTo] = useState<string>(),
    [voiceMode, setVoiceMode] = useState(false),
    [pending, setPending] = useState<MusicAccess[]>([]);
  const secret = useRef<Uint8Array | undefined>(undefined),
    alive = useRef(true),
    refreshVersion = useRef(0),
    attempt = useRef<
      | { text: string; replyTo?: string; id: Uint8Array; body: Uint8Array; nonce?: Uint8Array }
      | undefined
    >(undefined);
  const mine = record?.owner === session?.identity.account;
  const checkActive = () => {
    if (!alive.current || vault.getState().session !== session)
      throw new Error("Your account changed or locked. Unlock it and retry.");
  };
  const refresh = useCallback(async () => {
    if (!protocol) {
      setError("Connect to a network to open this track.");
      setLoading(false);
      return;
    }
    const ticket = ++refreshVersion.current;
    try {
      const key = fromBase64url(id);
      if (key.length !== 32 || toBase64url(key) !== id) throw new Error("Invalid track link.");
      const v = (await protocol.reads.publications.get_music({ id: key }))?.value;
      if (!v || v.clip_kind || v.received !== v.chunk_hashes.length)
        throw new Error("Track not found or upload not finished.");
      const a =
        session && v.encrypted
          ? await protocol.reads.publications.get_music_access({
              id: key,
              buyer: session.identity.account,
            })
          : undefined;
      if (!alive.current || ticket !== refreshVersion.current) return;
      setRecord(v);
      setAccess(a?.value);
      setEligible(!v.encrypted || !!a?.eligible);
      setNow(a?.now ?? "0");
      setError("");
      secret.current?.fill(0);
      secret.current = undefined;
      try {
        const k = await readingKey(protocol, id, v, session);
        if (!alive.current || ticket !== refreshVersion.current) {
          k?.fill(0);
          return;
        }
        secret.current = k;
        setKeyReady(true);
        setKeyError("");
      } catch (e) {
        if (alive.current && ticket === refreshVersion.current) {
          setKeyReady(false);
          setKeyError(message(e));
        }
      }
      const result = await protocol.reads.publications.list_music_comments({ id: key });
      if (!alive.current || ticket !== refreshVersion.current) return;
      setComments(result?.items ?? []);
      setAfter(result?.next.length ? result.next : undefined);
      if (session?.identity.account === v.owner) {
        const requests: MusicAccess[] = [];
        let cursor: Uint8Array | undefined;
        do {
          const page = await protocol.reads.publications.list_music_requests({
            owner: v.owner,
            after: cursor,
          });
          requests.push(...(page?.items ?? []).filter((r) => toBase64url(r.id) === id));
          cursor = page?.next.length ? page.next : undefined;
        } while (cursor && alive.current && ticket === refreshVersion.current);
        if (alive.current && ticket === refreshVersion.current) setPending(requests);
      }
    } catch (e) {
      if (alive.current && ticket === refreshVersion.current) setError(message(e));
    } finally {
      if (alive.current && ticket === refreshVersion.current) setLoading(false);
    }
  }, [protocol, id, session]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      refreshVersion.current++;
      secret.current?.fill(0);
      secret.current = undefined;
    };
  }, [refresh]);
  useEffect(() => {
    if (!access || access.status !== 1 || busy) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [access?.status, busy, refresh]);
  const verifyCommentAccess = useCallback(async () => {
    if (!record?.encrypted || mine) return;
    if (!session || !protocol) throw Error("Unlock the track to play this voice comment.");
    const fresh = await protocol.reads.publications.get_music_access({ id: fromBase64url(id), buyer: session.identity.account });
    if (!fresh?.eligible || fresh.value?.status !== 2) throw Error("This track is no longer shared with this account.");
  }, [record?.encrypted, mine, session, protocol, id]);
  useEffect(() => {
    if (!record?.encrypted || !keyReady || mine) return;
    let active = true;
    const check = () => {
      if (document.visibilityState === "hidden") return;
      void verifyCommentAccess().catch(e => {
        if (!active) return;
        secret.current?.fill(0); secret.current = undefined;
        setKeyReady(false); setEligible(false); setKeyError(message(e));
      });
    };
    const timer = window.setInterval(check, 30000);
    window.addEventListener("focus", check);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", check); };
  }, [keyReady, mine, record?.encrypted, verifyCommentAccess]);
  const act = async (work: () => Promise<void>, reload = true) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      checkActive();
      await work();
      checkActive();
      if (reload) await refresh();
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const request = () =>
    act(async () => {
      if (!submit || !record || !session) throw new Error("Unlock your account first.");
      await submitAction(
        submit,
        [
          await protocol!.ops.publications.request_music_access({
            buyer: session.identity.account,
            id: fromBase64url(id),
            max_price: record.unlock_price ?? "0",
          }),
        ],
        { label: "Requesting music access", beforeSubmit: async () => checkActive() }
      );
    });
  const refund = () =>
    act(async () => {
      if (!submit || !session) return;
      await submitAction(
        submit,
        [
          await protocol!.ops.publications.refund_music_access({
            buyer: session.identity.account,
            id: fromBase64url(id),
          }),
        ],
        { label: "Refunding undelivered music access", beforeSubmit: async () => checkActive() }
      );
    });
  const comment = () =>
    act(async () => {
      if (!submit || !session || !record) throw new Error("Unlock your account first.");
      const bodyText = text.trim(),
        plain = utf8(bodyText);
      if (!plain.length || plain.length > 3984)
        throw new Error("Write a comment of at most 3984 UTF-8 bytes.");
      // Persist this attempt in memory across unknown transaction outcomes; identical
      // retries cannot create duplicate comments or charge usage twice.
      if (
        !attempt.current ||
        attempt.current.text !== bodyText ||
        attempt.current.replyTo !== replyTo
      ) {
        const commentId = newEpochKey(),
          nonce = record.encrypted ? randomBytes(24) : undefined;
        if (record.encrypted && !secret.current)
          throw new Error("Unlock the track before commenting.");
        const body = nonce
          ? musicCommentCipher(
              trackContext(protocol!, id, record.owner),
              secret.current!,
              nonce,
              commentId,
              session.identity.account
            ).encrypt(plain)
          : plain;
        attempt.current = { text: bodyText, replyTo, id: commentId, body, nonce };
      }
      const draft = attempt.current;
      await submitAction(
        submit,
        [
          await protocol!.ops.publications.comment_music({
            author: session.identity.account,
            id: fromBase64url(id),
            comment_id: draft.id,
            body: draft.body,
            nonce: draft.nonce,
            ...(replyTo && { reply_to: fromBase64url(replyTo) }),
          }),
        ],
        { label: "Posting comment", beforeSubmit: async () => checkActive() }
      );
      checkActive();
      attempt.current = undefined;
      setText("");
      setReplyTo(undefined);
    });
  const remove = (c: MusicComment) =>
    act(async () => {
      if (!submit || !session) return;
      await submitAction(
        submit,
        [
          await protocol!.ops.publications.delete_music_comment({
            author: session.identity.account,
            id: fromBase64url(id),
            comment_id: c.id,
          }),
        ],
        { label: "Deleting comment", beforeSubmit: async () => checkActive() }
      );
    });
  const openComment = (c: MusicComment) => {
    if (c.deleted) return "Comment deleted";
    try {
      const render = (bytes: Uint8Array) => {
        const opened = decodeMusicComment(bytes, !!record?.encrypted);
        return <>{opened.text && <p className="music-description">{opened.text}</p>}{opened.voice && <ClipPlayer media={opened.voice} verifyAccess={verifyCommentAccess}/>}</>;
      };
      if (!record?.encrypted) return render(c.body);
      if (!secret.current) return "Unlock this track to read comments.";
      return render(
        musicCommentCipher(
          trackContext(protocol!, id, record.owner),
          secret.current,
          c.nonce,
          c.id,
          c.author
        ).decrypt(c.body)
      );
    } catch {
      return "This comment could not be verified.";
    }
  };
  const loadMore = () =>
    act(async () => {
      const page = await protocol!.reads.publications.list_music_comments({
        id: fromBase64url(id),
        after,
      });
      if (!alive.current) return;
      setComments((old) => [
        ...old,
        ...(page?.items ?? []).filter(
          (c) => !old.some((x) => toBase64url(x.id) === toBase64url(c.id))
        ),
      ]);
      setAfter(page?.next.length ? page.next : undefined);
    }, false);
  const { hash } = useLocation();
  const loaded = !!record;
  useEffect(() => {
    if (loaded && hash === "#track-comments") document.getElementById("track-comments")?.scrollIntoView?.({ block: "start" });
  }, [loaded, hash]);
  const refundAvailable =
    access?.status === 1 && (!eligible || BigInt(now) >= BigInt(access.expires_at));
  return (
    <div className="page music-page stack">
      <Link className="back-link" to={record ? `/u/${record.owner}?tab=music` : "/"}>
        ← Back to profile
      </Link>
      {loading && <Spinner label="Loading track" />}
      {error && (
        <Notice kind="error">
          {error}{" "}
          <Button onClick={() => void refresh()} disabled={busy}>
            Refresh
          </Button>
        </Notice>
      )}
      {record && (
        <>
          <Card>
            <MusicTrack id={id} record={record} expanded playbackLocked={!!record.encrypted && !keyReady && !mine} />
            <p className="hint">
              Uploaded by <AccountLink account={record.owner}/>
            </p>
          </Card>
          {mine && <MusicArtworkEditor id={id} record={record} onSaved={refresh}/>}
          {record.encrypted && !mine && (
            <Card title="Track access">
              {!session ? (
                <Notice>Unlock your account to check access.</Notice>
              ) : (
                <>
                  {!eligible && (
                    <Notice>
                      This track is restricted to the uploader’s current friends or group members,
                      or access is blocked.
                    </Notice>
                  )}
                  {access?.status === 2 && (
                    <Notice kind={keyReady ? "success" : "error"}>
                      {keyReady ? "Access delivered. Your account can play this track." : keyError}
                    </Notice>
                  )}
                  {access?.status === 1 && (
                    <>
                      <Notice>
                        Waiting for the uploader to deliver your encrypted reading key.{" "}
                        {access.amount !== "0" && `${access.amount} OSAT is held until delivery.`}{" "}
                        Refund available after{" "}
                        {new Date(Number(access.expires_at)).toLocaleString()}.
                      </Notice>
                      <Button disabled={busy} onClick={() => void refresh()}>
                        Check delivery
                      </Button>
                    </>
                  )}
                  {access?.status === 3 && (
                    <Notice>Your undelivered request was refunded or cancelled.</Notice>
                  )}
                  {eligible && (!access || access.status === 3) && (
                    <>
                      <p>
                        {BigInt(record.unlock_price ?? "0") > 0n
                          ? `${record.unlock_price} OSAT will be reserved and paid to the uploader when they deliver an encrypted key. Delivery requires the uploader to open the app. You can refund an undelivered purchase after 24 hours.`
                          : "Request a reading key from the uploader. Delivery requires them to open the app."}
                      </p>
                      {BigInt(record.unlock_price ?? "0") > 0n && (
                        <p className="hint">
                          Buy from an uploader you trust. Payment is released when a sealed key is
                          delivered; the chain cannot verify that the uploader encrypted the
                          promised audio correctly.
                        </p>
                      )}
                      <Button
                        variant="primary"
                        disabled={busy || !submit}
                        onClick={() => void request()}
                      >
                        {BigInt(record.unlock_price ?? "0") > 0n
                          ? `Reserve ${record.unlock_price} OSAT & request unlock`
                          : "Request access"}
                      </Button>
                    </>
                  )}
                  {refundAvailable && (
                    <Button disabled={busy} onClick={() => void refund()}>
                      {access!.amount === "0" ? "Cancel expired request" : "Refund OSAT"}
                    </Button>
                  )}
                </>
              )}
            </Card>
          )}
          {mine && pending.length > 0 && (
            <Card title="Pending access deliveries">
              <p className="hint">
                Deliveries run automatically while this app is open and unlocked. Expired requests
                can be refunded by the buyer.
              </p>
              {pending.map((r) => (
                <div className="list-item" key={r.buyer}>
                  <AccountLink account={r.buyer}/>
                  <span>{r.amount} OSAT</span>
                  <Button
                    disabled={busy || !submit || BigInt(now) >= BigInt(r.expires_at)}
                    onClick={() =>
                      void act(async () => {
                        await deliverMusicRequest(submit!, session!, r, checkActive);
                      })
                    }
                  >
                    Deliver access
                  </Button>
                </div>
              ))}
            </Card>
          )}
          <Card title={<span id="track-comments">Comments</span>}>
            {record.encrypted && !keyReady ? (
              <Notice>{access?.status === 2 || mine ? keyError : "Unlock this track to read and write comments."}</Notice>
            ) : (
              <>
                {!comments.length && <Empty>No comments yet.</Empty>}
                <div className="music-comments">
                  {comments.map((c) => (
                    <article className="music-comment" key={toBase64url(c.id)}>
                      <div className="row wrap">
                        <AccountLink account={c.author}/>
                        <time className="hint">
                          {new Date(Number(c.created_at)).toLocaleString()}
                        </time>
                      </div>
                      {c.reply_to.length > 0 && (
                        <p className="hint">
                          Replying to{" "}
                          {replyAuthor(comments, c)}
                        </p>
                      )}
                      <div>{openComment(c)}</div>
                      <MusicEngagement id={id} record={record} comment={c}>
                      {!c.deleted && (
                        <>
                          <Button
                            variant="ghost"
                            disabled={!submit || busy}
                            aria-label="Reply to comment" title="Reply" onClick={() => setReplyTo(toBase64url(c.id))}
                          >
                            <Icon name="message" size={17}/>
                          </Button>
                          {c.author === session?.identity.account && (
                            <Button
                              variant="danger"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Delete this comment? Its earlier content remains in chain history."
                                  )
                                )
                                  void remove(c);
                              }}
                            >
                              Delete
                            </Button>
                          )}
                        </>
                      )}
                      </MusicEngagement>
                    </article>
                  ))}
                </div>
                {after && (
                  <Button disabled={busy} onClick={() => void loadMore()}>
                    More comments
                  </Button>
                )}
                {session ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!voiceMode) void comment();
                    }}
                  >
                    {replyTo && (
                      <p>
                        Replying to a comment{" "}
                        <Button variant="ghost" onClick={() => setReplyTo(undefined)}>
                          Cancel reply
                        </Button>
                      </p>
                    )}
                    <div className="row" aria-label="Comment type">
                      <Button aria-pressed={!voiceMode} disabled={busy} onClick={() => setVoiceMode(false)}>Text</Button>
                      <Button aria-pressed={voiceMode} disabled={busy} onClick={() => setVoiceMode(true)}>Voice</Button>
                    </div>
                    <Field label={voiceMode ? "Caption (optional)" : "Your comment"}>
                      {(field) => (
                        <textarea spellCheck
                          id={field}
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          rows={3}
                          disabled={busy}
                          maxLength={3984}
                        />
                      )}
                    </Field>
                    {voiceMode ? <VoiceCommentForm track={id} record={record} caption={text} replyTo={replyTo} onPosted={() => {
                      setVoiceMode(false); setText(""); setReplyTo(undefined); void refresh();
                    }}/> : <Button
                      type="submit"
                      variant="primary"
                      busy={busy}
                      disabled={!text.trim() || !submit}
                    >
                      Post comment
                    </Button>}
                  </form>
                ) : (
                  <Notice>Unlock your account to comment.</Notice>
                )}
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
