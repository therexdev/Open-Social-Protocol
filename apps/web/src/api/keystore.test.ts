import { describe, expect, it } from "vitest";
import { KeyStore, epochKeyId, type KeyCache } from "./keystore";
import { EncryptedStore, deriveAesKey } from "../vault/encryptedStore";
import { memoryStorage } from "../vault/storage";

const ref = { author: "test-author", audienceId: new Uint8Array(), epoch: 0 };
describe("confirmed key delivery cache migration", () => {
  it("retains legacy reading keys but repairs unconfirmed recipient records", async () => {
    const persist = new EncryptedStore<KeyCache>(memoryStorage(), "keys", await deriveAesKey(new Uint8Array(32).fill(1), "test"));
    await persist.save({ [epochKeyId(ref)]: { key: "02".repeat(32), recipients: ["friend"] } });
    const keys = new KeyStore(persist); await keys.init();
    expect(keys.trusted(ref)?.key).toEqual(new Uint8Array(32).fill(2));
    expect(keys.recipients(ref)).toEqual([]);
    await keys.addRecipients(ref, ["friend"]);
    const restored = new KeyStore(persist); await restored.init();
    expect(restored.recipients(ref)).toEqual(["friend"]);
  });
});
