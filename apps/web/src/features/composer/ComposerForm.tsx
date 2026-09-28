/** Text + audience + optional media reference, ending in an explicit confirmation dialog. */
import { useEffect, useMemo, useState } from "react";
import { AUDIENCE, LIMITS } from "@osp/sdk";
import { Button, ConfirmDialog, Field, Notice } from "../../components/ui";
import { errorMessage } from "../../util/format";
import type { DraftRecord } from "../../vault/store";
import { newDraft } from "./drafts";
import { attachMediaFromUrl, buildContent, estimateEnvelopeBytes, type MediaAttachment } from "./publish";
import { usePublish } from "./usePublish";
import { useCanAct } from "../session";
import { useVault } from "../../vault/context";
import { bytesOf } from "../../util/bytes";
import { audienceLabel } from "../feed/PostCard";
import { Avatar, Icon } from "../../components/Icon";

export interface ComposerFormProps {
  /** Existing draft to resume (keeps its attempt id). */
  draft?: DraftRecord;
  replyTo?: string;
  edit?: DraftRecord["edit"] & { text: string; audience: number };
  defaultAudience?: number;
  compact?: boolean;
  onSubmitted?: (draft: DraftRecord) => void;
  onCancel?: () => void;
}

export function ComposerForm({ draft, replyTo, edit, defaultAudience = AUDIENCE.EVERYONE, compact = false, onSubmitted, onCancel }: ComposerFormProps) {
  const account = useVault((s) => s.account) ?? "";
  const can = useCanAct();
  const { start, ready } = usePublish();
  const [text, setText] = useState(draft?.text ?? edit?.text ?? "");
  const [audience, setAudience] = useState<number>(draft?.audience ?? edit?.audience ?? defaultAudience);
  const [mediaUrl, setMediaUrl] = useState("");
  const [media, setMedia] = useState<MediaAttachment[]>(draft?.media?.map(m => ({ ...m, contentHash: bytesOf(m.contentHash) })) ?? []);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirm, setConfirm] = useState<DraftRecord | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (draft) {
      setText(draft.text);
      setAudience(draft.audience);
      setMedia(draft.media?.map(m => ({ ...m, contentHash: bytesOf(m.contentHash) })) ?? []);
    }
  }, [draft]);

  const encrypted = audience === AUDIENCE.FRIENDS;
  const bytes = useMemo(() => {
    try {
      return estimateEnvelopeBytes(buildContent({ text, media, createdAt: Date.now() }), encrypted);
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }, [text, media, encrypted]);
  const remaining = LIMITS.maxEnvelopeBytes - bytes;
  const tooLong = remaining < 0;

  const attach = async () => {
    setAttaching(true);
    setError(undefined);
    try {
      const attachment = await attachMediaFromUrl(mediaUrl.trim());
      setMedia((m) => [...m, attachment]);
      setMediaUrl("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAttaching(false);
    }
  };

  const prepare = async () => {
    setError(undefined);
    if (!can.ok) {
      setError(can.reason);
      return;
    }
    if (text.trim().length === 0) {
      setError("Write something first.");
      return;
    }
    setBusy(true);
    try {
      const record: DraftRecord = draft
        ? { ...draft, text, audience, mediaUrls: media.map((m) => m.url), updatedAt: Date.now() }
        : newDraft(account, { text, audience, mediaUrls: media.map((m) => m.url), ...(replyTo && { replyTo }), ...(edit && { edit: { postId: edit.postId, previousVersion: edit.previousVersion, versionNumber: edit.versionNumber } }) });
      setConfirm(record);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!confirm || busy) return;
    setBusy(true);
    try {
      const accepted = await start({ draft: confirm, media });
      setConfirm(undefined);
      setText("");
      setMedia([]);
      onSubmitted?.(accepted);
    } catch (e) {
      setConfirm(undefined);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const friendsExplanation =
    "Only your friends can read this. It is encrypted on your device with a key shared with your friends; people you add as friends later also receive that key, so they can read all your earlier friends-only posts. Removing or blocking a friend switches to a new key for your later posts but cannot take back copies they already have.";
  const everyoneExplanation = "Anyone on the network, including people without an account, can read this. It is stored in the clear.";

  return (
    <form
      className={`composer ${compact ? "composer-compact" : ""}`.trim()}
      onSubmit={(e) => {
        e.preventDefault();
        void prepare();
      }}
    >
      <div className="composer-identity"><Avatar account={account}/><div><strong>You</strong><Field label="Who can read it">{id => <select id={id} value={audience} disabled={edit !== undefined || draft?.edit !== undefined} onChange={event => setAudience(Number(event.target.value))}><option value={AUDIENCE.EVERYONE}>Public</option><option value={AUDIENCE.FRIENDS}>Friends</option></select>}</Field></div></div>
      <Field label={edit ? "Edit your post" : replyTo ? "Your reply" : "What's on your mind?"} hint={tooLong ? `${-remaining} bytes over the limit` : `${remaining} bytes left`}>
        {(id) => (
          <textarea
            id={id}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={compact ? 3 : 6}
            maxLength={LIMITS.maxEnvelopeBytes}
            aria-invalid={tooLong || undefined}
            placeholder={replyTo ? "Write a reply…" : "Write a post…"}
            required
          />
        )}
      </Field>
      <details className="composer-privacy"><summary><Icon name={encrypted ? "lock" : "globe"} size={16}/>{encrypted ? "Only your friends can read this post." : "Anyone can read this post."}</summary><p>{encrypted ? friendsExplanation : everyoneExplanation}</p></details>
      {!compact && (
        <details className="media-attach"><summary>Add media by URL</summary>
          {encrypted && <Notice>Friends-only posts support text and links. Media attachments by URL remain public at their original host, so attachments are available for Everyone posts.</Notice>}
          <Field label="Attach media by URL (optional)" hint="The file is fetched by your browser to record its fingerprint; the host must allow cross-origin reads. Media itself is not stored on the network.">
            {(id) => (
              <div className="row">
                <input id={id} type="url" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://…" maxLength={LIMITS.maxLocationChars} disabled={encrypted} />
                <Button onClick={() => void attach()} busy={attaching} disabled={encrypted || mediaUrl.trim().length === 0 || media.length >= LIMITS.maxMediaRefs}>
                  Attach
                </Button>
              </div>
            )}
          </Field>
          {media.length > 0 && (
            <ul className="media-list">
              {media.map((m, i) => (
                <li key={i}>
                  <span className="mono">{m.url}</span> <span className="muted">({m.mime}, {m.size} bytes)</span>{" "}
                  <Button variant="ghost" onClick={() => setMedia((list) => list.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {!can.ok && <Notice kind="warning">{can.reason}</Notice>}
      <div className="row">
        <Button type="submit" variant="primary" busy={busy} disabled={!ready || !can.ok || tooLong || text.trim().length === 0}>
          {edit ? "Review edit" : replyTo ? "Review reply" : "Review and publish"}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirm !== undefined}
        title={edit ? "Publish this edit?" : replyTo ? "Publish this reply?" : "Publish this post?"}
        confirmLabel={busy ? "Saving…" : `Publish to ${audienceLabel(audience)}`}
        busy={busy}
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => void send()}
      >
        {confirm && (
          <>
            <p>
              <strong>Audience: {audienceLabel(confirm.audience)}.</strong> {confirm.audience === AUDIENCE.FRIENDS ? friendsExplanation : everyoneExplanation}
            </p>
            <p>Your post will appear in your feed right away while it finishes publishing. You can keep browsing.</p>
            <p>
              Publishing is permanent: the network records it and copies may be kept by anyone who can read it. You can edit or mark it deleted later, but
              earlier versions stay in the public history.
            </p>
            <blockquote className="preview">{text}</blockquote>
          </>
        )}
      </ConfirmDialog>
    </form>
  );
}
