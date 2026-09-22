import { describe, it, expect } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { identityFromSeed } from "../vault.js";
import { deriveEncryptionSecret } from "./keys.js";
import { encryptDirectMessage, decryptDirectMessage } from "./messaging.js";
const alice = identityFromSeed(new Uint8Array(32).fill(1)),
  bob = identityFromSeed(new Uint8Array(32).fill(2)),
  carol = identityFromSeed(new Uint8Array(32).fill(3));
const context = {
  chainId: "test-chain",
  contract: carol.account,
  sender: alice.account,
  recipient: bob.account,
  messageId: new Uint8Array(32).fill(7),
  generation: "1",
};
const people = [alice, bob].map((x) => ({ address: x.account, publicKey: x.encryption.publicKey, keyVersion: x.keyVersion }));
describe("direct message confidentiality and binding", () => {
  it("only the two participants can open the committed ciphertext", () => {
    const e = encryptDirectMessage(context, "Private hello", people);
    for (const p of [alice, bob])
      expect(decryptDirectMessage(context, e.envelope, e.contentHash, p.account, (v) => deriveEncryptionSecret(p.seed, v))).toBe(
        "Private hello"
      );
    expect(new TextDecoder().decode(e.envelope)).not.toContain("Private hello");
    expect(() =>
      decryptDirectMessage(context, e.envelope, e.contentHash, carol.account, (v) => deriveEncryptionSecret(carol.seed, v))
    ).toThrow();
  });
  it("rejects tampered bytes, false chain commitments and relayed contexts", () => {
    const e = encryptDirectMessage(context, "Private hello", people),
      bad = e.envelope.slice();
    bad[bad.length - 1] ^= 1;
    const secret = (v: number) => deriveEncryptionSecret(bob.seed, v);
    expect(() => decryptDirectMessage(context, bad, e.contentHash, bob.account, secret)).toThrow(/commitment/);
    expect(() => decryptDirectMessage(context, e.envelope, new Uint8Array(32), bob.account, secret)).toThrow(/commitment/);
    for (const c of [
      { ...context, chainId: "another" },
      { ...context, contract: alice.account },
      { ...context, generation: "2" },
      { ...context, sender: bob.account, recipient: alice.account },
    ])
      expect(() => decryptDirectMessage(c, e.envelope, sha256(e.envelope), bob.account, secret)).toThrow();
  });
  it("does not accept missing recipient keys or oversized multibyte messages", () => {
    expect(() => encryptDirectMessage(context, "hello", people.slice(0, 1))).toThrow();
    expect(() => encryptDirectMessage(context, "🦉".repeat(626), people)).toThrow();
  });
});
