import {
  bytesEqual,
  encode,
  decode,
  randomBytes,
  musicCipher,
  musicKeyContext,
  sealMusicKey,
  MUSIC_BATCH_CHUNKS,
  MUSIC_CHUNK_BYTES,
  MUSIC_READ_BATCH_CHUNKS,
  musicBatchChunks,
  type MusicKey,
  type Identity,
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
import { musicCache, musicCacheKey } from "./musicCache";
import { hasMusicGateway, readMusicGateway } from "./musicGateway";

export interface MusicDraft {
  artist?: string;
  description?: string;
  audience?: number;
  groupId?: string;
  unlockPrice?: string;
  sourceDigest?: string;
  sourceSize?: number;
  key?: string;
  nonce?: string;
  ownerKey?: string;
  keyHash?: string;
  batchSize?: number;
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
export const musicTokens = (fee: string) => (BigInt(fee) / 100000000n).toLocaleString();
export const musicDuration = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
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
  const url = URL.createObjectURL(new Blob([toArrayBuffer(bytes)], { type: mime }));
  const audio = document.createElement("audio");
  try {
    const durationMs = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Audio details took too long to load. Try an MP3 file.")),
        15000
      );
      const finish = (error?: Error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else if (!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > 3600)
          reject(new Error("Choose playable audio up to one hour long."));
        else resolve(Math.max(1, Math.round(audio.duration * 1000)));
      };
      audio.onloadedmetadata = () => finish();
      audio.onerror = () => finish(new Error("Your browser cannot play this audio. Try MP3."));
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
  artist?: string;
  description?: string;
  audience?: number;
  groupId?: string;
  unlockPrice?: string;
  identity?: Identity;
  client?: ProtocolClient;
}): MusicDraft {
  const title = input.title.trim();
  if (!title || new TextEncoder().encode(title).length > 240)
    throw new Error("Enter a title no longer than 240 UTF-8 bytes.");
  if (!input.config.enabled || input.bytes.length > input.config.max_bytes)
    throw new Error("Audio uploads are disabled or this file exceeds the current size limit.");
  const artist = (input.artist ?? "").trim(),
    description = (input.description ?? "").trim(),
    audience = input.audience ?? 0,
    price = input.unlockPrice ?? "0";
  if (
    new TextEncoder().encode(artist).length > 240 ||
    new TextEncoder().encode(description).length > 2000
  )
    throw new Error("Artist must fit 240 bytes and description 2000 bytes.");
  if (!/^(0|[1-9][0-9]*)$/.test(price) || BigInt(price) > 1000000n)
    throw new Error("Enter a whole OSAT price from 0 to 1,000,000.");
  if (
    ![0, 1, 2].includes(audience) ||
    (audience === 2 && (!input.groupId || fromBase64url(input.groupId).length !== 32))
  )
    throw new Error("Choose a valid audience and group.");
  const encrypted = audience !== 0 || BigInt(price) > 0n;
  if ((encrypted || artist || description) && input.config.version < 2)
    throw new Error("These music features need the updated contracts.");
  const id = newEpochKey(),
    key = encrypted ? newEpochKey() : undefined,
    nonce = encrypted ? randomBytes(24) : undefined;
  let stored = input.bytes,
    ownerKey: MusicKey | undefined;
  if (key && nonce) {
    if (!input.identity || !input.client)
      throw new Error("Unlock your account to prepare restricted audio.");
    const context = musicKeyContext(
      input.client.chainId,
      input.client.deployment.contracts.publications.address,
      id,
      input.owner
    );
    stored = musicCipher(context, key, nonce).encrypt(input.bytes);
    ownerKey = sealMusicKey(context, key, {
      address: input.owner,
      publicKey: input.identity.encryption.publicKey,
      keyVersion: input.identity.encryption.keyVersion,
    });
  }
  if (stored.length > input.config.max_bytes)
    throw new Error("Audio including encryption exceeds the upload size limit.");
  return {
    id: toBase64url(id),
    owner: input.owner,
    payer: input.payer,
    digest: toBase64url(contentHash(stored)),
    size: stored.length,
    sourceDigest: toBase64url(contentHash(input.bytes)),
    sourceSize: input.bytes.length,
    title,
    artist,
    description,
    audience,
    groupId: audience === 2 ? input.groupId : undefined,
    unlockPrice: price,
    mime: input.mime,
    durationMs: input.durationMs,
    configRevision: input.config.revision,
    fee: musicFee(stored.length, input.config.rate_per_mb),
    recipient: input.config.recipient,
    batchSize: musicBatchChunks(input.config.version),
    ...(key && nonce && ownerKey
      ? {
          key: toBase64url(key),
          nonce: toBase64url(nonce),
          ownerKey: toBase64url(
            encode("publications.music_key", ownerKey as unknown as Record<string, unknown>)
          ),
          keyHash: toBase64url(contentHash(key)),
        }
      : {}),
  };
}
export function matchesMusic(draft: MusicDraft, record: MusicRecord): boolean {
  return (
    record.owner === draft.owner &&
    record.payer === draft.payer &&
    record.title === draft.title &&
    (record.artist ?? "") === (draft.artist ?? "") &&
    (record.description ?? "") === (draft.description ?? "") &&
    (record.audience ?? 0) === (draft.audience ?? 0) &&
    (record.unlock_price ?? "0") === (draft.unlockPrice ?? "0") &&
    !!record.encrypted === !!draft.key &&
    toBase64url(record.group_id ?? new Uint8Array()) === (draft.groupId ?? "") &&
    toBase64url(record.nonce ?? new Uint8Array()) === (draft.nonce ?? "") &&
    toBase64url(record.key_hash ?? new Uint8Array()) === (draft.keyHash ?? "") &&
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
    bytes.length !== (draft.sourceSize ?? draft.size) ||
    !bytesEqual(contentHash(bytes), fromBase64url(draft.sourceDigest ?? draft.digest))
  )
    throw new Error("Select the same audio file to resume this upload.");
  if (ctx.signer.getAddress() !== draft.payer)
    throw new Error("Unlock the account that started this upload.");
  const client = ctx.client,
    id = fromBase64url(draft.id),
    stored =
      draft.key && draft.nonce
        ? musicCipher(
            musicKeyContext(
              client.chainId,
              client.deployment.contracts.publications.address,
              id,
              draft.owner
            ),
            fromBase64url(draft.key),
            fromBase64url(draft.nonce)
          ).encrypt(bytes)
        : bytes,
    chunks = musicChunks(stored);
  if (stored.length !== draft.size || !bytesEqual(contentHash(stored), fromBase64url(draft.digest)))
    throw new Error("Saved encryption settings do not match this upload.");
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
      throw new Error("The music price changed. Refresh the quote before paying.");
    const args: BeginMusicArgs = {
      owner: draft.owner,
      payer: draft.payer,
      id,
      digest: fromBase64url(draft.digest),
      size: stored.length,
      chunk_hashes: chunks.map(contentHash),
      title: draft.title,
      artist: draft.artist,
      description: draft.description,
      audience: draft.audience,
      ...(draft.groupId && { group_id: fromBase64url(draft.groupId) }),
      unlock_price: draft.unlockPrice ?? "0",
      encrypted: !!draft.key,
      ...(draft.nonce && { nonce: fromBase64url(draft.nonce) }),
      ...(draft.ownerKey && {
        owner_key: decode<MusicKey>("publications.music_key", fromBase64url(draft.ownerKey)),
      }),
      ...(draft.keyHash && { key_hash: fromBase64url(draft.keyHash) }),
      mime: draft.mime,
      duration_ms: draft.durationMs,
      config_revision: draft.configRevision,
      max_fee: draft.fee,
    };
    await submitAction(ctx, await musicPaymentOperations(client, args, config.native_token), {
      label: "Paying for music upload",
      quietProgress: true,
      beforeSubmit: async () => assertActive(),
    });
    record = (await client.reads.publications.get_music({ id }))?.value;
    if (!record) throw new Error("Payment is still confirming. Resume this saved upload shortly.");
  }
  if (!matchesMusic(draft, record)) throw new Error("Music reservation changed unexpectedly.");
  progress(record.received, chunks.length, true);
  // A saved v1/v2 draft remains resumable after either end is upgraded. Never send
  // an oversized batch to an older contract or sponsor during a staged rollout.
  const config = await musicConfig(client);
  let batchSize = Math.min(
    [1, 4, 8, MUSIC_BATCH_CHUNKS].includes(draft.batchSize ?? 1) ? (draft.batchSize ?? 1) : 1,
    musicBatchChunks(config.version)
  );
  if (batchSize > 4 && ctx.payment !== "self-only") {
    let supported = 4;
    for (const sponsor of client.sponsors.sponsors) {
      try {
        const discovery = await sponsor.discover();
        if (discovery.sponsor !== draft.recipient || discovery.network.chainId !== client.chainId) continue;
        const max = discovery.policy.version >= 4 ? MUSIC_BATCH_CHUNKS : 4;
        supported = [MUSIC_BATCH_CHUNKS, 8, 4, 1].find(n => n <= max && n * (MUSIC_CHUNK_BYTES + 4) + 512 <= discovery.policy.maxBytesPerOp) ?? 1;
        break;
      } catch { /* Submission handles sponsor availability; retain the v2 ceiling. */ }
    }
    batchSize = Math.min(batchSize, supported);
  }
  for (let index = record.received; index < chunks.length; index += batchSize) {
    assertActive();
    const batch = chunks.slice(index, index + batchSize);
    const op =
      batchSize > 1
        ? await client.ops.publications.append_music_batch({
            owner: draft.owner,
            id,
            index,
            chunks: batch,
          })
        : await client.ops.publications.append_music({
            owner: draft.owner,
            id,
            index,
            data: batch[0]!,
          });
    await submitAction(ctx, [op], {
      label: `Uploading audio ${index + batch.length}/${chunks.length}`,
      quietProgress: true,
      beforeSubmit: async () => assertActive(),
    });
    progress(index + batch.length, chunks.length, true);
  }
  const complete = (await client.reads.publications.get_music({ id }))?.value;
  if (!complete || complete.received !== chunks.length)
    throw new Error("The last chunk is still confirming. Resume to check completion.");
  if (!matchesMusic(draft, complete)) throw new Error("Completed music does not match this upload.");
  const verified = verifyMusic(complete, chunks);
  await musicCache()?.put(musicCacheKey(client, id, complete.digest), verified);
}
export async function loadMusic(
  client: ProtocolClient,
  id: string,
  signal?: AbortSignal,
  progress?: (received: number, total: number) => void
): Promise<{ record: MusicRecord; bytes: Uint8Array }> {
  let stopped = false;
  const check = () => {
    if (signal?.aborted || stopped) throw new Error("Audio loading cancelled.");
  };
  check();
  const key = fromBase64url(id),
    record = (await client.reads.publications.get_music({ id: key }))?.value;
  if (
    !record ||
    record.received !== record.chunk_hashes.length ||
    record.size < 1 ||
    record.size > MUSIC_MAX_BYTES ||
    record.chunk_hashes.length !== Math.ceil(record.size / MUSIC_CHUNK_BYTES)
  )
    throw new Error("This track is not ready to play.");
  check();
  const cache = musicCache(),
    cacheKey = musicCacheKey(client, key, record.digest),
    cached = await cache?.get(cacheKey);
  check();
  if (cached) {
    try {
      const bytes = verifyMusic(record, musicChunks(cached));
      progress?.(record.received, record.received);
      return { record, bytes };
    } catch { await cache?.remove(cacheKey); }
  }
  const config = await musicConfig(client);
  let batchSize = config.version >= 3 ? MUSIC_READ_BATCH_CHUNKS : 1;
  let gatewayEnabled = hasMusicGateway(client);
  const chunks = new Array<Uint8Array>(record.chunk_hashes.length);
  const validChunk = (chunk: Uint8Array | undefined, i: number): chunk is Uint8Array =>
    chunk instanceof Uint8Array && chunk.length === Math.min(MUSIC_CHUNK_BYTES, record.size - i * MUSIC_CHUNK_BYTES) && bytesEqual(contentHash(chunk), record.chunk_hashes[i]!);
  let cursor = 0,
    received = 0;
  for (const [i, chunk] of (await cache?.getPartial(cacheKey, chunks.length)) ?? []) {
    if (validChunk(chunk, i)) { chunks[i] = chunk; received++; }
  }
  check();
  if (received) progress?.(received, chunks.length);
  // Probe once so a cold/older server immediately restores four-way chain reads.
  if (gatewayEnabled && received < chunks.length) {
    let first = 0;
    while (chunks[first]) first++;
    let end = Math.min(first + 64, chunks.length);
    for (let i = first + 1; i < end; i++) if (chunks[i]) { end = i; break; }
    const probe = await readMusicGateway(client, key, record, first, end - first, signal);
    check();
    if (probe) {
      probe.forEach((chunk, offset) => { chunks[first + offset] = chunk; });
      await cache?.putPartial(cacheKey, first, probe);
      received += probe.length;
      progress?.(received, chunks.length);
    } else gatewayEnabled = false;
  }
  let firstError: unknown;
  const outcomes = await Promise.allSettled(
    Array.from({ length: Math.min(4, Math.ceil(chunks.length / (gatewayEnabled ? 64 : batchSize))) }, () => (async () => {
      while (cursor < chunks.length) {
        check();
        while (cursor < chunks.length && chunks[cursor]) cursor++;
        if (cursor >= chunks.length) break;
        let index = cursor;
        let end = Math.min(index + (gatewayEnabled ? 64 : batchSize), chunks.length);
        for (let i = index + 1; i < end; i++) if (chunks[i]) { end = i; break; }
        cursor = end;
        // Keep ownership of this range while retrying, so concurrent workers
        // cannot skip or duplicate chunks when the RPC needs a smaller batch.
        while (index < end) {
          check();
          let count = Math.min(gatewayEnabled ? 64 : batchSize, end - index);
          let result: Array<Uint8Array | undefined> | undefined;
          if (gatewayEnabled) {
            result = await readMusicGateway(client, key, record, index, count, signal);
            check();
            if (!result) { gatewayEnabled = false; count = Math.min(batchSize, end - index); }
          }
          try {
            result ??= count > 1
              ? (await client.reads.publications.get_music_chunks({ id: key, index, count }))?.chunks
              : [(await client.reads.publications.get_music_chunk({ id: key, index }))?.data];
          } catch (error) {
            check();
            // Only retry an explicit RPC compute limit. Corrupt responses,
            // missing chunks and other errors must still fail verification.
            if (count > 1 && error instanceof Error && /compute bandwidth limit exceeded/i.test(error.message)) {
              batchSize = Math.min(batchSize, Math.max(1, Math.floor(count / 2)));
              continue;
            }
            throw error;
          }
          check();
          if (!result || result.length !== count)
            throw new Error("An audio chunk is unavailable. Retry loading the track.");
          for (let offset = 0; offset < count; offset++) {
            const chunk = result[offset], i = index + offset;
            if (!validChunk(chunk, i))
              throw new Error("Audio chunk verification failed.");
            chunks[i] = chunk;
          }
          await cache?.putPartial(cacheKey, index, result as Uint8Array[]);
          check();
          index += count;
          received += count;
          progress?.(received, chunks.length);
        }
      }
    })().catch(error => { firstError ??= error; stopped = true; throw error; }))
  );
  const failure = outcomes.find(outcome => outcome.status === "rejected");
  if (failure?.status === "rejected") throw firstError ?? failure.reason;
  check();
  const bytes = verifyMusic(record, chunks);
  await cache?.put(cacheKey, bytes);
  check();
  return { record, bytes };
}
