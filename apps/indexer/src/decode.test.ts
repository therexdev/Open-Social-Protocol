import { describe, expect, it } from "vitest";
import { AUDIENCE, COMMUNITY_ROLE, OUTCOME, Signer, encode, toBase64url } from "@osp/sdk";
import { decodeEventDataFixed, decodeProtocolEvent } from "./decode.js";
import { testDeployment } from "./testing/fake-chain.js";

const deployment = testDeployment();
const author = Signer.fromSeed("decode-test").getAddress();

describe("enum default workaround", () => {
  it("decodes absent (zero) enum fields as 0 and present ones as sent", () => {
    const base = { author, post_id: new Uint8Array(32).fill(1), content_hash: new Uint8Array(32).fill(2), version_number: 1, sequence: "1", envelope: new Uint8Array([1]), timestamp: "5" };
    for (const audience of [AUDIENCE.EVERYONE, AUDIENCE.FRIENDS, AUDIENCE.CUSTOM]) {
      const raw = toBase64url(encode("publications.published_event", { ...base, audience }));
      expect(decodeEventDataFixed("osp.publications.published", raw)?.audience).toBe(audience);
      const decoded = decodeProtocolEvent(deployment.contracts.publications.address, "osp.publications.published", raw, deployment, {
        txId: "0x1",
        blockHeight: "1",
        blockId: "0x2",
        impacted: [author],
        sequence: 0,
      });
      expect(decoded?.data.audience).toBe(audience);
      expect(decoded?.data.timestamp).toBe("5");
    }
    const role = toBase64url(encode("communities.role_set_event", { community_id: new Uint8Array(4), actor: author, subject: author, role: COMMUNITY_ROLE.NONE, timestamp: "1" }));
    expect(decodeEventDataFixed("osp.communities.role_set", role)?.role).toBe(0);
    const outcome = toBase64url(encode("publications.cross_post_outcome_event", { author, idempotency_key: new Uint8Array(16), adapter: "x", state: OUTCOME.SUCCEEDED, timestamp: "1" }));
    expect(decodeEventDataFixed("osp.publications.cross_post_outcome", outcome)?.state).toBe(0);
    const failed = toBase64url(encode("publications.cross_post_outcome_event", { author, idempotency_key: new Uint8Array(16), adapter: "x", state: OUTCOME.FAILED, timestamp: "1" }));
    expect(decodeEventDataFixed("osp.publications.cross_post_outcome", failed)?.state).toBe(OUTCOME.FAILED);
  });

  it("rejects unknown names and foreign sources", () => {
    expect(decodeEventDataFixed("koinos.contracts.token.transfer_event", "")).toBeUndefined();
    const raw = toBase64url(encode("identity.registered_event", { account: author, encryption_key: new Uint8Array(32), key_version: 1, timestamp: "1" }));
    expect(decodeProtocolEvent(deployment.contracts.publications.address, "osp.identity.registered", raw, deployment, { txId: "", blockHeight: "1", blockId: "", impacted: [], sequence: 0 })).toBeUndefined();
    expect(decodeProtocolEvent(deployment.contracts.identity.address, "osp.identity.registered", raw, deployment, { txId: "", blockHeight: "1", blockId: "", impacted: [], sequence: 0 })?.data.account).toBe(author);
  });
});
