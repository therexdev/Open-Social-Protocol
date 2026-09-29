/** Text + audience + optional media reference, ending in an explicit confirmation dialog. */
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useServices } from "../../api/services";
import { useSettings } from "../../stores/settings";
import { useVaultStore } from "../../vault/context";
import { preparePhoto, uploadPhoto } from "./uploadPhoto";
import { MediaPhoto } from "../../components/MediaPhoto";
import { toBase64url } from "../../util/bytes";

export interface ComposerFormProps {
  /** Existing draft to resume (keeps its attempt id). */
  draft?: DraftRecord;
  replyTo?: string;
  edit?: DraftRecord["edit"] & { text: string; audience: number; media?: MediaAttachment[] };
  defaultAudience?: number;
  compact?: boolean;
  onSubmitted?: (draft: DraftRecord) => void;
  onCancel?: () => void;
}

export function ComposerForm({ draft, replyTo, edit, defaultAudience = AUDIENCE.EVERYONE, compact = false, onSubmitted, onCancel }: ComposerFormProps) {
  const account = useVault((s) => s.account) ?? "";
  const session = useVault(s => s.session), vault = useVaultStore();
  const { resolved } = useServices();
  const uploadOverride = useSettings(s => s.mediaUploadUrl);
  const photoInput = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | undefined>(undefined);
  const previews = useRef(new Map<string,string>());
  const [uploadStatus,setUploadStatus] = useState("");
  const can = useCanAct();
  const { start, ready } = usePublish();
  const [text, setText] = useState(draft?.text ?? edit?.text ?? "");
  const [audience, setAudience] = useState<number>(draft?.audience ?? edit?.audience ?? defaultAudience);
  const [mediaUrl, setMediaUrl] = useState("");
  const [media, setMedia] = useState<MediaAttachment[]>(draft?.media?.map(m => ({ ...m, contentHash: bytesOf(m.contentHash) })) ?? edit?.media ?? []);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirm, setConfirm] = useState<DraftRecord | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => () => { uploadController.current?.abort(); for (const url of previews.current.values()) URL.revokeObjectURL(url); previews.current.clear(); },[session]);
  useEffect(() => { if (!session) { setMedia([]); setConfirm(undefined); } },[session]);

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

  const addPhotos = async (files: File[]) => {
    if (!session || !resolved.deployment || attaching || !files.length) return;
    if (media.length + files.length > LIMITS.maxMediaRefs) { setError(`Choose at most ${LIMITS.maxMediaRefs - media.length} more photos.`); return; }
    const controller = new AbortController(); uploadController.current = controller;
    setAttaching(true); setError(undefined);
    try {
      for (let i = 0; i < files.length; i++) {
        setUploadStatus(`Preparing photo ${i + 1} of ${files.length}…`);
        const bytes = await preparePhoto(files[i]!, controller.signal);
        if (controller.signal.aborted || vault.getState().session !== session) return;
        setUploadStatus(`${encrypted ? "Encrypting and uploading" : "Uploading"} photo ${i + 1} of ${files.length}…`);
        const endpoint = uploadOverride?.trim() || (resolved.sponsorUrls[0] ? `${resolved.sponsorUrls[0].replace(/\/+$/, "")}/v1/media` : "");
        const attachment = await uploadPhoto(bytes,{ endpoint, chainId: resolved.deployment.chainId, contract: resolved.deployment.contracts.identity.address, identity: session.identity, private: encrypted, signal: controller.signal });
        if (controller.signal.aborted || vault.getState().session !== session) return;
        const previous = previews.current.get(attachment.url); if (previous) URL.revokeObjectURL(previous);
        previews.current.set(attachment.url,URL.createObjectURL(new Blob([new Uint8Array(bytes)],{ type: "image/jpeg" })));
        setMedia(current => [...current,attachment]);
      }
    } catch (error) { if (!controller.signal.aborted) setError(errorMessage(error)); }
    finally { setAttaching(false); setUploadStatus(""); }
  };
  const removeMedia = (index: number) => {
    const item = media[index], preview = item && previews.current.get(item.url);
    if (preview) { URL.revokeObjectURL(preview); previews.current.delete(item!.url); }
    setMedia(list => list.filter((_,i) => i !== index));
  };

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
    if (attaching) return;
    if (text.trim().length === 0 && !media.length) {
      setError("Write something or add a photo first.");
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
      for (const url of previews.current.values()) URL.revokeObjectURL(url); previews.current.clear();
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
      <div className="composer-identity"><Avatar account={account}/><div><strong>You</strong><Field label="Who can read it">{id => <select id={id} value={audience} disabled={edit !== undefined || draft?.edit !== undefined || attaching || media.length > 0} onChange={event => setAudience(Number(event.target.value))}><option value={AUDIENCE.EVERYONE}>Public</option><option value={AUDIENCE.FRIENDS}>Friends</option></select>}</Field></div></div>
      {media.length > 0 && <p className="hint">Remove attachments before changing who can see this post.</p>}
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
            required={!media.length}
          />
        )}
      </Field>
      <details className="composer-privacy"><summary><Icon name={encrypted ? "lock" : "globe"} size={16}/>{encrypted ? "Only your friends can read this post." : "Anyone can read this post."}</summary><p>{encrypted ? friendsExplanation : everyoneExplanation}</p></details>
      <div className="photo-tools">
        <input ref={photoInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" multiple aria-label="Choose photos" disabled={attaching || !can.ok} onChange={e => { const input = e.currentTarget; const files = Array.from(input.files ?? []); void addPhotos(files).finally(() => { input.value = ""; }); }}/>
        <Button disabled={attaching || !can.ok || media.length >= LIMITS.maxMediaRefs} onClick={() => photoInput.current?.click()}>Add photos</Button>
        {uploadStatus && <span role="status">{uploadStatus}</span>}
        <p className="hint">{encrypted ? "Photos are encrypted on this device before upload." : "Public photos are uploaded to IPFS when selected."} Free storage has limited capacity and is not guaranteed forever.</p>
      </div>
      {media.length > 0 && <div className="composer-photos">{media.map((m,i) => <div className="composer-photo" key={`${m.url}:${i}`}>
        {previews.current.has(m.url) ? <div className="ipfs-photo"><img src={previews.current.get(m.url)} alt={m.altText || "Attached photo"}/></div> : m.url.startsWith("ipfs://") ? <MediaPhoto location={m.url} hash={toBase64url(m.contentHash)} mime={m.mime} encryption={m.encryption} alt={m.altText}/> : <span className="mono">{m.url}</span>}
        <Field label={`Photo ${i + 1} description (optional)`}>{id => <input id={id} value={m.altText ?? ""} maxLength={160} onChange={e => setMedia(list => list.map((item,j) => j === i ? { ...item,altText: e.target.value } : item))}/>}</Field>
        <Button variant="ghost" onClick={() => removeMedia(i)}>Remove photo {i + 1}</Button>
      </div>)}</div>}
      {!compact && (
        <details className="media-attach"><summary>Add media by URL</summary>
          {encrypted && <Notice>Use Add photos for private images. Linked files remain public at their original host.</Notice>}
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
        </details>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {!can.ok && <Notice kind="warning">{can.reason}</Notice>}
      <div className="row">
        <Button type="submit" variant="primary" busy={busy} disabled={attaching || !ready || !can.ok || tooLong || (text.trim().length === 0 && !media.length)}>
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
