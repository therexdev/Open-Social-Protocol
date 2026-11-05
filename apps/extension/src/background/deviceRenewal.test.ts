import { expect, it } from "vitest";
import { exportIdentity, identityFromSeed } from "@osp/sdk";
import { createTestBackground } from "../test/support";

it("renews a device with an explicitly supplied matching identity without replacing keys or retaining owner authority",async()=>{
  const t=createTestBackground({sponsor:false}),passphrase="correct horse battery";
  await t.call("vault.create",{passphrase});
  const {identity}=await t.call<{identity:string}>("vault.export",{passphrase});
  await t.call("settings.update",{patch:{payment:"self-only"}});
  await t.call("device.authorize",{passphrase,keepOwnerSeed:false});
  const previous=await t.background.vault.current(),before=t.state.broadcasts.length;
  expect(previous?.ownerSeed).toBeUndefined();
  await expect(t.call("device.authorize",{passphrase,keepOwnerSeed:false,identity:exportIdentity(identityFromSeed(new Uint8Array(32).fill(23)))})).rejects.toThrow(/does not match/);
  expect(t.state.broadcasts.length).toBe(before);
  await t.call("device.authorize",{passphrase,keepOwnerSeed:false,identity});
  const next=await t.background.vault.current();
  expect(next).toMatchObject({account:previous!.account,deviceAddress:previous!.deviceAddress,encryptionSecret:previous!.encryptionSecret,mode:"device"});
  expect(next?.ownerSeed).toBeUndefined();
  await expect(t.call("vault.export",{passphrase})).rejects.toThrow(/only a device key/);
});
