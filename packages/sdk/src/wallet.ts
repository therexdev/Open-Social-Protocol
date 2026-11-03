import { Contract, utils, type OperationJson } from "koilib";
import { bytesEqual, decode, encode, fromBase64url, toBase64url } from "./encoding.js";
import { isAddress } from "./ids.js";
import type { ProtocolClient } from "./client/protocolClient.js";

export type WalletToken = "osat" | "native";
export const NATIVE_TRANSFER_ENTRY = utils.tokenAbi.methods.transfer!.entry_point;
const MAX_U64 = 0xffffffffffffffffn;
function units(value: string): bigint {
  if (!/^\d+$/.test(value) || BigInt(value) > MAX_U64) throw new Error("Invalid token balance or amount.");
  return BigInt(value);
}
export function parseWalletAmount(value: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) throw new Error("Unsupported token precision.");
  const text = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error("Enter a positive amount using digits and a decimal point.");
  const [whole = "", fraction = ""] = text.split(".");
  if (fraction.length > decimals) throw new Error(decimals ? `Use at most ${decimals} decimal places.` : "OSAT transfers use whole tokens.");
  const amount = units(whole + fraction.padEnd(decimals, "0"));
  if (!amount) throw new Error("Enter an amount greater than zero.");
  return amount.toString();
}
export function formatWalletAmount(value: string, decimals: number): string {
  const n = units(value);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) throw new Error("Unsupported token precision.");
  if (!decimals) return n.toString();
  const scale = 10n ** BigInt(decimals);
  const fraction = (n % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${n / scale}${fraction ? `.${fraction}` : ""}`;
}
export interface WalletBalance {
  token: WalletToken;
  address: string;
  contract: string;
  symbol: string;
  decimals: number;
  balance: string;
  available: string;
  locked: string;
}
export async function resolveNativeToken(client: ProtocolClient): Promise<string> {
  if (await client.provider.getChainId() !== client.chainId) throw new Error("Wallet RPC chain mismatch.");
  const address = (await client.provider.invokeGetContractAddress?.("koin"))?.value.address;
  if (!isAddress(address)) throw new Error("The native KOIN contract could not be resolved on this network.");
  return address;
}
export async function walletBalance(client: ProtocolClient, token: WalletToken, account: string, signer: string): Promise<WalletBalance> {
  if (!isAddress(account) || !isAddress(signer)) throw new Error("Invalid wallet address.");
  if (token === "osat") {
    if (await client.provider.getChainId() !== client.chainId) throw new Error("Wallet RPC chain mismatch.");
    const value = (await client.reads.token.get_account({ account }))?.value;
    if (!value) throw new Error("OSAT balance is unavailable. Refresh before sending.");
    const balance = units(value.balance).toString();
    // Never fall back to the total when a v2 transferable balance is absent.
    const available = units(Number(value.resource_version) === 2 ? value.transferable ?? "0" : balance).toString();
    if (BigInt(available) > BigInt(balance)) throw new Error("Invalid transferable OSAT balance.");
    return { token, address: account, contract: client.deployment.contracts.token.address, symbol: "OSAT", decimals: 0, balance, available, locked: (BigInt(balance) - BigInt(available)).toString() };
  }
  const address = await resolveNativeToken(client);
  const contract = new Contract({ id: address, abi: utils.tokenAbi, provider: client.provider });
  const [response, rc] = await Promise.all([contract.functions.balanceOf!({ owner: signer }), client.provider.getAccountRc(signer)]);
  const result = response.result as { value?: string } | undefined;
  if (result?.value === undefined) throw new Error("Native token balance is unavailable. Refresh before sending.");
  const balance = units(result.value).toString();
  // KOIN.transfer checks both balance and regenerated Mana. Sponsorship pays for the
  // new transaction but cannot unlock KOIN tied to the owner's earlier Mana usage.
  const mana = units(rc), available = mana < BigInt(balance) ? mana : BigInt(balance);
  return { token, address: signer, contract: address, symbol: client.deployment.network === "mainnet" ? "KOIN" : "tKOIN", decimals: 8, balance, available: available.toString(), locked: (BigInt(balance) - available).toString() };
}
export interface WalletTransferArgs { from: string; to: string; value: string }
/** OSAT and native KOIN share fields 1–3. Wallet transfers intentionally carry no memo. */
export function decodeWalletTransfer(encoded: string): WalletTransferArgs {
  const bytes = fromBase64url(encoded);
  const args = decode<WalletTransferArgs>("token.transfer_arguments", bytes);
  if (!isAddress(args.from) || !isAddress(args.to) || args.from === args.to || !units(args.value)) throw new Error("Invalid transfer recipient or amount.");
  if (!bytesEqual(bytes, encode("token.transfer_arguments", { ...args }))) throw new Error("Transfer arguments must use the canonical wallet format.");
  return args;
}
export async function walletTransferOperation(client: ProtocolClient, balance: WalletBalance, to: string, amount: string): Promise<OperationJson> {
  const args = { from: balance.address, to, value: amount };
  const encoded = toBase64url(encode("token.transfer_arguments", args));
  decodeWalletTransfer(encoded);
  if (BigInt(amount) > BigInt(balance.available)) throw new Error("The amount exceeds your available balance.");
  if (balance.token === "osat") {
    if (!(await client.reads.identity.get_identity({ account: to }))?.value) throw new Error("The OSAT recipient must be registered on Open Social.");
    return client.ops.token.transfer(args);
  }
  return { call_contract: { contract_id: balance.contract, entry_point: NATIVE_TRANSFER_ENTRY, args: encoded } };
}
