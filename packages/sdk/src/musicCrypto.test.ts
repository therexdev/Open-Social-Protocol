import { expect, it } from "vitest";
import { identityFromSeed } from "./vault.js";
import { contentHash } from "./ids.js";
import { newEpochKey } from "./crypto/audience.js";
import {
  musicCipher,
  musicCoverCipher,
  musicCommentCipher,
  musicKeyContext,
  openMusicKey,
  sealMusicKey,
} from "./musicCrypto.js";
import { fixtureDeployment } from "./testing/fixtures.js";
const deployment = fixtureDeployment(),
  owner = identityFromSeed(new Uint8Array(32).fill(9)),
  buyer = identityFromSeed(new Uint8Array(32).fill(10));
const id = new Uint8Array(32).fill(12),
  context = musicKeyContext(
    deployment.chainId,
    deployment.contracts.publications.address,
    id,
    owner.account
  );
it("only the addressed buyer can open a track key, bound to chain, contract and track", () => {
  const key = newEpochKey(),
    sealed = sealMusicKey(context, key, {
      address: buyer.account,
      publicKey: buyer.encryption.publicKey,
      keyVersion: 1,
    });
  expect(openMusicKey(context, sealed, buyer.account, buyer.seed, contentHash(key))).toEqual(key);
  expect(() =>
    openMusicKey(context, sealed, owner.account, owner.seed, contentHash(key))
  ).toThrow();
  const otherTrack = musicKeyContext(
    deployment.chainId,
    deployment.contracts.publications.address,
    new Uint8Array(32).fill(13),
    owner.account
  );
  expect(() =>
    openMusicKey(otherTrack, sealed, buyer.account, buyer.seed, contentHash(key))
  ).toThrow();
  expect(() =>
    openMusicKey(context, sealed, buyer.account, buyer.seed, new Uint8Array(32))
  ).toThrow("does not match");
});
it("resumable encryption is byte-identical and plaintext cannot be played from public state", () => {
  const key = newEpochKey(),
    nonce = new Uint8Array(24).fill(7),
    source = new Uint8Array(40000).fill(42);
  const a = musicCipher(context, key, nonce).encrypt(source),
    b = musicCipher(context, key, nonce).encrypt(source);
  expect(a).toEqual(b);
  expect(a.length).toBe(source.length + 16);
  expect(a.slice(0, source.length)).not.toEqual(source);
  expect(musicCipher(context, key, nonce).decrypt(a)).toEqual(source);
  expect(() => musicCipher(context, newEpochKey(), nonce).decrypt(a)).toThrow();
  a[100] = a[100]! ^ 1;
  expect(() => musicCipher(context, key, nonce).decrypt(a)).toThrow();
});
it("comments authenticate their track, comment id and author", () => {
  const key = newEpochKey(),
    nonce = new Uint8Array(24).fill(7),
    text = new TextEncoder().encode("Great track!");
  const encrypted = musicCommentCipher(context, key, nonce, id, buyer.account).encrypt(text);
  expect(musicCommentCipher(context, key, nonce, id, buyer.account).decrypt(encrypted)).toEqual(
    text
  );
  expect(() =>
    musicCommentCipher(context, key, nonce, id, owner.account).decrypt(encrypted)
  ).toThrow();
  expect(() =>
    musicCommentCipher(context, key, nonce, new Uint8Array(32), buyer.account).decrypt(encrypted)
  ).toThrow();
});

it("separates artwork encryption from audio and binds it to the track", () => {
  const key = newEpochKey(), nonce = new Uint8Array(24).fill(33), image = new Uint8Array([255, 216, 255, 1]);
  const encrypted = musicCoverCipher(context, key, nonce).encrypt(image);
  expect(musicCoverCipher(context, key, nonce).decrypt(encrypted)).toEqual(image);
  expect(() => musicCipher(context, key, nonce).decrypt(encrypted)).toThrow();
  const other = musicKeyContext(deployment.chainId, deployment.contracts.publications.address, new Uint8Array(32).fill(55), owner.account);
  expect(() => musicCoverCipher(other, key, nonce).decrypt(encrypted)).toThrow();
});
