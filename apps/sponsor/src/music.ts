import {
  validMusicPaymentBundle,
  bytesEqual,
  contentHash,
  MUSIC_CHUNK_BYTES,
  MUSIC_BATCH_CHUNKS,
  MUSIC_MAX_BYTES,
  musicFee,
  toBase64url,
  type OperationJson,
  type ProtocolClient,
} from "@osp/sdk";
import { SponsorRefusal } from "./validate.js";

/** A paid archive gets its own bounded quota; ordinary free actions retain their quota. */
export async function musicAllowance(
  client: ProtocolClient,
  sponsor: string,
  payee: string,
  operations: OperationJson[]
): Promise<{ key: string; limit: number; units?: number } | undefined> {
  const decoded = operations.map((op) => client.contracts.decodeOperation(op));
  const music = decoded.filter(
    (op) =>
      op?.contract === "publications" &&
      ["begin_music", "append_music", "append_music_batch"].includes(op.method)
  );
  if (!music.length) return undefined;
  const refuse = (message: string): never => {
    throw new SponsorRefusal("method_not_allowed", message);
  };
  const op = music[0]!,
    args = op.args;
  if (op.method === "begin_music") {
    const config = (await client.reads.publications.get_music_config())?.value;
    if (
      !config ||
      !validMusicPaymentBundle(client.contracts, operations, payee, config.native_token)
    )
      refuse("Music payments require the exact approval, payment and cleanup bundle");
    if (
      !config?.enabled ||
      config.recipient !== sponsor ||
      args.payer !== payee ||
      args.config_revision !== config.revision ||
      args.max_fee !== musicFee(Number(args.size), config.rate_per_mb)
    )
      refuse("This sponsor only funds music uploads paid to its configured account");
    return undefined;
  }
  if (operations.length !== 1) refuse("Music chunks must use one operation per transaction");
  const id = args.id as Uint8Array;
  const record = (await client.reads.publications.get_music({ id }))?.value;
  if (
    !record ||
    record.recipient !== sponsor ||
    BigInt(record.fee) <= 0n ||
    record.owner !== args.owner ||
    record.size < 1 ||
    record.size > MUSIC_MAX_BYTES ||
    record.chunk_hashes.length !== Math.ceil(record.size / MUSIC_CHUNK_BYTES)
  )
    refuse("No matching paid music reservation for this sponsor");
  const v = record!,
    index = Number(args.index);
  const chunks =
    op.method === "append_music_batch" ? (args.chunks as Uint8Array[]) : [args.data as Uint8Array];
  if (
    !Array.isArray(chunks) ||
    chunks.length < 1 ||
    chunks.length > MUSIC_BATCH_CHUNKS ||
    index !== v.received ||
    index + chunks.length > v.chunk_hashes.length
  )
    refuse("Refresh music upload progress before retrying this chunk");
  for (let offset = 0; offset < chunks.length; offset++) {
    const i = index + offset,
      data = chunks[offset];
    if (
      !(data instanceof Uint8Array) ||
      data.length !== Math.min(MUSIC_CHUNK_BYTES, v.size - i * MUSIC_CHUNK_BYTES) ||
      !bytesEqual(contentHash(data), v.chunk_hashes[i]!)
    )
      refuse("Refresh music upload progress before retrying this chunk");
  }
  // At most two attempts per paid chunk/day, including reverted broadcasts.
  return {
    key: `music:${client.chainId}:${client.deployment.contracts.publications.address}:${toBase64url(
      id
    )}`,
    limit: v.chunk_hashes.length * 2,
    units: chunks.length,
  };
}
