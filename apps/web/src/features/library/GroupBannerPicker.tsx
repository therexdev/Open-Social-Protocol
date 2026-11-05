import { useEffect, useRef, useState } from "react";
import { PHOTO_MAX_BYTES, photoCost, toBase64url } from "@osp/sdk";
import { useServices } from "../../api/services";
import { MediaPhoto } from "../../components/MediaPhoto";
import { Button, Field, Notice } from "../../components/ui";
import { prepareArchivedPhoto } from "../composer/archivePhoto";
import { PhotoReadError, preparePhoto } from "../composer/preparePhoto";
import type { MediaAttachment } from "../composer/publish";

export function GroupBanner({ banner }: { banner: MediaAttachment }) {
  return <div className="group-banner">
    <MediaPhoto location={banner.url} hash={toBase64url(banner.contentHash)}
      mime={banner.mime} encryption={banner.encryption} alt="Group banner"/>
  </div>;
}

export function GroupBannerPicker({ current, value, onChange, disabled, onBusyChange }: {
  current?: MediaAttachment;
  value?: MediaAttachment | null;
  onChange: (value: MediaAttachment | null | undefined) => void;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const { protocol } = useServices();
  const [preparing, setPreparing] = useState(false), [error, setError] = useState(""), [readFailed, setReadFailed] = useState(false);
  const alive = useRef(true), busy = useRef(false), controller = useRef<AbortController | undefined>(undefined);
  const files = useRef<HTMLInputElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controller.current?.abort(); };
  }, []);
  const choose = async (file?: File) => {
    if (!file || !protocol || disabled || busy.current) return;
    busy.current = true; controller.current = new AbortController();
    setPreparing(true); onBusyChange(true); setError(""); setReadFailed(false);
    try {
      const bytes = await preparePhoto(file, controller.current.signal, PHOTO_MAX_BYTES - 16);
      if (alive.current) onChange(prepareArchivedPhoto(bytes, protocol, true));
    } catch (e) {
      if (alive.current) { setError(e instanceof Error ? e.message : String(e)); setReadFailed(e instanceof PhotoReadError); }
    } finally {
      busy.current = false;
      if (alive.current) { setPreparing(false); onBusyChange(false); }
    }
  };
  const selected = value === undefined ? current : value;
  const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    // Keep Android's provider handle alive until the file bytes have been read.
    void choose(input.files?.[0]).finally(() => { input.value = ""; });
  };
  return <div className="group-banner-picker">
    <Field label="Group banner">{id => <input id={id} type="file" accept="image/*" disabled={disabled || preparing || !protocol} onChange={pick}/>}</Field>
    {selected && <GroupBanner banner={selected}/>}
    {value && <p className="hint">{photoCost(value.size)} photo usage units · {Math.ceil(value.size / 1024)} KiB</p>}
    <div className="row wrap">
      {selected && <Button variant="ghost" disabled={disabled || preparing} onClick={() => onChange(null)}>Remove banner</Button>}
      {value !== undefined && <Button variant="ghost" disabled={disabled || preparing} onClick={() => onChange(undefined)}>Undo banner change</Button>}
    </div>
    <p className="hint">{preparing ? "Preparing banner…" : "Only group members can view this banner. Uploading uses the same free and regenerating OSAT capacity as other photos."}</p>
    <input ref={files} className="visually-hidden" type="file" aria-label="Choose group banner from files" disabled={disabled || preparing} onChange={pick}/>
    {error && <Notice kind="error">{error}{readFailed && <div className="row"><Button disabled={disabled || preparing} onClick={() => files.current?.click()}>Choose from files</Button></div>}</Notice>}
  </div>;
}
