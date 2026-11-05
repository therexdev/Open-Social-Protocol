import { MediaCapture, type CapturedMedia, type ClipKind } from "../media/MediaCapture";
import { prepareClip, prepareVideoClip } from "../media/clipArchive";
import { AttachmentDialog } from "./AttachmentDialog";
import { GroupPicker } from "./GroupPicker";
import { AccountPicker } from "../library/AccountPicker";
import { prepareArchivedPhoto } from "./archivePhoto";
/** Text + audience + optional media reference, ending in an explicit confirmation dialog. */
import { useEffect, useMemo, useRef, useState } from "react";
import { AUDIENCE, LIMITS, voiceStorageUnits, validatePoll, PHOTO_MAX_BYTES, PHOTO_BLOCK_BYTES, PHOTO_RATES, photoCost, requirePhotoLibrary } from "@osp/sdk";
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
  replyGuard?: { parentHash: string; friendsEpoch?: number };
  /** Existing draft to resume (keeps its attempt id). */
  draft?: DraftRecord;
  replyTo?: string;
  edit?: DraftRecord["edit"] & { text: string; audience: number; media?: MediaAttachment[] };
  initialMode?: "post" | ClipKind;
  defaultAudience?: number;
  selectedAccounts?: string[];
  collectionId?: string;
  galleryOnly?: boolean;
  audienceLocked?: boolean;
  compact?: boolean;
  onSubmitted?: (draft: DraftRecord) => void;
  onCancel?: () => void;
}

