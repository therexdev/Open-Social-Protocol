import { importIdentity } from "@osp/sdk";
import type { VaultStore } from "../../../web/src/vault/store";
import type { VaultStatusView } from "../shared/protocol";
import { rpc } from "../shared/rpc";

/** Explicit local migration only. Never overwrite an account or promote a device secret to an identity. */
export async function importExistingAccount(vault: VaultStore, legacy: VaultStatusView, passphrase: string, file?: string) {
  if (vault.getState().status !== "empty") throw Error("An account is already saved. Unlock it instead of importing over it.");
  if (!legacy.account) throw Error("The previous account is unavailable.");
  if (!file && legacy.mode !== "owner") throw Error("Choose the original identity backup. A device key cannot restore the full identity.");
  const json = file || (await rpc<{ identity: string }>("vault.export", { passphrase })).identity;
  const identity = importIdentity(json);
  if (identity.account !== legacy.account) throw Error("This backup belongs to another account. Choose the backup for your existing extension account.");
  await vault.getState().importFromFile(json, passphrase);
}
