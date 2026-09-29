import { describe, expect, it } from "vitest";
import { randomBytes, x25519KeyPair } from "./keys.js";
import { fromBase64url, toBase64url, utf8 } from "../encoding.js";
import {
  acceptRatchet,
  createRatchetSetup,
  decryptPrivateMessage,
  encryptPrivateMessage,
  finishRatchet,
  openPrivateInvitation,
  privateWallet,
  sealPrivateInvitation,
  signPrivateStatement,
  verifyPrivateStatement,
} from "./privateMessaging.js";
const scope = { chainId: "testnet", contract: "messaging" };
const context = (actor = "alice", peer = "bob") => ({
  ...scope,
  actor,
  peer,
  packetId: toBase64url(randomBytes(32)),
});
async function pair() {
  const aKey = randomBytes(32),
    bKey = randomBytes(32),
    setup = await createRatchetSetup(aKey);
  const accepted = await acceptRatchet(bKey, setup, { accepted: true });
  const finished = await finishRatchet(
    aKey,
    setup.account,
    accepted.identityKey,
    accepted.wire,
  );
  return { aKey, bKey, a: finished.state, b: accepted.state };
}
describe("private messaging v2", () => {
  it("derives separate signing aliases, domains and purposes without using them as message keys", () => {
    const seed = randomBytes(32),
      id = toBase64url(randomBytes(32));
    const a = privateWallet(seed, scope, "conversation", id).getAddress();
    expect(privateWallet(seed, scope, "conversation", id).getAddress()).toBe(a);
    expect(privateWallet(seed, scope, "invitation", id).getAddress()).not.toBe(
      a,
    );
    expect(
      privateWallet(
        seed,
        { ...scope, chainId: "mainnet" },
        "conversation",
        id,
      ).getAddress(),
    ).not.toBe(a);
    expect(
      privateWallet(
        seed,
        scope,
        "conversation",
        toBase64url(randomBytes(32)),
      ).getAddress(),
    ).not.toBe(a);
  });
  it("keeps the receiver and identity proof inside a fixed-size invitation bound to its transport", () => {
    const receiver = x25519KeyPair(),
      c = context("intro", ""),
      value = { from: "public Alice", to: "public Bob" };
    const packet = sealPrivateInvitation(c, receiver.publicKey, value);
    expect(packet.length).toBe(4168);
    expect(openPrivateInvitation(c, receiver.secretKey, packet)).toEqual(value);
    expect(
      openPrivateInvitation(
        { ...c, packetId: toBase64url(randomBytes(32)) },
        receiver.secretKey,
        packet,
      ),
    ).toBeUndefined();
    expect(openPrivateInvitation(c, randomBytes(32), packet)).toBeUndefined();
    packet[100] = packet[100]! ^ 1;
    expect(
      openPrivateInvitation(c, receiver.secretKey, packet),
    ).toBeUndefined();
  });
  it("binds private identity proofs to their purpose, recipient and network", async () => {
    const signer = privateWallet(
        randomBytes(32),
        scope,
        "conversation",
        toBase64url(randomBytes(32)),
      ),
      payload = { actor: "alias", reservationId: "id" };
    const signature = await signPrivateStatement(
      scope,
      "allocate",
      payload,
      signer,
    );
    expect(
      verifyPrivateStatement(
        scope,
        "allocate",
        payload,
        signature,
        signer.getAddress(),
      ),
    ).toBe(true);
    expect(
      verifyPrivateStatement(
        scope,
        "invite",
        payload,
        signature,
        signer.getAddress(),
      ),
    ).toBe(false);
    expect(
      verifyPrivateStatement(
        scope,
        "allocate",
        { ...payload, actor: "other" },
        signature,
        signer.getAddress(),
      ),
    ).toBe(false);
  });
  it("ratchets both ways and rejects replay with the already advanced receiving state", async () => {
    let { a, b, aKey, bKey } = await pair();
    for (let n = 0; n < 6; n++) {
      const c = context(),
        sent = await encryptPrivateMessage(aKey, a, c, `Alice ${n}`),
        received = await decryptPrivateMessage(bKey, b, c, sent.envelope);
      a = sent.state;
      b = received.state;
      expect(received.text).toBe(`Alice ${n}`);
      await expect(
        decryptPrivateMessage(bKey, b, c, sent.envelope),
      ).rejects.toThrow();
      const r = context("bob", "alice"),
        reply = await encryptPrivateMessage(bKey, b, r, `Bob ${n}`),
        opened = await decryptPrivateMessage(aKey, a, r, reply.envelope);
      b = reply.state;
      a = opened.state;
      expect(opened.text).toBe(`Bob ${n}`);
    }
  });
  it("handles out-of-order messages but rejects tampering without advancing the saved state", async () => {
    const p = await pair(),
      c1 = context(),
      c2 = context();
    const first = await encryptPrivateMessage(p.aKey, p.a, c1, "first"),
      second = await encryptPrivateMessage(p.aKey, first.state, c2, "second");
    const advanced = await decryptPrivateMessage(
      p.bKey,
      p.b,
      c2,
      second.envelope,
    );
    const wrong = { ...c1, chainId: "different" };
    await expect(
      decryptPrivateMessage(p.bKey, advanced.state, wrong, first.envelope),
    ).rejects.toThrow();
    expect(
      (await decryptPrivateMessage(p.bKey, advanced.state, c1, first.envelope))
        .text,
    ).toBe("first");
    const wire = JSON.parse(new TextDecoder().decode(first.envelope));
    const cipher = fromBase64url(wire.body);
    cipher[20] = cipher[20]! ^ 1;
    wire.body = toBase64url(cipher);
    await expect(
      decryptPrivateMessage(p.bKey, p.b, c1, utf8(JSON.stringify(wire))),
    ).rejects.toThrow();
    expect(
      (await decryptPrivateMessage(p.bKey, p.b, c1, first.envelope)).text,
    ).toBe("first");
  });
  it("cannot restore a session with an account seed in place of its independent device key", async () => {
    const p = await pair(),
      c = context(),
      sent = await encryptPrivateMessage(p.aKey, p.a, c, "past message");
    await expect(
      decryptPrivateMessage(randomBytes(32), p.b, c, sent.envelope),
    ).rejects.toThrow();
    const another = await pair();
    await expect(
      decryptPrivateMessage(another.bKey, another.b, c, sent.envelope),
    ).rejects.toThrow();
  });
});

