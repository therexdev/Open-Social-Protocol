import { describe, expect, it } from "vitest";
import { buildKeyPackageSet, encode, identityFromSeed, newEpochKey, toBase64url, toHex, type ProtoObject } from "@osp/sdk";
import type { SealedKeyView } from "../shared/indexer";
import { KeyStore, type KeySource } from "./keystore";

const me = identityFromSeed(new Uint8Array(32).fill(3));
const ref = { author: me.account, audienceId: new Uint8Array(0), epoch: 2 };
const identity = { account: me.account, encryption: me.encryption };

function sealedFor(epochKey: Uint8Array): SealedKeyView[] {
  const { set } = buildKeyPackageSet({ author: me.account, epoch: ref.epoch, epochKey, recipients: [{ address: me.account, publicKey: me.encryption.publicKey, keyVersion: 1 }] });
  return set.keys.map((sealed) => ({ author: me.account, audienceId: "", epoch: ref.epoch, recipient: me.account, sealedKey: toBase64url(encode("osp.envelope.sealed_key", sealed as unknown as ProtoObject)), blockHeight: "1", txId: "0x" }));
}

describe("key store lookup", () => {
  it("distinguishes a missing key from an unreachable indexer, and bypasses the negative cache on demand", async () => {
    const store = new KeyStore();
    let calls = 0;
    const empty: KeySource = { keys: async () => (calls++, []) };
    const down: KeySource = {
      keys: async () => {
        throw new Error("The indexer at https://x is not reachable (fetch failed).");
      },
    };
    expect(await store.lookup(ref, identity, empty)).toEqual({ status: "missing" });
    expect(await store.lookup(ref, identity, empty)).toEqual({ status: "missing" }); // negative cache: no second request
    expect(calls).toBe(1);
    expect(await store.lookup(ref, identity, empty, { missCache: false })).toEqual({ status: "missing" });
    expect(calls).toBe(2);
    const unavailable = await store.lookup(ref, identity, down, { missCache: false });
    expect(unavailable.status).toBe("unavailable");
    expect(unavailable.status === "unavailable" && unavailable.error.message).toMatch(/not reachable/);
    expect(await store.resolve(ref, identity, down)).toBeUndefined(); // readers see "no key" either way
  });

  it("opens a sealed key served for me and caches it", async () => {
    const store = new KeyStore();
    const epochKey = newEpochKey();
    const items = sealedFor(epochKey);
    let calls = 0;
    const source: KeySource = { keys: async () => (calls++, items) };
    const found = await store.lookup(ref, identity, source);
    expect(found.status).toBe("found");
    expect(found.status === "found" && toHex(found.key)).toBe(toHex(epochKey));
    expect(await store.lookup(ref, identity, { keys: async () => [] })).toEqual({ status: "found", key: epochKey });
    expect(calls).toBe(1);
  });
});
