import { describe, expect, it, vi } from "vitest";
import { Contract, Signer, utils } from "koilib";
import { ProtocolClient } from "./client/protocolClient.js";
import { decode, encode, fromBase64url, toBase64url } from "./encoding.js";
import { fakeProvider, fixtureDeployment } from "./testing/fixtures.js";
import { decodeWalletTransfer, formatWalletAmount, parseWalletAmount, resolveNativeToken, walletBalance, walletTransferOperation, NATIVE_TRANSFER_ENTRY } from "./wallet.js";
const alice = Signer.fromSeed("wallet-alice").getAddress(), bob = Signer.fromSeed("wallet-bob").getAddress(), native = Signer.fromSeed("wallet-native").getAddress();
describe("wallet amounts", () => {
  it("preserves exact decimals, maximum uint64 balances and the final smallest unit", () => {
    expect(parseWalletAmount("184467440737.09551615", 8)).toBe("18446744073709551615");
    expect(formatWalletAmount("18446744073709551615", 8)).toBe("184467440737.09551615");
    expect(parseWalletAmount("0.00000001", 8)).toBe("1");
    expect(formatWalletAmount("100000001", 8)).toBe("1.00000001");
    expect(parseWalletAmount("124", 0)).toBe("124");
  });
  it("refuses rounding, exponents, negative/zero values, fractions of OSAT and overflow", () => {
    for (const value of ["1e8", "NaN", "-1", "0", "1,000", ".", "0.000000001", "184467440737.09551616"]) expect(() => parseWalletAmount(value, 8)).toThrow();
    expect(() => parseWalletAmount("1.5", 0)).toThrow("whole");
  });
});
it("encodes the native transfer identically to koilib's standard token ABI", async () => {
  const client = new ProtocolClient({ deployment: fixtureDeployment(), rpc: fakeProvider() });
  const balance = { token: "native" as const, address: alice, contract: native, symbol: "tKOIN", decimals: 8, available: "100000001", balance: "100000001", locked: "0" };
  const operation = await walletTransferOperation(client, balance, bob, balance.available);
  const standard = new Contract({ id: native, abi: utils.tokenAbi });
  const expected = await standard.functions.transfer!({ from: alice, to: bob, value: balance.available }, { onlyOperation: true });
  expect(operation).toEqual(expected.operation);
  expect(operation.call_contract?.entry_point).toBe(NATIVE_TRANSFER_ENTRY);
  expect(decodeWalletTransfer(operation.call_contract!.args!)).toEqual({ from: alice, to: bob, value: "100000001" });
  await expect(walletTransferOperation(client, balance, alice, "1")).rejects.toThrow();
  await expect(walletTransferOperation(client, balance, bob, "100000002")).rejects.toThrow("exceeds");
});
it("uses transferable OSAT only and requires a registered recipient", async () => {
  const client = new ProtocolClient({ deployment: fixtureDeployment(), rpc: fakeProvider() });
  vi.spyOn(client.reads.token, "get_account").mockResolvedValue({ value: { balance: "100", transferable: "7", resource_version: 2 } } as never);
  vi.spyOn(client.reads.identity, "get_identity").mockResolvedValue({} as never);
  const balance = await walletBalance(client, "osat", alice, alice);
  expect(balance).toMatchObject({ balance: "100", available: "7", locked: "93" });
  await expect(walletTransferOperation(client, balance, bob, "8")).rejects.toThrow("exceeds");
  await expect(walletTransferOperation(client, balance, bob, "7")).rejects.toThrow("registered");
  vi.mocked(client.reads.identity.get_identity).mockResolvedValue({ value: { account: bob } } as never);
  const operation = await walletTransferOperation(client, balance, bob, "7");
  expect(client.contracts.decodeOperation(operation)?.args).toMatchObject({ from: alice, to: bob, value: "7" });
});
it("resolves native KOIN on the correct chain and reads the current signer wallet", async () => {
  const provider = fakeProvider({ onRead: () => new Uint8Array([8,7]) });
  provider.invokeGetContractAddress = vi.fn(async () => ({ value: { address: native } })) as never;
  const client = new ProtocolClient({ deployment: fixtureDeployment(), rpc: provider });
  expect(await walletBalance(client, "native", alice, bob)).toMatchObject({ address: bob, contract: native, available: "7" });
  expect(decode<{ account: string }>("token.get_account_arguments", fromBase64url(provider.reads[0]!.args!)).account).toBe(bob);
  provider.getAccountRc = async () => "3";
  expect(await walletBalance(client, "native", alice, bob)).toMatchObject({ balance: "7", available: "3", locked: "4" });
  provider.getAccountRc = async () => "0";
  expect(await walletBalance(client, "native", alice, bob)).toMatchObject({ available: "0", locked: "7" });
  provider.getChainId = async () => "wrong-chain";
  await expect(resolveNativeToken(client)).rejects.toThrow("chain mismatch");
});
it("rejects extra fields and noncanonical transfer encodings", () => {
  const canonical = encode("token.transfer_arguments", { from: alice, to: bob, value: "1" });
  expect(() => decodeWalletTransfer(toBase64url(new Uint8Array([...canonical,32,1])))).toThrow("canonical");
});
