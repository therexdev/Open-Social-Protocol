import { useEffect, useRef, useState } from "react";
import { contentHash, photoCost, PHOTO_MAX_BYTES, photoLocation, profilePhotoId, toBase64url } from "@osp/sdk";
import { buildProfileDocument, parseProfileUri, PROFILE_URI_MAX_CHARS } from "../../api/profiles";
import type { ProfileView } from "../../api/indexer";
import { rememberMediaBytes } from "../../api/mediaCache";
import { Button, Field, Notice } from "../../components/ui";
import { useProfiles } from "../../stores/profiles";
import { submitAction } from "../../tx/submit";
import { useVaultStore } from "../../vault/context";
import { preparePhoto } from "../composer/preparePhoto";
import { archivePhoto } from "../composer/archivePhoto";
import { useSubmitContext } from "../session";

type Slot = "avatar" | "banner";
type SelectedPhoto = { bytes: Uint8Array; digest: Uint8Array };

function Preview({ bytes, label }: { bytes: Uint8Array; label: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes]);
  return url ? <img className="profile-editor-preview" src={url} alt={label}/> : null;
}

export function ProfileEditor({ account, view, onDone }: { account: string; view: ProfileView; onDone: () => void }) {
  const ctx = useSubmitContext(), vault = useVaultStore();
  // Snapshot the profile once. A background indexer refresh must not replace the
  // form's base document while an edit is in progress.
  const [original] = useState(view);
  const [base] = useState(() => parseProfileUri(original.profileUri));
  const [name, setName] = useState(base?.display_name ?? ""), [bio, setBio] = useState(base?.bio ?? "");
  const [photos, setPhotos] = useState<Partial<Record<Slot, SelectedPhoto>>>({});
  const [preparing, setPreparing] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const active = useRef(true), busy = useRef(false);
  const prepareController = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; prepareController.current?.abort(); };
  }, []);
  const document = buildProfileDocument({
    ...base, display_name: name.trim(), bio: bio.trim(),
    ...(photos.avatar && { avatar: undefined, avatar_photo_hash: photos.avatar.digest }),
    ...(photos.banner && { banner_photo_hash: photos.banner.digest }),
  });
  const remaining = PROFILE_URI_MAX_CHARS - document.uri.length;
  const choose = async (slot: Slot, file?: File) => {
    if (!file || busy.current) return;
    const controller = new AbortController(); prepareController.current = controller;
    setPreparing(true); setError(""); busy.current = true;
    try {
      const bytes = await preparePhoto(file, controller.signal, slot === "avatar" ? 128 * 1024 : PHOTO_MAX_BYTES);
      if (active.current) setPhotos(previous => ({ ...previous, [slot]: { bytes, digest: contentHash(bytes) } }));
    } catch (e) {
      if (active.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
      if (active.current) setPreparing(false);
    }
  };

  const save = async () => {
    if (!ctx || busy.current || remaining < 0) return;
    const session = vault.getState().session;
    if (!session || session.identity.account !== account) return;
    const assertActive = () => {
      if (!active.current || vault.getState().session !== session) throw Error("Unlock this account and reopen its profile to continue.");
    };
    const checkProfile = async () => {
      assertActive();
      const current = (await ctx.client.reads.identity.get_identity({ account }))?.value;
      if (!current || current.profile_uri !== original.profileUri) throw Error("Your profile changed. Reload it before saving this edit.");
      assertActive();
    };

    setSaving(true); setError(""); busy.current = true;
    try {
      await checkProfile();
      for (const photo of Object.values(photos)) {
        if (!photo) continue;
        const url = photoLocation(ctx.client.deployment.contracts.publications.address, profilePhotoId(account, photo.digest));
        await archivePhoto({ url, mime: "image/jpeg", size: photo.bytes.length, contentHash: photo.digest, archiveBytes: toBase64url(photo.bytes) }, ctx, account, assertActive);
        rememberMediaBytes(url, toBase64url(photo.digest), photo.bytes);
      }
      const op = await ctx.client.ops.identity.update_profile({ account, profile_hash: document.hash, profile_uri: document.uri });
      await submitAction(ctx, [op], { label: "Saving your profile", success: "Profile saved", beforeSubmit: checkProfile });
      useProfiles.getState().set(account, { ...original, profileHash: toBase64url(document.hash), profileUri: document.uri });
      if (active.current) onDone();
    } catch (e) {
      if (active.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
      if (active.current) setSaving(false);
    }
  };

  return <form onSubmit={event => { event.preventDefault(); void save(); }}>
    <Field label="Display name">{id => <input id={id} value={name} onChange={e => setName(e.target.value)} maxLength={64} disabled={saving}/>}</Field>
    <Field label="About you">{id => <textarea id={id} value={bio} onChange={e => setBio(e.target.value)} rows={3} maxLength={300} spellCheck disabled={saving}/>}</Field>
    <div className="profile-editor-photos">{(["avatar", "banner"] as const).map(slot => {
      const label = slot === "avatar" ? "Profile picture" : "Profile banner", selected = photos[slot];
      return <div key={slot}>
        <Field label={label}>{id => <input id={id} type="file" accept="image/*" disabled={preparing || saving} onChange={e => {
          const file = e.target.files?.[0]; e.target.value = ""; void choose(slot, file);
        }}/>}</Field>
        {selected && <><Preview bytes={selected.bytes} label={label}/><p className="hint">{photoCost(selected.bytes.length)} photo usage units · {Math.ceil(selected.bytes.length / 1024)} KiB</p>
          <Button variant="ghost" disabled={saving} onClick={() => setPhotos(previous => ({ ...previous, [slot]: undefined }))}>Discard selection</Button></>}
      </div>;
    })}</div>
    <p className="hint">{preparing ? "Preparing image…" : "Profile images are public. Saving uses the same free and regenerating OSAT capacity as other photos."}</p>
    {remaining < 0 && <Notice kind="warning">Shorten your bio or display name to fit the on-chain profile. The reference exceeds the limit by {-remaining} characters.</Notice>}
    {error && <Notice kind="error">{error}</Notice>}
    <div className="row"><Button type="submit" variant="primary" busy={saving} disabled={preparing || remaining < 0 || !ctx}>Save profile</Button>
      <Button variant="ghost" onClick={onDone} disabled={saving}>Cancel</Button></div>
  </form>;
}
