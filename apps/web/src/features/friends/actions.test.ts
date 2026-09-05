// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ProtocolClient, decode, identityFromSeed, openEpochKeyFromSet, parseKeyPackageSet, toHex } from "@osp/sdk";
import { KeyStore } from "../../api/keystore";
import { fakeProvider, fixtureDeployment, readResult } from "../../testing/fixtures";
import { bytesOf } from "../../util/bytes";
import type { SubmitContext } from "../../tx/submit";
import { acceptFriend } from "./actions";

const seed = (label: string) => new Uint8Array(32).map((_, i) => (label.charCodeAt(i % label.length) * 5 + i) & 0xff);
const me = identityFromSeed(seed("approver"));
const requester = identityFromSeed(seed("requester"));
const deployment = fixtureDeployment();

function setup(options: { epoch?: number; requesterRegistered?: boolean } = {}) {
  const probe = new ProtocolClient({ rpc: fakeProvider(), deployment });
  const entry = (contract: "relationships" | "identity", method: string) => probe.contracts.method(contract, method).entry_point;
  const provider = fakeProvider({
    onRead: (op) => {
      if (op.entry_point === entry("relationships", "get_audience")) return readResult("relationships.get_audience_result", { value: { epoch: options.epoch ?? 2, updated_at: "1" } });
      if (op.entry_point === entry("identity", "get_identity")) {
        const { account } = decode<{ account: string }>("identity.get_identity_arguments", bytesOf(op.args));
        if (account !== requester.account || options.requesterRegistered === false) return undefined;
        return readResult("identity.get_identity_result", { value: { account, owner: account, encryption_key: requester.encryption.publicKey, key_version: 1 } });
      }
      return undefined;
    },
  });
  const client = new ProtocolClient({ rpc: provider, deployment });
  const ctx: SubmitContext = { client, signer: me.signer, payment: "self-only" };
  return { ctx, client, provider };
}

const ref = { author: me.account, audienceId: new Uint8Array(0), epoch: 2 };

describe("acceptFriend", () => {
  it("accepts and hands the new friend the current reading key in one transaction", async () => {
    const { ctx, client, provider } = setup();
    const keys = new KeyStore();
    const epochKey = new Uint8Array(32).fill(3);
    await keys.put(ref, epochKey, { recipients: [me.account] });
    await acceptFriend(ctx, requester.account, { keys });
    expect(provider.sent).toHaveLength(1);
    const ops = (provider.sent[0]!.transaction.operations ?? []).map((op) => client.contracts.decodeOperation(op)!);
    expect(ops.map((o) => `${o.contract}.${o.method}`)).toEqual(["relationships.accept_friend", "publications.distribute_keys"]);
    expect(ops[0]!.args).toMatchObject({ approver: me.account, requester: requester.account });
    const set = parseKeyPackageSet(ops[1]!.args.packages as Uint8Array);
    expect(set.epoch).toBe(2);
    expect(set.keys).toHaveLength(1);
    expect(toHex(openEpochKeyFromSet(set, requester.account, requester.encryption.secretKey)!)).toBe(toHex(epochKey));
    expect(keys.recipients(ref)).toEqual([me.account, requester.account]);
  });

  it("only accepts when there is no trusted key, the friend already holds it, or the friend has no key on chain", async () => {
    const noKey = setup();
    await acceptFriend(noKey.ctx, requester.account, { keys: new KeyStore() });
    expect(noKey.provider.sent[0]!.transaction.operations).toHaveLength(1);

    const holds = setup();
    const keys = new KeyStore();
    await keys.put(ref, new Uint8Array(32).fill(3), { recipients: [me.account, requester.account] });
    await acceptFriend(holds.ctx, requester.account, { keys });
    expect(holds.provider.sent[0]!.transaction.operations).toHaveLength(1);

    const unregistered = setup({ requesterRegistered: false });
    const keys2 = new KeyStore();
    await keys2.put(ref, new Uint8Array(32).fill(3), { recipients: [me.account] });
    await acceptFriend(unregistered.ctx, requester.account, { keys: keys2 });
    expect(unregistered.provider.sent[0]!.transaction.operations).toHaveLength(1);
    expect(keys2.recipients(ref)).toEqual([me.account]);

    const untrusted = setup();
    const keys3 = new KeyStore();
    keys3.remember(ref, new Uint8Array(32).fill(3));
    await acceptFriend(untrusted.ctx, requester.account, { keys: keys3 });
    expect(untrusted.provider.sent[0]!.transaction.operations).toHaveLength(1);
  });
});
