import { describe, it, expect } from "vitest";
import { ProtocolClient, identityFromSeed, encryptDirectMessage, toBase64url, encode } from "@osp/sdk";
import { fakeProvider, fixtureDeployment } from "../../testing/fixtures";
import { openVerifiedMessage } from "./verified";
const alice = identityFromSeed(new Uint8Array(32).fill(1)),
  bob = identityFromSeed(new Uint8Array(32).fill(2));
const deployment = fixtureDeployment(),
  id = new Uint8Array(32).fill(3);
const context = {
  chainId: deployment.chainId,
  contract: deployment.contracts.messaging.address,
  sender: alice.account,
  recipient: bob.account,
  messageId: id,
  generation: "1",
};
const e = encryptDirectMessage(
  context,
  "Only show verified text",
  [alice, bob].map((x) => ({ address: x.account, publicKey: x.encryption.publicKey, keyVersion: x.keyVersion }))
);
const record = {
  sender: alice.account,
  recipient: bob.account,
  message_id: id,
  content_hash: e.contentHash,
  generation: "1",
  sequence: "1",
  timestamp: "1800000000000",
};
const row = {
  ...record,
  message_id: toBase64url(id),
  content_hash: toBase64url(e.contentHash),
  envelope: toBase64url(e.envelope),
  txId: "fake",
};
describe("message verification", () => {
  it("uses the on-chain record and ignores forged indexer metadata", async () => {
    const client = new ProtocolClient({
      deployment,
      rpc: fakeProvider({ onRead: () => encode("messaging.get_message_result", { value: record }) }),
    });
    const result = await openVerifiedMessage(client, bob, alice.account, {
      ...row,
      generation: "900",
      sequence: "999",
      timestamp: "9",
      content_hash: "fake",
    });
    expect(result.text).toBe("Only show verified text");
    expect(result.sequence).toBe("1");
    expect(result.timestamp).toBe(record.timestamp);
  });
  it("fails closed when the commitment is missing or belongs to someone else", async () => {
    const missing = new ProtocolClient({ deployment, rpc: fakeProvider() });
    await expect(openVerifiedMessage(missing, bob, alice.account, row)).rejects.toThrow(/verified/);
    const mismatched = new ProtocolClient({
      deployment,
      rpc: fakeProvider({ onRead: () => encode("messaging.get_message_result", { value: { ...record, recipient: alice.account } }) }),
    });
    await expect(openVerifiedMessage(mismatched, bob, alice.account, row)).rejects.toThrow(/verified/);
  });
});
