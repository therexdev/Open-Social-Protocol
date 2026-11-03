import { useOptionalServices } from "../api/services";
import { useEffect, useRef, useState } from "react";
import { parsePhotoLocation, verifyPhotoChunks, toBase64url, IMAGE_MIMES, fetchIpfsMedia, openMedia, fromBase64url } from "@osp/sdk";
import { useSettings } from "../stores/settings";
import { useVault } from "../vault/context";
import { Button } from "./ui";
import { cachedMediaBytes, rememberMediaBytes } from "../api/mediaCache";

export interface MediaPhotoProps { location: string; hash: string; mime: string; alt?: string; encryption?: { key: string; nonce: string } }
/** Only verified raster bytes become a blob URL. Private URLs are revoked on lock/unmount. */
export function MediaPhoto({ location, hash, mime, alt = "Attached photo", encryption }: MediaPhotoProps) {
  const services = useOptionalServices();
  const gateways = useSettings(s => s.ipfsGateways);
  const session = useVault(s => s.session);
  const host = useRef<HTMLDivElement>(null);
  const [visible,setVisible] = useState(false), [retry,setRetry] = useState(0);
  const [loaded,setLoaded] = useState<{ id: string; url?: string; error?: string }>();
  const id = JSON.stringify([location,hash,mime,encryption]);
  const gatewayKey = JSON.stringify(gateways);
  useEffect(() => {
    if (!host.current || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } },{ rootMargin: "300px" });
    observer.observe(host.current); return () => observer.disconnect();
  },[]);
  useEffect(() => {
    if (!visible || (encryption && !session)) return;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    setLoaded(undefined);
    void (async () => {
      try {
        if (!(IMAGE_MIMES as readonly string[]).includes(mime)) throw new Error("Unsupported photo format");
        let bytes = cachedMediaBytes(location, hash);
        if (!bytes && location.startsWith("osp-photo://")) {
          if (!services?.protocol) throw new Error("Connect to the photo archive to load this photo.");
          const id = parsePhotoLocation(location,services.protocol.deployment.contracts.publications.address);
          const record = (await services.protocol.reads.publications.get_photo({id}))?.value;
          if (!record) throw new Error("This photo is still confirming on the archive.");
          const response = await services.indexer.photoChunks(toBase64url(id));
          bytes = verifyPhotoChunks(record,response.chunks.map(fromBase64url),fromBase64url(hash));
        }
        bytes ??= await fetchIpfsMedia(location,fromBase64url(hash),{ gateways, signal: controller.signal });
        if (controller.signal.aborted) return;
        rememberMediaBytes(location, hash, bytes);
        const plain = openMedia(bytes,fromBase64url(hash),encryption ? { key: fromBase64url(encryption.key), nonce: fromBase64url(encryption.nonce) } : undefined);
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(plain)],{ type: mime }));
        setLoaded({ id,url: objectUrl });
      } catch (error) { if (!controller.signal.aborted) setLoaded({ id,error: error instanceof Error ? error.message : "Photo unavailable" }); }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  },[id,gatewayKey,visible,retry,services,encryption ? session : undefined]);
  const result = loaded?.id === id ? loaded : undefined;
  return <div className="ipfs-photo" ref={host}>
    {encryption && !session ? <p>Unlock to view this photo.</p> : result?.url ? <img src={result.url} alt={alt} decoding="async" onError={() => setLoaded({ id,error: "This photo could not be displayed." })}/> : result?.error ? <div className="photo-placeholder"><p>{result.error}</p><Button variant="ghost" onClick={() => setRetry(n => n + 1)}>Retry photo</Button></div> : <div className="photo-placeholder" role="status">Loading photo…</div>}
  </div>;
}
