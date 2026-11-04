import { toBase64url } from "@osp/sdk";
import type { IndexerDb } from "./db.js";
import { toJsonValue } from "./hash.js";
import { logEventFromRow, type LogEvent, type EventLogRow } from "./projections.js";

export function applyMusicEvent(db: IndexerDb, event: LogEvent): void {
  const data = event.data, id = data.id instanceof Uint8Array ? toBase64url(data.id) : "";
  if (!id) return;
  if (event.name === "osp.publications.music_paid") {
    const value = data.value as Record<string, unknown>;
    if (!value || !(value.digest instanceof Uint8Array)) return;
    db.run(`INSERT INTO music_tracks VALUES (?,?,?,?,0,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
      id, String(value.owner), Number(value.audience ?? 0), value.group_id instanceof Uint8Array ? toBase64url(value.group_id) : "",
      toBase64url(value.digest), JSON.stringify(toJsonValue(value)), event.blockTimestamp, event.height, event.txIndex, event.sequence, event.txId);
  } else if (event.name === "osp.publications.music_completed") {
    db.run(`UPDATE music_tracks SET complete=1,created_at=?,block_height=?,tx_index=?,event_sequence=?,tx_id=? WHERE id=? AND owner=? AND complete=0`,
      event.blockTimestamp, event.height, event.txIndex, event.sequence, event.txId, id, String(data.owner));
  } else if (event.name === "osp.publications.music_cover_updated") {
    const row = db.get<{ data_json: string }>("SELECT data_json FROM music_tracks WHERE id=? AND owner=?", id, String(data.owner));
    if (!row) return;
    const value = JSON.parse(row.data_json);
    if (Number(data.revision) <= Number(value.cover_revision ?? 0)) return;
    value.cover = toJsonValue(data.cover); value.cover_revision = Number(data.revision);
    db.run("UPDATE music_tracks SET data_json=? WHERE id=?", JSON.stringify(value), id);
  }
}

/** Populate only the new projection from retained events; no RPC replay or reset. */
export function backfillMusic(db: IndexerDb): void {
  if (db.getMeta("projection.music.backfill.v1") === "1") return;
  db.transaction(() => {
    let cursor = [-1, -1, -1];
    for (;;) {
      const rows = db.all<EventLogRow>(`SELECT * FROM event_log WHERE contract='publications' AND name IN
        ('osp.publications.music_paid','osp.publications.music_completed','osp.publications.music_cover_updated')
        AND (height,tx_index,sequence)>(?,?,?) ORDER BY height,tx_index,sequence LIMIT 200`, ...cursor);
      if (!rows.length) break;
      for (const row of rows) { const event = logEventFromRow(row); if (event) applyMusicEvent(db, event); }
      const last = rows[rows.length - 1]!; cursor = [last.height, last.tx_index, last.sequence];
    }
    db.setMeta("projection.music.backfill.v1", "1");
  });
}
