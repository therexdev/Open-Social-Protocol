import { AccountPicker } from "../library/AccountPicker";
import { prepareArchivedPhoto } from "./archivePhoto";
/** Text + audience + optional media reference, ending in an explicit confirmation dialog. */
import { useEffect, useMemo, useRef, useState } from "react";
import { AUDIENCE, LIMITS, validatePoll, PHOTO_MAX_BYTES, photoCost, requirePhotoLibrary } from "@osp/sdk";
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
import { useVaultStore } from "../../vault/context";
import { preparePhoto } from "./preparePhoto";
import { PhotoReadError } from "./preparePhoto";
import { MediaPhoto } from "../../components/MediaPhoto";
import { toBase64url } from "../../util/bytes";
import { MentionTextarea } from "./MentionTextarea";
import { RichText } from "../../components/RichText";

export interface ComposerFormProps {
  /** Existing draft to resume (keeps its attempt id). */
  draft?: DraftRecord;
  replyTo?: string;
  edit?: DraftRecord["edit"] & { text: string; audience: number; media?: MediaAttachment[] };
  defaultAudience?: number;
  selectedAccounts?: string[];
  collectionId?: string;
  galleryOnly?: boolean;
  audienceLocked?: boolean;
  compact?: boolean;
  onSubmitted?: (draft: DraftRecord) => void;
  onCancel?: () => void;
}

