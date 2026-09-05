import { describe, expect, it } from "vitest";
import { buildKeyPackageSet, encode, identityFromSeed, newEpochKey, toBase58, toBase64url } from "@osp/sdk";
import { fakeBlockReceipt, fakeProvider, fixtureDeployment } from "../testing/fixtures";
import type { SealedKeyView } from "./indexer";
import { verifySealedKeyProvenance } from "./keyProvenance";

const seed = (label: string) => new Uint8Array(32).map((_, i) => (label.charCodeAt(i % label.length) * 3 + i) & 0xff);
const author = identityFromSeed(seed("author"));
const friend = identityFromSeed(seed("friend"));
const other = identityFromSeed(seed("other"));
const deployment = fixtureDeployment();
const txId = "0x1220" + "11".repeat(32);
const blockId = "0x1220" + "22".repeat(32);
const ref = { author: author.account, audienceId: new Uint8Array(0), epoch: 3 };

function distribution(epochKey = newEpochKey(), authorAccount = author.account) {
  const { bytes, set } = buildKeyPackageSet({
    author: authorAccount,
    epoch: 3,
    epochKey,
    recipients: [
      { address: author.account, publicKey: author.encryption.publicKey, keyVersion: 1 },
      { address: friend.account, publicKey: friend.encryption.publicKey, keyVersion: 1 },
    ],
  });
  const sealed = set.keys.find((k) => toBase58(k.recipient) === friend.account)!;
  const item: SealedKeyView = { author: author.account, audienceId: "", epoch: 3, recipient: friend.account, recipientKeyVersion: 1, sealedKey: toBase64url(encode("osp.envelope.sealed_key", sealed as unknown as Record<string, unknown>)), blockHeight: "120", txId };
  const event = encode("publications.keys_distributed_event", { author: authorAccount, audience_id: new Uint8Array(0), epoch: 3, packages: bytes, timestamp: "1" });
  return { item, event };
}

function chain(events: Array<{ source: string; name: string; data: Uint8Array }>, options: { txOnChain?: boolean } = {}) {
  const provider = fakeProvider({
    transactions: options.txOnChain === false ? {} : { [txId]: { transaction: { id: txId }, containing_blocks: [blockId] } },
    blocks: { [blockId]: { block_id: blockId, block_height: "120", receipt: fakeBlockReceipt(txId, events) } },
  });
  return { provider, deployment };
}

describe("verifySealedKeyProvenance", () => {
  it("verifies a key whose distribute_keys event by the author contains it and names every recipient", async () => {
    const { item, event } = distribution();
    const result = await verifySealedKeyProvenance(chain([{ source: deployment.contracts.publications.address, name: "osp.publications.keys_distributed", data: event }]), item, ref);
    expect(result.status).toBe("verified");
    if (result.status === "verified") expect(result.recipients.sort()).toEqual([author.account, friend.account].sort());
  });

  it("rejects a key whose transaction is not on chain", async () => {
    const { item, event } = distribution();
    const result = await verifySealedKeyProvenance(chain([{ source: deployment.contracts.publications.address, name: "osp.publications.keys_distributed", data: event }], { txOnChain: false }), item, ref);
    expect(result.status).toBe("rejected");
  });

  it("rejects a key the transaction did not distribute, or that another contract or author emitted", async () => {
    const { item } = distribution();
    const { event: otherKey } = distribution(newEpochKey());
    const publications = deployment.contracts.publications.address;
    expect((await verifySealedKeyProvenance(chain([{ source: publications, name: "osp.publications.keys_distributed", data: otherKey }]), item, ref)).status).toBe("rejected");
    const { item: same, event } = distribution();
    expect((await verifySealedKeyProvenance(chain([{ source: deployment.contracts.identity.address, name: "osp.publications.keys_distributed", data: event }]), same, ref)).status).toBe("rejected");
    const { item: mine, event: byOther } = distribution(newEpochKey(), other.account);
    expect((await verifySealedKeyProvenance(chain([{ source: publications, name: "osp.publications.keys_distributed", data: byOther }]), mine, ref)).status).toBe("rejected");
    expect((await verifySealedKeyProvenance(chain([{ source: publications, name: "osp.publications.keys_distributed", data: event }]), same, { ...ref, epoch: 4 })).status).toBe("rejected");
    expect((await verifySealedKeyProvenance(chain([]), { ...same, txId: "" }, ref)).status).toBe("rejected");
  });

  it("reports the chain as unavailable instead of guessing", async () => {
    const { item } = distribution();
    const result = await verifySealedKeyProvenance({ provider: fakeProvider(), deployment }, item, ref);
    expect(result.status).toBe("unavailable");
  });
});
