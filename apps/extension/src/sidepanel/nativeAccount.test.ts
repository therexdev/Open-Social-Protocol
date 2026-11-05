import { expect, it, vi } from "vitest";
import { exportIdentity, identityFromSeed } from "@osp/sdk";
import { createVaultStore } from "../../../web/src/vault/store";
import { memoryStorage } from "../../../web/src/vault/storage";
import { unsupportedPasskey } from "../../../web/src/vault/passkey";
import { importExistingAccount } from "./nativeAccount";
import type { VaultStatusView } from "../shared/protocol";

const rpc=vi.hoisted(()=>vi.fn());
vi.mock("../shared/rpc",()=>({rpc}));
const make=()=>createVaultStore({storage:memoryStorage(),passkey:unsupportedPasskey,kdf:{N:1024,r:8,p:1}});
const id=identityFromSeed(new Uint8Array(32).fill(19)),file=exportIdentity(id);
const legacy={account:id.account,mode:"device",status:"unlocked"} as VaultStatusView;
it("requires the original matching identity for a device-only account, and never treats its device secret as an owner",async()=>{
  const vault=make();await vault.getState().init();rpc.mockClear();
  await expect(importExistingAccount(vault,legacy,"long passphrase")).rejects.toThrow(/original identity/);
  await expect(importExistingAccount(vault,legacy,"long passphrase",exportIdentity(identityFromSeed(new Uint8Array(32).fill(20))))).rejects.toThrow(/another account/);
  expect(vault.getState().status).toBe("empty");expect(rpc).not.toHaveBeenCalled();
  await importExistingAccount(vault,legacy,"long passphrase",file);
  expect(vault.getState().account).toBe(id.account);
  vault.getState().lock();await vault.getState().unlock("long passphrase");
  expect(vault.getState().session?.identity.account).toBe(id.account);
  await expect(importExistingAccount(vault,legacy,"long passphrase",file)).rejects.toThrow(/already saved/);
});
it("copies an owner identity only on explicit migration and leaves the worker account intact",async()=>{
  const vault=make();await vault.getState().init();rpc.mockClear();rpc.mockResolvedValue({identity:file});
  await importExistingAccount(vault,{...legacy,mode:"owner"},"long passphrase");
  expect(rpc).toHaveBeenCalledExactlyOnceWith("vault.export",{passphrase:"long passphrase"});
  expect(vault.getState().account).toBe(id.account);
});