export function ComposerForm({ draft, replyTo, edit, defaultAudience = AUDIENCE.EVERYONE, selectedAccounts = [], collectionId, galleryOnly = false, audienceLocked = false, compact = false, onSubmitted, onCancel }: ComposerFormProps) {
  const account = useVault((s) => s.account) ?? "";
  const session = useVault(s => s.session), vault = useVaultStore();
  const { resolved, protocol } = useServices();
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | undefined>(undefined);
  const previews = useRef(new Map<string,string>());
  const [uploadStatus,setUploadStatus] = useState("");
  const [fileReadFailed,setFileReadFailed] = useState(false);
  const can = useCanAct();
  const { start, ready } = usePublish();
  const [pollEnabled, setPollEnabled] = useState(!!draft?.poll);
  const [pollOptions, setPollOptions] = useState(draft?.poll?.options ?? ["", ""]);
  const [pollHours, setPollHours] = useState(24);
  const [text, setText] = useState(draft?.text ?? edit?.text ?? "");
  const [audience, setAudience] = useState<number>(draft?.audience ?? edit?.audience ?? defaultAudience);
  const [selected,setSelected] = useState(draft?.selectedAccounts ?? selectedAccounts);
  const [photoLimit,setPhotoLimit] = useState(PHOTO_MAX_BYTES);
  const [alsoPost,setAlsoPost] = useState(!galleryOnly);
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
      setPollEnabled(!!draft.poll);
      setPollOptions(draft.poll?.options ?? ["", ""]);
      setAudience(draft.audience);
      setMedia(draft.media?.map(m => ({ ...m, contentHash: bytesOf(m.contentHash) })) ?? []);
    }
  }, [draft]);

  const encrypted = audience !== AUDIENCE.EVERYONE;
  const bytes = useMemo(() => {
    try {
      return estimateEnvelopeBytes(buildContent({ text, media, createdAt: Date.now() }), encrypted);
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }, [text, media, encrypted]);
  const storageUnits = media.filter(m=>m.archiveBytes).reduce((sum,m)=>sum+photoCost(m.size),0);
  const remaining = LIMITS.maxEnvelopeBytes - bytes;
  const tooLong = remaining < 0;

  const addPhotos = async (files: File[]) => {
    if (!session || !protocol || !resolved.deployment || attaching || !files.length) return;
    if (media.length + files.length > LIMITS.maxMediaRefs) { setError(`Choose at most ${LIMITS.maxMediaRefs - media.length} more photos.`); return; }
    const controller = new AbortController(); uploadController.current = controller;
    setAttaching(true); setError(undefined); setFileReadFailed(false);
    try {
      await requirePhotoLibrary(protocol);
      for (let i = 0; i < files.length; i++) {
        setUploadStatus(`Preparing photo ${i + 1} of ${files.length}…`);
        const bytes = await preparePhoto(files[i]!, controller.signal, photoLimit - (encrypted ? 16 : 0));
        if (controller.signal.aborted || vault.getState().session !== session) return;
        setUploadStatus(`${encrypted ? "Encrypting" : "Preparing"} photo ${i + 1} of ${files.length}…`);
        const attachment = prepareArchivedPhoto(bytes, protocol, encrypted);
        if (controller.signal.aborted || vault.getState().session !== session) return;
        const previous = previews.current.get(attachment.url); if (previous) URL.revokeObjectURL(previous);
        previews.current.set(attachment.url,URL.createObjectURL(new Blob([new Uint8Array(bytes)],{ type: "image/jpeg" })));
        setMedia(current => [...current,attachment]);
      }
    } catch (error) { if (!controller.signal.aborted) { setError(errorMessage(error)); setFileReadFailed(error instanceof PhotoReadError); } }
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
    if ((galleryOnly || text.trim().length === 0) && !media.length) {
      setError(galleryOnly ? "Add a photo first." : "Write something or add a photo first.");
      return;
    }
    setBusy(true);
    try {
      const record: DraftRecord = draft
        ? { ...draft, text, audience, mediaUrls: media.map((m) => m.url), updatedAt: Date.now() }
        : newDraft(account, { text, audience, mediaUrls: media.map((m) => m.url), ...(replyTo && { replyTo }), ...(edit && { edit: { postId: edit.postId, previousVersion: edit.previousVersion, versionNumber: edit.versionNumber } }) });
      record.selectedAccounts = selected;
      record.collectionId = draft?.collectionId ?? collectionId;
      record.galleryOnly = draft?.galleryOnly ?? (edit ? galleryOnly : galleryOnly && !alsoPost);
      if (pollEnabled) {
        const poll = { question: text.trim(), options: pollOptions.map(o => o.trim()), closes_at: draft?.poll?.closes_at ?? String(Date.now() + pollHours * 3600000) };
        validatePoll(poll);
        record.poll = poll;
      } else delete record.poll;
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
      setPollEnabled(false);
      setPollOptions(["", ""]);
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
      <div className="composer-identity"><Avatar account={account}/><div><strong>You</strong><Field label="Who can read it">{id => <select id={id} value={audience} disabled={audienceLocked || !!collectionId || pollEnabled || edit !== undefined || draft?.edit !== undefined || attaching || media.length > 0} onChange={event => setAudience(Number(event.target.value))}><option value={AUDIENCE.EVERYONE}>Public</option><option value={AUDIENCE.FRIENDS}>Friends</option><option value={AUDIENCE.CUSTOM}>Private · selected people</option></select>}</Field></div></div>
      {audience === AUDIENCE.CUSTOM && !collectionId && !draft?.collectionId && <AccountPicker value={selected} onChange={setSelected} disabled={busy || !!draft?.publication}/>}
      {collectionId && <p className="hint">Only current group members receive this post. Membership is checked again before publishing.</p>}
      {galleryOnly && !edit && <label className="gallery-also-post"><input type="checkbox" checked={alsoPost} onChange={e=>setAlsoPost(e.target.checked)}/>Also share as a post</label>}
      {media.length > 0 && <p className="hint">Remove attachments before changing who can see this post.</p>}
      <div className="composer-content">
      <Field label={pollEnabled ? "Your poll question" : edit ? "Edit your post" : replyTo ? "Your reply" : "Post content"} hint={tooLong ? `${-remaining} bytes over the limit` : `${remaining} bytes left`}>
        {(id) => (
          <MentionTextarea
            showHint={false}
            id={id}
            account={account}
            value={text}
            onValueChange={setText}
            rows={compact ? 3 : 6}
            maxLength={LIMITS.maxEnvelopeBytes}
            aria-invalid={tooLong || undefined}
            placeholder={replyTo ? "Write a reply…" : "Write a post…"}
            required={!galleryOnly && !media.length}
          />
        )}
      </Field>
      </div>
      <div className="composer-tools">
        <Button disabled={attaching || !can.ok || media.length >= LIMITS.maxMediaRefs} onClick={() => photoInput.current?.click()}><Icon name="photo" size={18}/>Add photos</Button>
      {!galleryOnly && !collectionId && !edit && !draft?.edit && !replyTo && <Button variant={pollEnabled ? "primary" : "default"} disabled={encrypted || busy || !!draft?.publication} aria-pressed={pollEnabled} onClick={() => setPollEnabled(v => !v)}><Icon name="poll" size={18}/>{pollEnabled ? "Remove poll" : "Add poll"}</Button>}
      </div>
      {pollEnabled && <fieldset className="poll-editor"><legend>Poll answers</legend>
        <p className="hint">Use the post text as your question. Answers are public. Answering adds participation, not an upvote. The question and answers cannot be edited after publishing.</p>
        {pollOptions.map((option, i) => <div className="row" key={i}><Field label={`Answer ${i + 1}`}>{id => <input id={id} value={option} maxLength={120} required onChange={e => setPollOptions(items => items.map((v, j) => j === i ? e.target.value : v))}/>}</Field>
          <Button variant="ghost" disabled={pollOptions.length <= 2} onClick={() => setPollOptions(items => items.filter((_, j) => j !== i))}>Remove answer {i + 1}</Button></div>)}
        <Button disabled={pollOptions.length >= 8} onClick={() => setPollOptions(items => [...items, ""])}>Add answer</Button>
        <Field label="Poll duration">{id => <select id={id} value={pollHours} disabled={!!draft?.poll} onChange={e => setPollHours(Number(e.target.value))}><option value={1}>1 hour</option><option value={24}>1 day</option><option value={72}>3 days</option><option value={168}>7 days</option></select>}</Field>
      </fieldset>}
      <details className="composer-privacy"><summary><Icon name={encrypted ? "lock" : "globe"} size={16}/>{encrypted ? audience === AUDIENCE.CUSTOM ? "Only selected people can read this post." : "Only your friends can read this post." : "Anyone can read this post."}</summary><p>{audience === AUDIENCE.CUSTOM ? "Encrypted for selected accounts. Removing access creates a new version; earlier copies and keys cannot be taken back." : encrypted ? friendsExplanation : everyoneExplanation}</p></details>
      <div className="photo-tools">
        <Field label="Photo size budget">{id=><select id={id} value={photoLimit} disabled={attaching} onChange={e=>setPhotoLimit(Number(e.target.value))}>{[1,2,4,7,10].map(rate=><option key={rate} value={rate*32768}>Up to {rate*32} KiB · {rate} usage {rate===1?'unit':'units'}</option>)}</select>}</Field>
        <input ref={photoInput} className="visually-hidden" type="file" accept="image/*" multiple aria-label="Choose photos" disabled={attaching || !can.ok} onChange={e => { const input = e.currentTarget; const files = Array.from(input.files ?? []); void addPhotos(files).finally(() => { input.value = ""; }); }}/>
        <input ref={fileInput} className="visually-hidden" type="file" multiple aria-label="Choose photo files" disabled={attaching || !can.ok} onChange={e => { const input = e.currentTarget; const files = Array.from(input.files ?? []); void addPhotos(files).finally(() => { input.value = ""; }); }}/>
        {fileReadFailed && <Button variant="ghost" disabled={attaching || !can.ok} onClick={() => fileInput.current?.click()}>Choose from files</Button>}
        {uploadStatus && <span role="status">{uploadStatus}</span>}
        <p className="hint">Photos are prepared locally. Saving uses free capacity first, then regenerating OSAT capacity. The exact cost is shown before publishing.</p>
      </div>
      {media.length > 0 && <div className="composer-photos">{media.map((m,i) => <div className="composer-photo" key={`${m.url}:${i}`}>
        {previews.current.has(m.url) ? <div className="ipfs-photo"><img src={previews.current.get(m.url)} alt={m.altText || "Attached photo"}/></div> : (m.url.startsWith("ipfs://") || m.url.startsWith("osp-photo://")) ? <MediaPhoto location={m.url} hash={toBase64url(m.contentHash)} mime={m.mime} encryption={m.encryption} alt={m.altText}/> : <span className="mono">{m.url}</span>}
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
        <Button type="submit" variant="primary" busy={busy} disabled={attaching || !ready || !can.ok || tooLong || ((galleryOnly || text.trim().length === 0) && !media.length)}>
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
              <strong>Audience: {audienceLabel(confirm.audience)}.</strong> {confirm.audience === AUDIENCE.CUSTOM ? "Only you and the selected accounts can read the current version. Previous recipients may keep earlier versions." : confirm.audience === AUDIENCE.FRIENDS ? friendsExplanation : everyoneExplanation}
            </p>
            <p><strong>Photo storage: {storageUnits} usage {storageUnits===1 ? "unit" : "units"}</strong>, plus 1 for the post. Prepared images: {media.map(m=>`${(m.size/1024).toFixed(1)} KiB`).join(', ') || 'none'}. Existing stored images and external URLs have no new storage charge.</p>
            <p>{confirm.galleryOnly ? "Your photos will appear in your profile while saving finishes." : confirm.collectionId ? "Your post will appear in this group while publishing finishes." : "Your post will appear in your feed right away while it finishes publishing."} You can keep browsing.</p>
            <p>
              Publishing is permanent: the network records it and copies may be kept by anyone who can read it. You can edit or mark it deleted later, but
              earlier versions stay in the public history.
            </p>
            <blockquote className="preview"><RichText text={text}/></blockquote>
            {confirm.poll && <><ul>{confirm.poll.options.map((o, i) => <li key={i}>{o}</li>)}</ul><p>Closes {new Date(Number(confirm.poll.closes_at)).toLocaleString()}. Answers are public and separate from upvotes and downvotes.</p></>}
          </>
        )}
      </ConfirmDialog>
    </form>
  );
}
