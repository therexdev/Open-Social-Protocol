import { useEffect, useRef, useState } from "react";
import { fromBase64url } from "@osp/sdk";
import type { EmbeddedMedia } from "../shared/protocol";
import { rpc } from "../shared/rpc";

export function Avatar({ name, postId, targetId, hash }: { name: string; postId: string; targetId: string; hash?: string }) {
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [photo, setPhoto] = useState<{ hash: string; url: string }>();
  const [failed, setFailed] = useState<string>();
  useEffect(() => {
    if (!host.current || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "150px" });
    observer.observe(host.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!hash || !visible) return;
    let alive = true, objectUrl = "";
    setPhoto(undefined); setFailed(undefined);
    void rpc<EmbeddedMedia>("embed.avatar", { postId, targetId, hash }).then(result => {
      if (!alive) return;
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(fromBase64url(result.data))], { type: result.mime }));
      setPhoto({ hash, url: objectUrl });
    }).catch(() => { /* Keep initials while the profile/archive is unavailable. */ });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [postId, targetId, hash, visible]);
  const url = photo?.hash === hash && failed !== photo?.url ? photo?.url : undefined;
  return <span ref={host} className="card-avatar-content">
    {url ? <img src={url} alt="" decoding="async" onError={() => setFailed(url)}/> : name.split(/\s+/).slice(0, 2).map(word => [...word][0]).join("").toUpperCase()}
  </span>;
}