export function ComposerForm({ draft, replyTo, replyGuard, edit, initialMode = "post", defaultAudience = AUDIENCE.EVERYONE, selectedAccounts = [], collectionId: fixedCollectionId, galleryOnly = false, audienceLocked = false, compact = false, onSubmitted, onCancel }: ComposerFormProps) {
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
  const [groupAudience, setGroupAudience] = useState(false);
  const [chosenGroup, setChosenGroup] = useState("");
  const collectionId = fixedCollectionId ?? draft?.collectionId ?? (groupAudience ? chosenGroup || undefined : undefined);
  const needsGroup = groupAudience && !collectionId;
  const [selected,setSelected] = useState(draft?.selectedAccounts ?? selectedAccounts);
  const photoLimit = useRef(PHOTO_MAX_BYTES);
  const [tool, setTool] = useState<"photo" | "url">();
  const [urlError, setUrlError] = useState("");
  const [alsoPost,setAlsoPost] = useState(!galleryOnly);
  const [mediaUrl, setMediaUrl] = useState("");
  const [media, setMedia] = useState<MediaAttachment[]>(draft?.media?.map(m => ({ ...m, contentHash: bytesOf(m.contentHash) })) ?? edit?.media ?? []);
  const [chosenMode, setMode] = useState<"post" | ClipKind>(initialMode);
  const [captured, setCaptured] = useState<CapturedMedia>();
  const [capturing, setCapturing] = useState(false);
  const clip = media.find(m => m.url.startsWith("osp-clip://"));
  const mode = clip ? (clip.mime.startsWith("video/") ? "video" : "voice") : chosenMode;
  const needsClip = mode !== "post" && !clip;
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirm, setConfirm] = useState<DraftRecord | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => () => { uploadController.current?.abort(); for (const url of previews.current.values()) URL.revokeObjectURL(url); previews.current.clear(); },[session]);
  useEffect(() => { if (!session) { setMedia([]); setCaptured(undefined); setConfirm(undefined); } },[session]);

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
  const photoUnits = media.filter(m => m.archiveBytes && m.url.startsWith("osp-photo://")).reduce((sum, m) => sum + photoCost(m.size), 0);
  const voiceUnits = media.filter(m => m.archiveBytes && m.url.startsWith("osp-clip://") && m.mime.startsWith("audio/")).reduce((sum, m) => sum + voiceStorageUnits(m.size), 0);
  const videoUploads = media.filter(m => m.archiveBytes && m.url.startsWith("osp-clip://") && m.mime.startsWith("video/")).length;
  const currency = resolved.network === "mainnet" ? "KOIN" : "tKOIN";
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
        const bytes = await preparePhoto(files[i]!, controller.signal, photoLimit.current - (encrypted ? 16 : 0));
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

  const addClip = async (value: CapturedMedia | undefined) => {
    if (!value) {
      setCaptured(undefined);
      setMedia(items => items.filter(m => !m.url.startsWith("osp-clip://")));
      return;
    }
    if (mode === "post" || !session || !protocol || attaching) return;
    const controller = new AbortController();
    uploadController.current = controller;
    setAttaching(true);
    setError(undefined);
    try {
      const bytes = new Uint8Array(await value.file.arrayBuffer());
      if (controller.signal.aborted || vault.getState().session !== session) return;
      const source = { bytes, mime: value.mime, durationMs: value.durationMs };
      const item = mode === "video" ? await prepareVideoClip(source, protocol, encrypted) : prepareClip(source, mode, protocol, encrypted);
      if (controller.signal.aborted || vault.getState().session !== session) return;
      setMedia(items => [...items.filter(m => !m.url.startsWith("osp-clip://")), item]);
      setCaptured(value);
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!controller.signal.aborted) setAttaching(false);
    }
  };

  const attach = async () => {
    if (attaching || encrypted || media.length >= LIMITS.maxMediaRefs) return;
    const controller = new AbortController();
    uploadController.current = controller;
    setAttaching(true);
    setUrlError("");
    try {
      const attachment = await attachMediaFromUrl(mediaUrl.trim(), fetch, undefined, controller.signal);
      if (controller.signal.aborted || vault.getState().session !== session) return;
      setMedia((m) => [...m, attachment]);
      setMediaUrl("");
      setTool(undefined);
    } catch (e) {
      if (!controller.signal.aborted) setUrlError(errorMessage(e));
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
    if (attaching || capturing || needsClip || needsGroup) return;
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
      record.replyGuard = draft?.replyGuard ?? replyGuard;
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
      setCaptured(undefined);
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
      {!galleryOnly && !edit && !draft?.edit && <div className="composer-modes" role="group" aria-label={replyTo ? "Reply format" : "Post format"}>
        {(["post", "voice", ...(replyTo ? [] : ["video"])] as Array<"post" | ClipKind>).map(kind =>
          <Button key={kind} aria-pressed={kind === mode} disabled={attaching || capturing || busy || !!pollEnabled || media.length > 0} variant={kind === mode ? "primary" : "ghost"} onClick={() => { setMode(kind); setError(undefined); }}>
            <Icon name={kind === "video" ? "camera" : kind === "voice" ? "mic" : "edit"} size={17}/>{kind === "video" ? "Video" : kind === "voice" ? "Voice" : replyTo ? "Text" : "Post"}
          </Button>)}
      </div>}
      <div className="composer-identity"><Avatar account={account}/><div><strong>You</strong><Field label="Who can read it">{id => <select id={id} value={groupAudience || collectionId ? "group" : audience} disabled={audienceLocked || !!fixedCollectionId || !!draft?.collectionId || pollEnabled || !!edit || !!draft?.edit || attaching || capturing || media.length > 0} onChange={event => {
        const group = event.target.value === "group";
        setGroupAudience(group);
        setAudience(group ? AUDIENCE.CUSTOM : Number(event.target.value));
      }}>
        <option value={AUDIENCE.EVERYONE}>Public</option><option value={AUDIENCE.FRIENDS}>Friends</option><option value={AUDIENCE.CUSTOM}>Private · selected people</option>
        {(collectionId || (!galleryOnly && !replyTo && !edit && !draft?.edit)) && <option value="group">Group</option>}
      </select>}</Field></div></div>
      {groupAudience && !fixedCollectionId && !draft?.collectionId && <GroupPicker value={chosenGroup} onChange={setChosenGroup} disabled={attaching || busy || capturing || media.length > 0}/>}
      {audience === AUDIENCE.CUSTOM && !groupAudience && !audienceLocked && !replyGuard && !draft?.replyGuard && !collectionId && !draft?.collectionId && <AccountPicker value={selected} onChange={setSelected} disabled={busy || !!draft?.publication}/>}
      {collectionId && <p className="hint">Only current group members receive this post. Membership is checked again before publishing.</p>}
      {galleryOnly && !edit && <label className="gallery-also-post"><input type="checkbox" checked={alsoPost} onChange={e=>setAlsoPost(e.target.checked)}/>Also share as a post</label>}
      {media.length > 0 && <p className="hint">Remove attachments before changing who can see this post.</p>}
      {mode !== "post" && <div className="clip-compose">
        <p className="hint">{mode === "video" ? `10–30 seconds · MP4 or WebM · up to 10 MiB · 100 ${currency} per upload` : "Up to 2 minutes · 1 usage unit per 32 KiB"}</p>
        {clip && captured && captured.file.size > clip.size && <span className="hint">Lossless transfer: {(clip.size / 1024).toFixed(0)} KiB on chain · {(captured.file.size / 1024).toFixed(0)} KiB original</span>}
        {clip && !captured ? <div className="row"><span>{mode === "video" ? "Attached video" : "Attached voice recording"} · {(clip.size / 1024).toFixed(0)} KiB</span><Button onClick={() => void addClip(undefined)}>Remove attachment</Button></div> :
          <MediaCapture key={`${account}:${session ? "open" : "locked"}:${mode}`} kind={mode} value={captured} onChange={value => void addClip(value)} onBusyChange={setCapturing} disabled={!can.ok || needsGroup || attaching || busy}/>}
      </div>}
      <div className="composer-content">
      <Field label={pollEnabled ? "Your poll question" : edit ? "Edit your post" : replyTo ? "Your reply" : <span className="visually-hidden">Write a post</span>} hint={tooLong ? `${-remaining} bytes over the limit` : `${remaining} bytes left`}>
        {(id) => (
          <MentionTextarea
            showHint={false}
            id={id}
            account={account}
            value={text}
            onValueChange={setText}
            rows={compact || mode !== "post" ? 3 : 6}
            maxLength={LIMITS.maxEnvelopeBytes}
            aria-invalid={tooLong || undefined}
            placeholder={mode !== "post" ? "Add a caption (optional)…" : replyTo ? "Write a reply…" : "Write a post…"}
            required={!galleryOnly && !media.length}
          />
        )}
      </Field>
      </div>
      {mode === "post" && <div className="composer-tools">
        <Button disabled={attaching || needsGroup || !can.ok || media.length >= LIMITS.maxMediaRefs} onClick={() => setTool("photo")}><Icon name="photo" size={18}/>Add photos</Button>
        {!galleryOnly && <Button disabled={attaching || encrypted || !can.ok || media.length >= LIMITS.maxMediaRefs} title={encrypted ? "External media URLs are public" : undefined} onClick={() => { setUrlError(""); setTool("url"); }}><Icon name="link" size={18}/>Add media by URL</Button>}
      {!galleryOnly && !collectionId && !edit && !draft?.edit && !replyTo && <Button variant={pollEnabled ? "primary" : "default"} disabled={encrypted || busy || !!draft?.publication} aria-pressed={pollEnabled} onClick={() => setPollEnabled(v => !v)}><Icon name="poll" size={18}/>{pollEnabled ? "Remove poll" : "Add poll"}</Button>}
      </div>}
      {pollEnabled && <fieldset className="poll-editor"><legend>Poll answers</legend>
        <p className="hint">Use the post text as your question. Answers are public. Answering adds participation, not an upvote. The question and answers cannot be edited after publishing.</p>
        {pollOptions.map((option, i) => <div className="row" key={i}><Field label={`Answer ${i + 1}`}>{id => <input id={id} value={option} maxLength={120} required onChange={e => setPollOptions(items => items.map((v, j) => j === i ? e.target.value : v))}/>}</Field>
          <Button variant="ghost" disabled={pollOptions.length <= 2} onClick={() => setPollOptions(items => items.filter((_, j) => j !== i))}>Remove answer {i + 1}</Button></div>)}
        <Button disabled={pollOptions.length >= 8} onClick={() => setPollOptions(items => [...items, ""])}>Add answer</Button>
        <Field label="Poll duration">{id => <select id={id} value={pollHours} disabled={!!draft?.poll} onChange={e => setPollHours(Number(e.target.value))}><option value={1}>1 hour</option><option value={24}>1 day</option><option value={72}>3 days</option><option value={168}>7 days</option></select>}</Field>
      </fieldset>}
      <details className="composer-privacy"><summary><Icon name={encrypted ? "lock" : "globe"} size={16}/>{encrypted ? collectionId || groupAudience ? "Only group members can read this post." : audience === AUDIENCE.CUSTOM ? "Only selected people can read this post." : "Only your friends can read this post." : "Anyone can read this post."}</summary><p>{audience === AUDIENCE.CUSTOM ? "Encrypted for selected accounts. Removing access creates a new version; earlier copies and keys cannot be taken back." : encrypted ? friendsExplanation : everyoneExplanation}</p></details>
      <div className={fileReadFailed || uploadStatus ? "photo-tools" : undefined}>

        <input ref={photoInput} className="visually-hidden" type="file" accept="image/*" multiple aria-label="Choose photos" disabled={attaching || !can.ok} onChange={e => { const input = e.currentTarget; const files = Array.from(input.files ?? []); void addPhotos(files).finally(() => { input.value = ""; }); }}/>
        <input ref={fileInput} className="visually-hidden" type="file" multiple aria-label="Choose photo files" disabled={attaching || !can.ok} onChange={e => { const input = e.currentTarget; const files = Array.from(input.files ?? []); void addPhotos(files).finally(() => { input.value = ""; }); }}/>
        {fileReadFailed && <Button variant="ghost" disabled={attaching || !can.ok} onClick={() => fileInput.current?.click()}>Choose from files</Button>}
        {uploadStatus && <span role="status">{uploadStatus}</span>}

      </div>
      {media.length > 0 && <div className="composer-photos">{media.map((m,i) => m.url.startsWith("osp-clip://") ? null : <div className="composer-photo" key={`${m.url}:${i}`}>
        {previews.current.has(m.url) ? <div className="ipfs-photo"><img src={previews.current.get(m.url)} alt={m.altText || "Attached photo"}/></div> : (m.url.startsWith("ipfs://") || m.url.startsWith("osp-photo://")) ? <MediaPhoto location={m.url} hash={toBase64url(m.contentHash)} mime={m.mime} encryption={m.encryption} alt={m.altText}/> : <span className="mono">{m.url}</span>}
        <Field label={`Attachment ${i + 1} description (optional)`}>{id => <input id={id} value={m.altText ?? ""} maxLength={160} onChange={e => setMedia(list => list.map((item,j) => j === i ? { ...item,altText: e.target.value } : item))}/>}</Field>
        <Button variant="ghost" onClick={() => removeMedia(i)}>Remove attachment {i + 1}</Button>
      </div>)}</div>}
      {tool === "photo" && <AttachmentDialog title="Photo size budget" onClose={() => setTool(undefined)}>
        <p className="hint">Choose a maximum per photo. Storage uses free capacity first, then regenerating OSAT capacity. You'll see the actual cost before publishing.</p>
        <div className="photo-budget-options">{PHOTO_RATES.map(units => <Button key={units} onClick={() => {
          photoLimit.current = units * PHOTO_BLOCK_BYTES;
          setTool(undefined);
          photoInput.current?.click();
        }}><strong>Up to {units * PHOTO_BLOCK_BYTES / 1024} KiB</strong><small>{units} usage {units === 1 ? "unit" : "units"}</small></Button>)}</div>
      </AttachmentDialog>}
      {tool === "url" && <AttachmentDialog title="Add media by URL" onClose={() => { uploadController.current?.abort(); setTool(undefined); }}>
        <Field label="Media URL" hint="Use a public media file that allows your browser to read it.">
          {id => <input autoFocus id={id} type="url" value={mediaUrl} onChange={e => setMediaUrl(e.target.value)} onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); if (mediaUrl.trim()) void attach(); }
          }} placeholder="https://…" maxLength={LIMITS.maxLocationChars} disabled={attaching}/>}
        </Field>
        {urlError && <Notice kind="error">{urlError}</Notice>}
        <Button variant="primary" busy={attaching} disabled={!mediaUrl.trim()} onClick={() => void attach()}>Attach</Button>
      </AttachmentDialog>}
      {error && <Notice kind="error">{error}</Notice>}
      {!can.ok && <Notice kind="warning">{can.reason}</Notice>}
      <div className="row">
        <Button type="submit" variant="primary" busy={busy} disabled={attaching || capturing || needsClip || needsGroup || !ready || !can.ok || tooLong || ((galleryOnly || text.trim().length === 0) && !media.length)}>
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
        confirmLabel={busy ? "Saving…" : collectionId ? "Publish to group" : `Publish to ${audienceLabel(audience)}`}
        busy={busy}
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => void send()}
      >
        {confirm && (
          <>
            <p>
              <strong>Audience: {confirm.collectionId ? "Group" : audienceLabel(confirm.audience)}.</strong> {confirm.collectionId ? "Only current members of this group receive the reading key." : confirm.audience === AUDIENCE.CUSTOM ? "Only you and the selected accounts can read the current version. Previous recipients may keep earlier versions." : confirm.audience === AUDIENCE.FRIENDS ? friendsExplanation : everyoneExplanation}
            </p>
            {videoUploads > 0 && <p><strong>Video upload fee: {videoUploads * 100} {currency}.</strong> Confirming reserves the upload. A retry resumes the same file and payment.</p>}
            {voiceUnits > 0 && <p>Voice storage: {voiceUnits} usage {voiceUnits === 1 ? "unit" : "units"}.</p>}
            {photoUnits > 0 && <p>Photo storage: {photoUnits} usage {photoUnits === 1 ? "unit" : "units"}.</p>}
            <p>Publishing uses 1 usage unit.</p>
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
