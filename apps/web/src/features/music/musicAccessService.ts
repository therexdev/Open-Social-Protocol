import {
  bytesEqual,
  contentHash,
  fromBase64url,
  musicCipher,
  musicKeyContext,
  openMusicKey,
  sealMusicKey,
  toBase64url,
  type MusicAccess,
  type MusicRecord,
  type ProtocolClient,
  type Recipient,
} from "@osp/sdk";
import type { Session } from "../../vault/store";
import type { Services } from "../../api/services";
import { submitAction, type SubmitContext } from "../../tx/submit";
import { collectRecipients } from "../composer/publish";
import { loadMusic, type MusicDraft } from "./musicService";

export const trackContext = (client: ProtocolClient, id: string, owner: string) =>
  musicKeyContext(
    client.chainId,
    client.deployment.contracts.publications.address,
    fromBase64url(id),
    owner
  );
export async function readingKey(
  client: ProtocolClient,
  id: string,
  record: MusicRecord,
  session?: Session
): Promise<Uint8Array | undefined> {
  if (!record.encrypted) return undefined;
  if (!session) throw new Error("Unlock your account to listen to this track.");
  let sealed = record.owner_key;
  if (session.identity.account !== record.owner) {
    const access = await client.reads.publications.get_music_access({
      id: fromBase64url(id),
      buyer: session.identity.account,
    });
    if (!access?.eligible) throw new Error("This track is not shared with your account.");
    if (access.value?.status !== 2 || !access.value.key)
      throw new Error("Open the track page to request access or check delivery.");
    sealed = access.value.key;
  }
  if (!sealed || !record.key_hash) throw new Error("The track reading key is unavailable.");
  return openMusicKey(
    trackContext(client, id, record.owner),
    sealed,
    session.identity.account,
    session.identity.seed,
    record.key_hash
  );
}
export async function playableMusic(
  client: ProtocolClient,
  id: string,
  session?: Session,
  signal?: AbortSignal,
  progress?: (n: number, total: number) => void
) {
  const record = (await client.reads.publications.get_music({ id: fromBase64url(id) }))?.value;
  if (!record) throw new Error("Track not found.");
  const key = await readingKey(client, id, record, session);
  try {
    const loaded = await loadMusic(client, id, signal, progress);
    if (!bytesEqual(loaded.record.digest, record.digest))
      throw new Error("Track changed while loading.");
    return {
      record,
      bytes: key
        ? musicCipher(trackContext(client, id, record.owner), key, record.nonce!).decrypt(
            loaded.bytes
          )
        : loaded.bytes,
    };
  } finally {
    key?.fill(0);
  }
}
async function grant(
  ctx: SubmitContext,
  session: Session,
  id: string,
  record: MusicRecord,
  recipient: Recipient,
  assertActive: () => void
) {
  assertActive();
  const access = await ctx.client.reads.publications.get_music_access({
    id: fromBase64url(id),
    buyer: String(recipient.address),
  });
  if (!access?.eligible || access.value?.status === 2) return;
  const key = await readingKey(ctx.client, id, record, session);
  if (!key) throw new Error("This track does not need a reading key.");
  try {
    const sealed = sealMusicKey(trackContext(ctx.client, id, record.owner), key, recipient);
    assertActive();
    await submitAction(
      ctx,
      [
        await ctx.client.ops.publications.grant_music_access({
          owner: record.owner,
          id: fromBase64url(id),
          buyer: recipient.address,
          key: sealed,
        }),
      ],
      {
        label: "Delivering music access",
        quietProgress: true,
        beforeSubmit: async () => assertActive(),
      }
    );
  } finally {
    key.fill(0);
  }
}
/** Free private tracks are shared immediately with the verified upload-time audience. */
export async function shareFreeMusic(
  services: Services,
  ctx: SubmitContext,
  session: Session,
  draft: MusicDraft,
  assertActive: () => void
) {
  if (!draft.key || BigInt(draft.unlockPrice ?? "0") > 0n) return;
  const client = ctx.client,
    id = fromBase64url(draft.id),
    record = (await client.reads.publications.get_music({ id }))?.value;
  if (!record || record.owner !== session.identity.account)
    throw new Error("Track ownership could not be verified.");
  let recipients: Recipient[] = [];
  if (draft.audience === 1) {
    const result = await collectRecipients({
      chain: client,
      indexer: services.indexer,
      me: session.identity,
    });
    if (result.skipped.length)
      throw new Error(
        "Some friends need registered encryption keys. Your audio is saved; resume sharing after they register."
      );
    recipients = result.recipients;
  } else if (draft.audience === 2) {
    const group = (
      await client.reads.publications.get_collection({ id: fromBase64url(draft.groupId!) })
    )?.value;
    if (
      !group ||
      group.closed ||
      group.kind !== 2 ||
      ![group.owner, ...group.members].includes(record.owner)
    )
      throw new Error("This group is no longer available to you.");
    for (const account of new Set([group.owner, ...group.members])) {
      if (account === record.owner) continue;
      const identity = (await client.reads.identity.get_identity({ account }))?.value;
      if (!identity || identity.encryption_key.length !== 32)
        throw new Error(
          "A group member needs a registered encryption key. Resume sharing after they register."
        );
      recipients.push({
        address: account,
        publicKey: identity.encryption_key,
        keyVersion: identity.key_version,
      });
    }
  }
  for (const recipient of recipients)
    await grant(ctx, session, draft.id, record, recipient, assertActive);
}
export async function deliverMusicRequest(
  ctx: SubmitContext,
  session: Session,
  request: MusicAccess,
  assertActive: () => void = () => {}
) {
  const id = toBase64url(request.id),
    record = (await ctx.client.reads.publications.get_music({ id: request.id }))?.value;
  if (!record || record.owner !== session.identity.account)
    throw new Error("This track is not yours.");
  const current = await ctx.client.reads.publications.get_music_access({
    id: request.id,
    buyer: request.buyer,
  });
  if (
    !current?.eligible ||
    current.value?.status !== 1 ||
    BigInt(current.now) >= BigInt(current.value.expires_at)
  )
    return;
  await grant(
    ctx,
    session,
    id,
    record,
    {
      address: request.buyer,
      publicKey: current.value.public_key,
      keyVersion: current.value.key_version,
    },
    assertActive
  );
}
