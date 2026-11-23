import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { createPortal } from "react-dom";

/** The viewer shares its owner's URL and lifetime; it never fetches or retains a copy. */
export function ZoomableImage({ src, alt = "Photo", ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [expanded, setExpanded] = useState<string>();
  useEffect(() => setExpanded(undefined), [src]);
  return <>
    <button type="button" className="image-zoom-trigger" aria-label={`View full image: ${alt || "Photo"}`}
      onClick={event => { event.preventDefault(); event.stopPropagation(); setExpanded(src); }}>
      <img {...props} src={src} alt={alt}/>
    </button>
    {src && expanded === src && <ImageDialog src={src} alt={alt} onClose={() => setExpanded(undefined)}/>}
  </>;
}

function ImageDialog({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(<dialog ref={ref} className="image-lightbox" aria-label="Full image viewer"
    onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose}
    onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); onClose(); } }}
    onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
    <div className="image-lightbox-frame">
      <button type="button" className="image-lightbox-close" aria-label="Close image viewer" onClick={onClose}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>
      </button>
      <img src={src} alt={alt || "Full image"} decoding="async"/>
    </div>
  </dialog>, document.body);
}
