import { describe, expect, it } from "vitest";
import { CAPABILITY, toBase64url } from "@osp/sdk";
import { createTestBackground } from "../test/support";

const postId = toBase64url(new Uint8Array(32).fill(3));
const version = toBase64url(new Uint8Array(32).fill(4));

describe("trusted token actions", () => {
  it("binds a confirmed vote to the unlocked actor/device and requires voting permission", async () => {
    const t = createTestBackground({ sponsor: false });
    const passphrase = "correct horse battery";
    const { account } = await t.call<{account: string}>("vault.create", { passphrase });
    await t.call("device.authorize", { passphrase, keepOwnerSeed: true });
    await t.call("settings.update", { patch: { payment: "self-only" } });
    const device = [...t.state.devices.values()][0]!;
    const capabilities = device.capabilities;
    device.capabilities &= ~CAPABILITY.SUPPORT;
    const payload = { postId, version, direction: 2, weight: "3" };
    const count = t.state.broadcasts.length;
    await expect(t.call("economy.vote", payload)).rejects.toThrow(/reward voting first/);
    expect(t.state.broadcasts).toHaveLength(count);
    device.capabilities = capabilities;
    await t.call("economy.vote", payload);
    const op = t.state.broadcasts.at(-1)!.ops[0]!;
    expect(op).toMatchObject({ contract: "token", method: "vote", args: {
      actor: account, device: device.device, direction: 2, weight: "3",
    }});
    expect(toBase64url(op.args.post_id as Uint8Array)).toBe(postId);
    expect(toBase64url(op.args.version as Uint8Array)).toBe(version);
    await t.call("vault.lock");
    await expect(t.call("economy.vote", payload)).rejects.toThrow(/unlock/i);
    expect(t.state.broadcasts).toHaveLength(count + 1);
  });

  it("never uses a voting device to burn principal", async () => {
    const t = createTestBackground();
    const passphrase = "correct horse battery";
    await t.call("vault.create", { passphrase });
    await t.call("device.authorize", { passphrase, keepOwnerSeed: false });
    const count = t.state.broadcasts.length;
    await expect(t.call("economy.promote", { postId, version, nonce: "1", slot: 0, opportunities: 1, burnAmount: "1" })).rejects.toThrow(/owner key/);
    await expect(t.call("economy.cancel", { postId, nonce: "1" })).rejects.toThrow(/owner key/);
    expect(t.state.broadcasts).toHaveLength(count);
  });
});
