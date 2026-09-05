/** Text + audience + optional media reference, ending in an explicit confirmation dialog. */
import { useEffect, useMemo, useState } from "react";
import { AUDIENCE, LIMITS } from "@osp/sdk";
import { AccountLink, Button, ConfirmDialog, Field, Notice } from "../../components/ui";
import { errorMessage } from "../../util/format";
import type { DraftRecord } from "../../vault/store";
import { newDraft } from "./drafts";
import { attachMediaFromUrl, buildContent, estimateEnvelopeBytes, type MediaAttachment, type PublishPlan } from "./publish";
import { usePublish, type PublishOutcome } from "./usePublish";
import { useCanAct } from "../session";
import { useVault } from "../../vault/context";
import { shortAddress } from "../../util/format";
import { audienceLabel } from "../feed/PostCard";
import { useProfileName } from "../profile/useProfileName";

/** One friend who will receive the reading key: name from the indexer (a hint) plus the address (what is sealed to). */
function Recipient({ account }: { account: string }) {
  const name = useProfileName(account);
  return (
    <li>
      <AccountLink account={account} name={name} /> <span className="mono muted">{shortAddress(account)}</span>
    </li>
  );
}

export interface ComposerFormProps {
  /** Existing draft to resume (keeps its attempt id). */
  draft?: DraftRecord;
  replyTo?: string;
  edit?: DraftRecord["edit"] & { text: string; audience: number };
  defaultAudience?: number;
  compact?: boolean;
  onPublished?: (outcome: PublishOutcome) => void;
  onCancel?: () => void;
}

export function ComposerForm({ draft, replyTo, edit, defaultAudience = AUDIENCE.EVERYONE, compact = false, onPublished, onCancel }: ComposerFormProps) {
  const account = useVault((s) => s.account) ?? "";
  const can = useCanAct();
  const { plan, publish, ready } = usePublish();
  const [text, setText] = useState(draft?.text ?? edit?.text ?? "");
  const [audience, setAudience] = useState<number>(draft?.audience ?? edit?.audience ?? defaultAudience);
  const [mediaUrl, setMediaUrl] = useState("");
  const [media, setMedia] = useState<MediaAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirm, setConfirm] = useState<{ draft: DraftRecord; plan: PublishPlan } | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (draft) {
      setText(draft.text);
      setAudience(draft.audience);
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
      const built = await plan({ draft: record, media });
      setConfirm({ draft: record, plan: built });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const outcome = await publish({ draft: confirm.draft, media }, confirm.plan);
      setConfirm(undefined);
      setText("");
      setMedia([]);
      onPublished?.(outcome);
    } catch (e) {
      setConfirm(undefined);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const friendsExplanation =
    "Only your friends can read this. It is encrypted on your device with a key shared with your friends; people you add as friends later also receive that key, so they can read your friends-only posts from the current period. Removing or blocking a friend switches to a new key for your later posts but cannot take back copies they already have.";
  const everyoneExplanation = "Anyone on the network, including people without an account, can read this. It is stored in the clear.";

  return (
    <form
      className={`composer ${compact ? "composer-compact" : ""}`.trim()}
      onSubmit={(e) => {
        e.preventDefault();
        void prepare();
      }}
    >
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
      <fieldset className="audience">
        <legend>Who can read it</legend>
        <label className={`radio ${audience === AUDIENCE.EVERYONE ? "selected" : ""}`.trim()}>
          <input type="radio" name="audience" value={AUDIENCE.EVERYONE} checked={audience === AUDIENCE.EVERYONE} onChange={() => setAudience(AUDIENCE.EVERYONE)} disabled={edit !== undefined && edit.audience !== AUDIENCE.EVERYONE} />
          <span>
            <strong>Everyone</strong>
            <small>{everyoneExplanation}</small>
          </span>
        </label>
        <label className={`radio ${audience === AUDIENCE.FRIENDS ? "selected" : ""}`.trim()}>
          <input type="radio" name="audience" value={AUDIENCE.FRIENDS} checked={audience === AUDIENCE.FRIENDS} onChange={() => setAudience(AUDIENCE.FRIENDS)} disabled={edit !== undefined && edit.audience !== AUDIENCE.FRIENDS} />
          <span>
            <strong>Friends</strong>
            <small>{friendsExplanation}</small>
          </span>
        </label>
      </fieldset>
      {!compact && (
        <div className="media-attach">
          <Field label="Attach media by URL (optional)" hint="The file is fetched by your browser to record its fingerprint; the host must allow cross-origin reads. Media itself is not stored on the network.">
            {(id) => (
              <div className="row">
                <input id={id} type="url" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://…" maxLength={LIMITS.maxLocationChars} />
                <Button onClick={() => void attach()} busy={attaching} disabled={mediaUrl.trim().length === 0 || media.length >= LIMITS.maxMediaRefs}>
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
        </div>
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
        confirmLabel={`Publish to ${audienceLabel(audience)}`}
        busy={busy}
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => void send()}
      >
        {confirm && (
          <>
            <p>
              <strong>Audience: {audienceLabel(confirm.plan.audience)}.</strong> {confirm.plan.audience === AUDIENCE.FRIENDS ? friendsExplanation : everyoneExplanation}
            </p>
            {confirm.plan.audience === AUDIENCE.FRIENDS && (
              <div className="recipients">
                {confirm.plan.recipients.length > 0 ? (
                  <>
                    <p>
                      {confirm.plan.epochKey ? "A new reading key" : "The current reading key"} will be shared, in the same step, with {confirm.plan.recipients.length === 1 ? "this friend" : `these ${confirm.plan.recipients.length} friends`}{" "}
                      (confirmed on the network):
                    </p>
                    <ul className="list recipient-list">
                      {confirm.plan.recipients.map((account) => (
                        <Recipient key={account} account={account} />
                      ))}
                    </ul>
                  </>
                ) : (
                  <p>Every friend already holds the reading key; no key is shared in this step.</p>
                )}
                {confirm.plan.skipped.length > 0 && (
                  <p>
                    {confirm.plan.skipped.length} friend(s) have no encryption key registered on the network yet and will not be able to read it:{" "}
                    <span className="mono">{confirm.plan.skipped.map((a) => shortAddress(a)).join(", ")}</span>
                  </p>
                )}
              </div>
            )}
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
