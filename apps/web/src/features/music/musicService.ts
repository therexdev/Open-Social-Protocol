import {
  bytesEqual,
  contentHash,
  fromBase64url,
  MUSIC_MAX_BYTES,
  MUSIC_MIMES,
  musicChunks,
  musicConfig,
  musicFee,
  musicPaymentOperations,
  newEpochKey,
  toBase64url,
  verifyMusic,
  type BeginMusicArgs,
  type MusicConfig,
  type MusicRecord,
  type ProtocolClient,
} from "@osp/sdk";
import { submitAction, type SubmitContext } from "../../tx/submit";
import { toArrayBuffer } from "../../util/bytes";
import { deriveAesKey, EncryptedStore } from "../../vault/encryptedStore";
import { defaultStorage } from "../../vault/storage";
import type { Session } from "../../vault/store";

export interface MusicDraft {
  id: string;
  owner: string;
  payer: string;
  digest: string;
  size: number;
  title: string;
  mime: string;
  durationMs: number;
  configRevision: number;
  fee: string;
  recipient: string;
}
export const musicTokens = (fee: string) =>
  (BigInt(fee) / 100000000n).toLocaleString();
export const musicDuration = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(
    2,
    "0"
  )}`;
export async function musicDraftStore(
  session: Session,
  client: ProtocolClient
): Promise<EncryptedStore<MusicDraft>> {
  const scope = `${client.chainId}:${client.deployment.contracts.publications.address}:${session.identity.account}`;
  return new EncryptedStore(
    defaultStorage(),
    `osp.web.music.${scope}`,
    await deriveAesKey(session.identity.seed, `music:${scope}`)
  );
}
export async function prepareAudio(
  file: File
): Promise<{ bytes: Uint8Array; mime: string; durationMs: number }> {
  if (!file.size || file.size > MUSIC_MAX_BYTES)
    throw new Error("Choose an audio file no larger than 10 MiB.");
  const aliases: Record<string, string> = {
    "audio/mp3": "audio/mpeg",
    "audio/x-wav": "audio/wav",
    "audio/x-m4a": "audio/mp4",
  };
  const mime = aliases[file.type] ?? file.type;
  if (!(MUSIC_MIMES as readonly string[]).includes(mime))
    throw new Error("Choose MP3, M4A, Ogg, WAV or WebM audio.");
  const bytes = new Uint8Array(
    await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      const timer = setTimeout(() => reader.abort(), 15000);
      reader.onload = () => {
        clearTimeout(timer);
        resolve(reader.result as ArrayBuffer);
      };
      reader.onloadend = () => clearTimeout(timer);
      reader.onerror = () =>
        reject(
          new Error(
            "This audio file could not be read. Save it on this device and select it again."
          )
        );
      reader.onabort = () => reject(new Error("Reading audio was cancelled."));
      reader.readAsArrayBuffer(file);
    })
  );
  musicFee(bytes.length);
  const url = URL.createObjectURL(
    new Blob([toArrayBuffer(bytes)], { type: mime })
  );
  const audio = document.createElement("audio");
  try {
    const durationMs = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error("Audio details took too long to load. Try an MP3 file.")
          ),
        15000
      );
      const finish = (error?: Error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else if (
          !Number.isFinite(audio.duration) ||
          audio.duration <= 0 ||
          audio.duration > 3600
        )
          reject(new Error("Choose playable audio up to one hour long."));
        else resolve(Math.max(1, Math.round(audio.duration * 1000)));
      };
      audio.onloadedmetadata = () => finish();
      audio.onerror = () =>
        finish(new Error("Your browser cannot play this audio. Try MP3."));
      audio.preload = "metadata";
      audio.src = url;
    });
    return { bytes, mime, durationMs };
  } finally {
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
  }
}
export function newMusicDraft(input: {
  owner: string;
  payer: string;
  title: string;
  bytes: Uint8Array;
  mime: string;
  durationMs: number;
  config: MusicConfig;
}): MusicDraft {
  const title = input.title.trim();
  if (!title || new TextEncoder().encode(title).length > 240)
    throw new Error("Enter a title no longer than 240 UTF-8 bytes.");
  if (!input.config.enabled || input.bytes.length > input.config.max_bytes)
    throw new Error(
      "Audio uploads are disabled or this file exceeds the current size limit."
    );
  return {
    id: toBase64url(newEpochKey()),
    owner: input.owner,
    payer: input.payer,
    digest: toBase64url(contentHash(input.bytes)),
    size: input.bytes.length,
    title,
    mime: input.mime,
    durationMs: input.durationMs,
    configRevision: input.config.revision,
    fee: musicFee(input.bytes.length, input.config.rate_per_mb),
    recipient: input.config.recipient,
  };
}
export function matchesMusic(draft: MusicDraft, record: MusicRecord): boolean {
  return (
    record.owner === draft.owner &&
    record.payer === draft.payer &&
    record.title === draft.title &&
    record.mime === draft.mime &&
    record.size === draft.size &&
    record.duration_ms === draft.durationMs &&
    bytesEqual(record.digest, fromBase64url(draft.digest))
  );
}
export async function uploadMusic(
  ctx: SubmitContext,
  draft: MusicDraft,
  bytes: Uint8Array,
  assertActive: () => void,
  progress: (received: number, total: number, paid: boolean) => void
): Promise<void> {
  if (
    bytes.length !== draft.size ||
    !bytesEqual(contentHash(bytes), fromBase64url(draft.digest))
  )
    throw new Error("Select the same audio file to resume this upload.");
  if (ctx.signer.getAddress() !== draft.payer)
    throw new Error("Unlock the account that started this upload.");
  const client = ctx.client,
    id = fromBase64url(draft.id),
    chunks = musicChunks(bytes);
  assertActive();
  let record = (await client.reads.publications.get_music({ id }))?.value;
  if (record && !matchesMusic(draft, record))
    throw new Error("Saved upload does not match the on-chain reservation.");
  if (!record) {
    const config = await musicConfig(client);
    if (
      !config.enabled ||
      config.revision !== draft.configRevision ||
      config.recipient !== draft.recipient ||
      musicFee(draft.size, config.rate_per_mb) !== draft.fee
    )
      throw new Error(
        "The music price changed. Refresh the quote before paying."
      );
    const args: BeginMusicArgs = {
      owner: draft.owner,
      payer: draft.payer,
      id,
      digest: fromBase64url(draft.digest),
      size: bytes.length,
      chunk_hashes: chunks.map(contentHash),
      title: draft.title,
      mime: draft.mime,
      duration_ms: draft.durationMs,
      config_revision: draft.configRevision,
      max_fee: draft.fee,
    };
    await submitAction(
      ctx,
      await musicPaymentOperations(client, args, config.native_token),
      {
        label: "Paying for music upload",
        quietProgress: true,
        beforeSubmit: async () => assertActive(),
      }
    );
    record = (await client.reads.publications.get_music({ id }))?.value;
    if (!record)
      throw new Error(
        "Payment is still confirming. Resume this saved upload shortly."
      );
  }
  if (!matchesMusic(draft, record))
    throw new Error("Music reservation changed unexpectedly.");
  progress(record.received, chunks.length, true);
  for (let index = record.received; index < chunks.length; index++) {
    assertActive();
    await submitAction(
      ctx,
      [
        await client.ops.publications.append_music({
          owner: draft.owner,
          id,
          index,
          data: chunks[index]!,
        }),
      ],
      {
        label: `Uploading audio ${index + 1}/${chunks.length}`,
        quietProgress: true,
        beforeSubmit: async () => assertActive(),
      }
    );
    progress(index + 1, chunks.length, true);
  }
  const complete = (await client.reads.publications.get_music({ id }))?.value;
  if (!complete || complete.received !== chunks.length)
    throw new Error(
      "The last chunk is still confirming. Resume to check completion."
    );
}
export async function loadMusic(
  client: ProtocolClient,
  id: string,
  signal?: AbortSignal,
  progress?: (received: number, total: number) => void
): Promise<{ record: MusicRecord; bytes: Uint8Array }> {
  const key = fromBase64url(id),
    record = (await client.reads.publications.get_music({ id: key }))?.value;
  if (
    !record ||
    record.received !== record.chunk_hashes.length ||
    record.size < 1 ||
    record.size > MUSIC_MAX_BYTES ||
    record.chunk_hashes.length !== Math.ceil(record.size / 16384)
  )
    throw new Error("This track is not ready to play.");
  const chunks = new Array<Uint8Array>(record.chunk_hashes.length);
  let cursor = 0,
    received = 0;
  const check = () => {
    if (signal?.aborted) throw new Error("Audio loading cancelled.");
  };
  await Promise.all(
    Array.from({ length: Math.min(4, chunks.length) }, async () => {
      while (cursor < chunks.length) {
        check();
        const index = cursor++;
        const result = await client.reads.publications.get_music_chunk({
          id: key,
          index,
        });
        check();
        if (!result)
          throw new Error(
            "An audio chunk is unavailable. Retry loading the track."
          );
        chunks[index] = result.data;
        progress?.(++received, chunks.length);
      }
    })
  );
  check();
  return { record, bytes: verifyMusic(record, chunks) };
}
