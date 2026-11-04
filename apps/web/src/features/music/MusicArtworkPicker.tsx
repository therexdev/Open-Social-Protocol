import { useEffect, useRef, useState } from "react";
import { photoCost } from "@osp/sdk";
import { Button, Field, Notice } from "../../components/ui";
import { Icon } from "../../components/Icon";
import { preparePhoto } from "../composer/preparePhoto";

export function MusicArtworkPicker({ value, onChange, disabled = false, privateArt = false, onBusyChange }: {
  value?: Uint8Array; onChange: (bytes?: Uint8Array) => void; disabled?: boolean; privateArt?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const [preview, setPreview] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const selection = useRef(0), input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!value) { setPreview(""); return; } const url = URL.createObjectURL(new Blob([value.slice()], { type: "image/jpeg" })); setPreview(url); return () => URL.revokeObjectURL(url); }, [value]);
  useEffect(() => () => { selection.current++; }, []);
  const choose = async (file?: File) => {
    const ticket = ++selection.current; if (!file) return;
    setBusy(true); onBusyChange?.(true); setError("");
    try { const bytes = await preparePhoto(file, undefined, 128 * 1024 - 16); if (ticket === selection.current) onChange(bytes); }
    catch (e) { if (ticket === selection.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (ticket === selection.current) { setBusy(false); onBusyChange?.(false); } }
  };
  return <div className="music-artwork-picker">
    <Field label="Album art or track image" hint="Optional · stored on-chain with your track. Your audio file stays unchanged.">{id => <input ref={input} id={id} type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || busy} onChange={e => void choose(e.target.files?.[0])}/>}</Field>
    {preview && <div className="music-artwork-preview"><img src={preview} alt="Selected track artwork"/><div><strong>Artwork ready</strong><p className="hint">{Math.ceil(value!.length / 1024)} KiB · {photoCost(value!.length + (privateArt ? 16 : 0))} photo usage units{privateArt ? " · encrypted for this audience" : " · public preview"}</p><Button disabled={disabled || busy} variant="ghost" onClick={() => { onChange(undefined); if (input.current) input.current.value = ""; }}><Icon name="close" size={16}/>Remove image</Button></div></div>}
    {busy && <p role="status" className="hint">Preparing artwork…</p>}
    {error && <Notice kind="error">{error}</Notice>}
  </div>;
}
