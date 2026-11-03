import { contentHash } from "./ids.js";
import {
  bytesEqual,
  encode,
  decode,
  fromBase64url,
  toBase64url,
} from "./encoding.js";
import type { OperationJson } from "koilib";
import type { ProtocolContracts } from "./client/contracts.js";
import type { ProtocolClient } from "./client/protocolClient.js";
import type { Address, Bytes, U64 } from "./client/types.js";

export const MUSIC_CHUNK_BYTES = 16384;
export const MUSIC_MAX_BYTES = 10 * 1024 * 1024;
export const MUSIC_DEFAULT_RATE = "8610000000"; // 86.1 native KOIN / decimal MB
export const MUSIC_MIMES = [
  "audio/mpeg",
  "audio/ogg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
] as const;
export interface MusicConfig {
  native_token: string;
  version: number;
  revision: number;
  recipient: string;
  rate_per_mb: string;
  max_bytes: number;
  enabled: boolean;
}
export interface MusicRecord {
  owner: string;
  digest: Uint8Array;
  size: number;
  chunk_hashes: Uint8Array[];
  received: number;
  title: string;
  mime: string;
  duration_ms: number;
  fee: string;
  recipient: string;
  payer: string;
}
export interface BeginMusicArgs {
  owner: Address;
  id: Bytes;
  digest: Bytes;
  size: number;
  chunk_hashes: Bytes[];
  title: string;
  mime: string;
  duration_ms: number;
  config_revision: number;
  max_fee: U64;
  payer: Address;
  device?: Address;
}
/** Atomic units; exact integer arithmetic and the same whole-token rounding as the contract. */
export function musicFee(size: number, rate = MUSIC_DEFAULT_RATE): string {
  if (!Number.isSafeInteger(size) || size < 1 || size > MUSIC_MAX_BYTES)
    throw new Error("Audio must be between 1 byte and 10 MiB.");
  if (!/^\d+$/.test(rate) || BigInt(rate) < 1n || BigInt(rate) > 1000000000000n)
    throw new Error("Invalid music upload rate.");
  const unit = 100000000n,
    divisor = 1000000n * unit;
  return (
    ((BigInt(size) * BigInt(rate) + divisor - 1n) / divisor) *
    unit
  ).toString();
}
export function musicChunks(bytes: Uint8Array): Uint8Array[] {
  musicFee(bytes.length);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += MUSIC_CHUNK_BYTES)
    chunks.push(bytes.slice(i, i + MUSIC_CHUNK_BYTES));
  return chunks;
}
export function verifyMusic(
  record: MusicRecord,
  chunks: Uint8Array[]
): Uint8Array {
  musicFee(record.size);
  const count = Math.ceil(record.size / MUSIC_CHUNK_BYTES);
  if (
    record.received !== count ||
    chunks.length !== count ||
    record.chunk_hashes.length !== count
  )
    throw new Error("Audio upload is incomplete.");
  const bytes = new Uint8Array(record.size);
  chunks.forEach((chunk, i) => {
    if (
      chunk.length !==
        Math.min(MUSIC_CHUNK_BYTES, record.size - i * MUSIC_CHUNK_BYTES) ||
      !bytesEqual(contentHash(chunk), record.chunk_hashes[i]!)
    )
      throw new Error("Audio chunk verification failed.");
    bytes.set(chunk, i * MUSIC_CHUNK_BYTES);
  });
  if (!bytesEqual(contentHash(bytes), record.digest))
    throw new Error("Audio file verification failed.");
  return bytes;
}
export async function musicConfig(
  client: ProtocolClient
): Promise<MusicConfig> {
  let config: MusicConfig | undefined;
  try {
    config = (await client.reads.publications.get_music_config())?.value;
  } catch {
    throw new Error(
      "Music uploads need the updated Open Social contract. Please try again after the network update."
    );
  }
  if (config?.version !== 1)
    throw new Error("This network does not support Music yet.");
  return config;
}

export const NATIVE_APPROVE_ENTRY = 0x74e21680;
/** One signed transaction grants the exact fee, pays/reserves, then clears allowance.
 * Replaying a paid reservation leaves neither another payment nor an allowance. */
export async function musicPaymentOperations(
  client: ProtocolClient,
  args: BeginMusicArgs,
  nativeAddress: string
): Promise<OperationJson[]> {
  const approve = (value: U64): OperationJson => ({
    call_contract: {
      contract_id: nativeAddress,
      entry_point: NATIVE_APPROVE_ENTRY,
      args: toBase64url(
        encode("publications.music_native_approval", {
          owner: args.payer,
          spender: client.deployment.contracts.publications.address,
          value,
        })
      ),
    },
  });
  return [
    approve(args.max_fee),
    await client.ops.publications.begin_music(args),
    approve("0"),
  ];
}
/** Sponsor policy only permits native approvals inside this exact payment bundle. */
export function validMusicPaymentBundle(
  contracts: ProtocolContracts,
  operations: OperationJson[],
  payer: string,
  nativeAddress: string
): boolean {
  try {
    if (operations.length !== 3) return false;
    const middle = contracts.decodeOperation(operations[1]!);
    if (
      !middle ||
      middle.contract !== "publications" ||
      middle.method !== "begin_music" ||
      middle.args.payer !== payer ||
      BigInt(String(middle.args.max_fee)) <= 0n
    )
      return false;
    for (const index of [0, 2]) {
      const op = operations[index]!;
      if (
        Object.keys(op).length !== 1 ||
        !op.call_contract ||
        op.call_contract.contract_id !== nativeAddress ||
        op.call_contract.entry_point !== NATIVE_APPROVE_ENTRY
      )
        return false;
      const args = decode<{ owner: string; spender: string; value: string }>(
        "publications.music_native_approval",
        fromBase64url(op.call_contract.args ?? "")
      );
      if (
        args.owner !== payer ||
        args.spender !== contracts.deployment.contracts.publications.address ||
        args.value !== (index === 0 ? String(middle.args.max_fee) : "0")
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
