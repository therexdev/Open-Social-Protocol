import { describe, expect, it } from "vitest";
import { AUDIENCE, EnvelopeError, LIMITS, encryptContent, newEpochKey } from "@osp/sdk";
import { draftContent, draftEnvelopeBytes, draftSizeError, measureDraft } from "./draft";

const AAD = { chainId: "EiBncD4pKRIQWco_WRqo5Q-xnXR7JuO3PtZv983mKdKHSQ==", author: "1BKgyD7pZFSyNzupBRvvTYMLJCUuC1QLs3", audience: AUDIENCE.FRIENDS, epoch: 3, versionNumber: 1 as const };

describe("draft size (envelope bytes, not characters)", () => {
  it("measures exactly the suite-1 envelope the post would produce", () => {
    for (const [text, ref] of [
      ["hello", undefined],
      ["漢".repeat(500), undefined],
      ["a".repeat(2000), "https://example.org/" + "x".repeat(300)],
      ["🙂".repeat(300), "https://example.org/a"],
    ] as const) {
      const real = encryptContent({ content: draftContent(text, ref, "1700000000000"), aad: AAD, epochKey: newEpochKey() }).bytes.length;
      expect(draftEnvelopeBytes(text, ref)).toBe(real);
    }
  });

  it("rejects what encryptContent would reject and accepts what it accepts", () => {
    const cjk = "漢".repeat(3000);
    expect(measureDraft(cjk).ok).toBe(false);
    expect(draftSizeError(cjk)).toMatch(/bytes once encoded/);
    expect(() => encryptContent({ content: draftContent(cjk, undefined, "1700000000000") })).toThrow(EnvelopeError);
    const emoji = "🙂".repeat(3000);
    expect(draftSizeError(emoji)).toMatch(new RegExp(`above the ${LIMITS.maxEnvelopeBytes}-byte limit`));
    const withLink = "a".repeat(3000);
    expect(draftSizeError(withLink)).toBeUndefined();
    expect(draftSizeError(withLink, "https://example.org/" + "y".repeat(1200))).toMatch(/drop the shared link/);
    // the plaintext suite is never larger than the measured suite-1 envelope
    expect(encryptContent({ content: draftContent(withLink, undefined, "1700000000000") }).bytes.length).toBeLessThanOrEqual(draftEnvelopeBytes(withLink));
  });
});
