import { expect, it } from "vitest";
import type { PostView } from "../../api/indexer";
import type { DraftRecord } from "../../vault/store";
import { indexedDraft } from "./drafts";

it("keeps an unsent edit visible when another device wins the same revision", () => {
  const draft = { state: "failed", edit: { versionNumber: 2 }, publication: { postId: "p", contentHash: "ours" } } as DraftRecord;
  const other = { postId: "p", versionNumber: 2, contentHash: "theirs", versions: [{ versionNumber: 2, contentHash: "theirs" }] } as PostView;
  expect(indexedDraft(draft, [other])).toBe(false);
  const newer = { ...other, versionNumber: 3, versions: [{ ...other.versions[0]!, contentHash: "ours" }] };
  expect(indexedDraft(draft, [newer])).toBe(true);
});
