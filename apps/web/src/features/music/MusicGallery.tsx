import { useState } from "react";
import type { MusicRecord } from "@osp/sdk";
import { Icon } from "../../components/Icon";
import { MusicTrack } from "./MusicTrack";
export const MUSIC_VIEW_KEY = "osp.music.view";
export function MusicGallery({ items }: { items: Array<{ id: string; record: MusicRecord }> }) {
  const [view, setView] = useState<"tiles" | "list">(() => {
    try { return localStorage.getItem(MUSIC_VIEW_KEY) === "list" ? "list" : "tiles"; } catch { return "tiles"; }
  });
  return <div className="music-gallery">
    <div className="music-gallery-toolbar"><span className="hint">{items.length} {items.length === 1 ? "track" : "tracks"}</span>
      <div className="music-view-switch" role="group" aria-label="Music view">
        {(["tiles", "list"] as const).map(mode => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => {
          setView(mode); try { localStorage.setItem(MUSIC_VIEW_KEY, mode); } catch { /* session choice still works */ }
        }}><Icon name={mode === "tiles" ? "grid" : "list"} size={17}/>{mode === "tiles" ? "Tiles" : "List"}</button>)}
      </div>
    </div>
    <div className={`music-gallery-items music-view-${view}`}>{items.map(track => <MusicTrack key={track.id} {...track}/>)}</div>
  </div>;
}
