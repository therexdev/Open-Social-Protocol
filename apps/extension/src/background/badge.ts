import type { StoredCrossPost } from "../shared/protocol";
import { needsAttention } from "../shared/queue";

/** Shows how many cross-post records need the user's attention. */
export async function updateBadge(records: StoredCrossPost[], api: Pick<typeof chrome, "action"> = chrome, now = Date.now()): Promise<number> {
  const count = records.filter((r) => needsAttention(r, now)).length;
  try {
    await api.action.setBadgeText({ text: count > 0 ? String(count) : "" });
    if (count > 0) await api.action.setBadgeBackgroundColor({ color: "#3b5bdb" });
  } catch {
    // badge is cosmetic
  }
  return count;
}
