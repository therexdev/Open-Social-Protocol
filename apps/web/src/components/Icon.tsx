import type { CSSProperties } from "react";

const paths = {
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
  people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  message: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H3l1.8-4A8.5 8.5 0 1 1 21 11.5ZM8 10h8m-8 4h5",
  profile: "M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  settings: "m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 2 3h3l1-3 3-1 2-3-2-2 1-3-2-3-3 1-2-3zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  token: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0M12 6v12m3-9h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9",
  info: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 11v6m0-10h.01",
  plus: "M12 5v14M5 12h14",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  lock: "M5 10h14v11H5zm3 0V6a4 4 0 0 1 8 0v4m-4 5v2",
  globe: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M2 12h20M12 2a19 19 0 0 1 0 20 19 19 0 0 1 0-20",
  heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  refresh: "M20 7v5h-5M4 17v-5h5m10.2-5A8 8 0 0 0 5 6m-.2 11A8 8 0 0 0 19 18",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  close: "m6 6 12 12M6 18 18 6",
  more: "M4 12h.01M12 12h.01M20 12h.01",
  shield: "m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6zm-5 10 3 3 7-7",
  layers: "m12 2 10 5-10 5L2 7zm-10 10 10 5 10-5M2 17l10 5 10-5",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
  edit: "m16 3 5 5-12 12-6 1 1-6zM14 5l5 5",
  check: "m5 12 4 4L19 6",
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  return <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
export function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M23 9a10 10 0 1 0 0 14" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/><path d="M16 11v10m-5-5h10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg></span>;
}
export function Avatar({ account, name, large = false }: { account: string; name?: string; large?: boolean }) {
  const hue = [...account].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 0);
  const initials = (name && !name.includes("…") ? name.trim().split(/\s+/).slice(0, 2).map(x => [...x][0]).join("") : account.slice(0, 2)).toUpperCase();
  return <span className={`avatar${large ? " avatar-large" : ""}`} style={{ "--avatar-hue": hue } as CSSProperties} aria-hidden="true">{initials || <Icon name="profile" />}</span>;
}