it("authenticates logical message/device/thread metadata without breaking text-only sessions", async () => {
  const p = await pair(), c = context();
  const metadata = { id: toBase64url(randomBytes(32)), deviceId: toBase64url(randomBytes(32)), threadId: toBase64url(randomBytes(32)), sentAt: 1234 };
  const sent = await encryptPrivateMessage(p.aKey, p.a, c, "One copy on each device", metadata);
  const received = await decryptPrivateMessage(p.bKey, p.b, c, sent.envelope);
  expect(received.metadata).toEqual(metadata);
  expect(received.text).toBe("One copy on each device");
  const replyContext = context("bob", "alice");
  const reply = await encryptPrivateMessage(p.bKey, received.state, replyContext, "Legacy text payload");
  expect((await decryptPrivateMessage(p.aKey, sent.state, replyContext, reply.envelope)).metadata).toBeUndefined();
  await expect(encryptPrivateMessage(p.aKey, sent.state, c, "Bad routing", { ...metadata, id: "invalid" })).rejects.toThrow("metadata");
  // Failed validation must not consume a sender key.
  const retry = await encryptPrivateMessage(p.aKey, sent.state, c, "Valid retry", metadata);
  expect((await decryptPrivateMessage(p.bKey, received.state, c, retry.envelope)).text).toBe("Valid retry");
});
