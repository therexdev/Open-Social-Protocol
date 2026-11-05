import {
  AUDIENCE,
  buildKeyPackageSets,
  bytesEqual,
  contentHash,
  decryptContent,
  decodeEnvelope,
  encryptContent,
  fromBase64url,
  newEpochKey,
  parsePhotoLocation,
  photoCost,
  requirePhotoLibrary,
  toBase64url,
  unwrapContentKey,
  unwrapMediaKey,
  utf8,
  type AadInput,
  type CollectionRecord,
  type Content,
  type OperationJson,
  type Recipient,
} from "@osp/sdk";
import type { Services } from "../../api/services";
import { chainKeyVerifier } from "../../api/keyProvenance";
import type { OpenedContent } from "../../api/decrypt";
import type { Session } from "../../vault/store";
import { submitAction, type SubmitContext } from "../../tx/submit";
import { buildContent, type MediaAttachment } from "../composer/publish";
import { archivePhoto } from "../composer/archivePhoto";

export interface Collection {
  id: string;
  record: CollectionRecord;
  name: string;
  banner?: MediaAttachment;
}
export interface LibraryContext {
  services: Services;
  session?: Session;
  submit?: SubmitContext;
  assertActive?: () => void;
}
const protocol = (ctx: LibraryContext) => {
  if (!ctx.services.protocol) throw new Error("The network is unavailable.");
  return ctx.services.protocol;
};
export function canReadCollection(
  record: CollectionRecord,
  account?: string
): boolean {
  return (
    !record.closed &&
    (record.audience === AUDIENCE.EVERYONE ||
      (!!account &&
        (record.owner === account || record.members.includes(account))))
  );
}
function aad(
  ctx: LibraryContext,
  collection: Collection,
  epoch: number,
  itemId?: string
): AadInput {
  return {
    chainId: protocol(ctx).chainId,
    author: collection.record.owner,
    audience: collection.record.audience,
    audienceId: fromBase64url(collection.id),
    epoch,
    postId: fromBase64url(itemId ?? collection.id),
    versionNumber: 2,
  };
}
async function epochKey(
  ctx: LibraryContext,
  collection: Collection,
  epoch: number
): Promise<Uint8Array | undefined> {
  if (collection.record.audience === AUDIENCE.EVERYONE) return undefined;
  if (
    !ctx.session ||
    !canReadCollection(collection.record, ctx.session.identity.account)
  )
    throw new Error("This collection is not shared with your account.");
  const result = await ctx.session.keys.resolveTrusted(
    {
      author: collection.record.owner,
      audienceId: fromBase64url(collection.id),
      epoch,
    },
    ctx.session.identity,
    ctx.services.indexer,
    chainKeyVerifier(protocol(ctx))
  );
  if (!result.entry)
    throw new Error("The reading key is still confirming. Retry in a moment.");
  return result.entry.key;
}
async function open(
  ctx: LibraryContext,
  collection: Collection,
  bytes: Uint8Array,
  epoch: number,
  itemId?: string
): Promise<OpenedContent> {
  const envelope = decodeEnvelope(bytes),
    key = await epochKey(ctx, collection, epoch),
    context = aad(ctx, collection, epoch, itemId);
  if (collection.record.audience !== AUDIENCE.EVERYONE && envelope.suite !== 1)
    throw new Error("Invalid private collection envelope.");
  const content = decryptContent({
    envelope,
    epochKey: key,
    aad: context,
  }) as OpenedContent;
  if (key && content.media.some((m) => m.wrapped_key?.length)) {
    const ck = unwrapContentKey(envelope, key, context);
    try {
      content.media = content.media.map((m) =>
        m.wrapped_key?.length
          ? {
              ...m,
              mediaKey: unwrapMediaKey(m.wrapped_key, ck, m.content_hash),
            }
          : m
      );
    } finally {
      ck.fill(0);
    }
  }
  return content;
}
export async function readCollection(
  ctx: LibraryContext,
  id: string
): Promise<Collection> {
  const record = (
    await protocol(ctx).reads.publications.get_collection({
      id: fromBase64url(id),
    })
  )?.value;
  if (!record || !canReadCollection(record, ctx.session?.identity.account))
    throw new Error(
      "This collection is unavailable or no longer shared with you."
    );
  const collection = { id, record, name: "" },
    content = await open(ctx, collection, record.envelope, record.revision);
  if (content.mime !== "application/vnd.osp.collection+json")
    throw new Error("Unsupported collection metadata.");
  const data: unknown = JSON.parse(content.text);
  if (
    !data ||
    typeof data !== "object" ||
    !("name" in data) ||
    typeof data.name !== "string" ||
    !data.name.trim() ||
    data.name.length > 120
  )
    throw new Error("Invalid collection name.");
  const bannerIndex = "banner" in data ? data.banner : undefined;
  if (bannerIndex !== undefined && (record.kind !== 2 || bannerIndex !== 0 || content.media.length !== 1))
    throw new Error("Invalid group banner metadata.");
  const banner = bannerIndex === 0 ? attachmentFromContent(content, 0) : undefined;
  if (banner) validateBanner(ctx, banner);
  return { ...collection, name: data.name, ...(banner && { banner }) };
}
function validateBanner(ctx: LibraryContext, banner: MediaAttachment) {
  parsePhotoLocation(banner.url, protocol(ctx).deployment.contracts.publications.address);
  photoCost(banner.size);
  if (banner.mime !== "image/jpeg" || banner.contentHash.length !== 32 ||
      !banner.encryption || fromBase64url(banner.encryption.key).length !== 32 ||
      fromBase64url(banner.encryption.nonce).length !== 24)
    throw new Error("Group banners must be encrypted photos stored on this network.");
}
async function recipientKeys(
  ctx: LibraryContext,
  accounts: string[]
): Promise<Recipient[]> {
  const result: Recipient[] = [];
  for (const account of [...new Set(accounts)]) {
    const record = (
      await protocol(ctx).reads.identity.get_identity({ account })
    )?.value;
    if (!record || record.encryption_key.length !== 32)
      throw new Error(`Account ${account} needs a registered encryption key.`);
    result.push({
      address: account,
      publicKey: record.encryption_key,
      keyVersion: record.key_version || 1,
    });
  }
  return result;
}
async function keyOperations(
  ctx: LibraryContext,
  collection: Collection,
  epoch: number,
  key: Uint8Array,
  recipients: Recipient[]
): Promise<OperationJson[]> {
  const ops: OperationJson[] = [];
  if (!recipients.length) return ops;
  for (const set of buildKeyPackageSets({
    author: collection.record.owner,
    audienceId: fromBase64url(collection.id),
    epoch,
    epochKey: key,
    recipients,
  }))
    ops.push(
      await protocol(ctx).ops.publications.distribute_keys({
        author: collection.record.owner,
        audience_id: fromBase64url(collection.id),
        epoch,
        packages: set.bytes,
      })
    );
  return ops;
}
export async function saveCollection(
  ctx: LibraryContext,
  input: {
    id: string;
    name: string;
    kind: number;
    audience: number;
    members: string[];
    previous?: Collection;
    /** Undefined keeps the current banner; null removes it. */
    banner?: MediaAttachment | null;
  }
): Promise<void> {
  if (!ctx.session || !ctx.submit)
    throw new Error("Unlock your account first.");
  await requirePhotoLibrary(protocol(ctx));
  const owner = ctx.session.identity.account,
    previous = input.previous,
    revision = (previous?.record.revision ?? 0) + 1;
  if (previous && previous.record.owner !== owner)
    throw new Error("Only the owner can update this collection.");
  if (previous && (previous.id !== input.id || previous.record.kind !== input.kind || previous.record.audience !== input.audience))
    throw new Error("The collection identity and visibility cannot be changed.");
  const banner = input.banner === undefined ? previous?.banner : input.banner ?? undefined;
  if (banner) {
    if (input.kind !== 2 || input.audience !== AUDIENCE.CUSTOM)
      throw new Error("Banners are supported for private groups.");
    validateBanner(ctx, banner);
  }
  const checkCurrent = async () => {
    ctx.assertActive?.();
    const current = (await protocol(ctx).reads.publications.get_collection({ id: fromBase64url(input.id) }))?.value;
    if (previous ? !current || current.closed || current.owner !== owner || current.revision !== previous.record.revision : !!current)
      throw new Error("This collection changed. Reload it before saving this edit.");
    ctx.assertActive?.();
  };
  if (!input.name.trim() || input.name.length > 120)
    throw new Error("Enter a name of 1–120 characters.");
  const members = [...new Set(input.members)].filter((a) => a !== owner);
  if (members.length > 50) throw new Error("Select at most 50 accounts.");
  const record: CollectionRecord = {
    owner,
    kind: input.kind,
    audience: input.audience,
    members,
    revision,
    envelope: new Uint8Array(),
    closed: false,
  };
  const collection: Collection = {
    id: input.id,
    name: input.name.trim(),
    record,
  };
  const recipients =
    record.audience === AUDIENCE.CUSTOM
      ? await recipientKeys(ctx, [owner, ...members])
      : [];
  await checkCurrent();
  // The editor saves the encrypted upload draft first; retries reuse the same
  // photo id, ciphertext and key instead of reserving storage a second time.
  if (banner?.archiveBytes) await archivePhoto(banner, ctx.submit, owner, ctx.assertActive);
  const key = record.audience === AUDIENCE.CUSTOM ? newEpochKey() : undefined;
  // Give added album members access to previous album entries, not to other
  // private posts. Groups intentionally give new members future posts only.
  const added =
    previous && previous.record.kind === 1 && previous.record.audience === AUDIENCE.CUSTOM
      ? members.filter((a) => !previous.record.members.includes(a))
      : [];
  if (added.length && previous) {
    const newRecipients = recipients.filter((r) =>
      added.includes(String(r.address))
    );
    // Resolve and verify ALL historical keys before disclosing any of them.
    const historical: OperationJson[] = [];
    for (let epoch = 1; epoch <= previous.record.revision; epoch++) {
      const oldKey = await epochKey(ctx, previous, epoch);
      historical.push(
        ...(await keyOperations(ctx, previous, epoch, oldKey!, newRecipients))
      );
    }
    for (let i = 0; i < historical.length; i += 3) {
      ctx.assertActive?.();
      await submitAction(ctx.submit, historical.slice(i, i + 3), {
        label: "Sharing earlier album contents",
        success: "Earlier reading keys shared",
        quietProgress: true,
        beforeSubmit: checkCurrent,
      });
    }
  }
  const contentKey = key ? newEpochKey() : undefined;
  const metadata: Content = buildContent({
    text: JSON.stringify({ name: collection.name, ...(banner && { banner: 0 }) }),
    media: banner ? [banner] : [],
  }, contentKey);
  metadata.mime = "application/vnd.osp.collection+json";
  const envelope = encryptContent({
    content: metadata,
    contentKey,
    epochKey: key,
    aad: aad(ctx, collection, revision),
  }).bytes;
  const ops = key
    ? await keyOperations(ctx, collection, revision, key, recipients)
    : [];
  ops.push(
    await protocol(ctx).ops.publications.save_collection({
      owner,
      id: fromBase64url(input.id),
      previous_revision: revision - 1,
      kind: record.kind,
      audience: record.audience,
      members,
      envelope,
    })
  );
  ctx.assertActive?.();
  await submitAction(ctx.submit, ops, {
    label: "Saving collection and access",
    success: "Collection saved",
    beforeSubmit: checkCurrent,
  });
  if (key)
    await ctx.session.keys.put(
      { author: owner, audienceId: fromBase64url(input.id), epoch: revision },
      key,
      { recipients: [owner, ...members] }
    );
}
export async function readAlbumPhoto(
  ctx: LibraryContext,
  collection: Collection,
  id: string
): Promise<{ id: string; revision: number; content: OpenedContent }> {
  // Re-read current membership; never let a stale directory supply access.
  const current = await readCollection(ctx, collection.id);
  const item = (
    await protocol(ctx).reads.publications.get_album_item({
      collection_id: fromBase64url(collection.id),
      id: fromBase64url(id),
    })
  )?.value;
  if (!item || item.removed) throw new Error("Photo removed from this album.");
  return {
    id,
    revision: item.revision,
    content: await open(ctx, current, item.envelope, item.epoch, id),
  };
}
export async function putAlbumPhoto(
  ctx: LibraryContext,
  collection: Collection,
  media: MediaAttachment,
  id = toBase64url(contentHash(utf8(media.url)))
): Promise<void> {
  if (
    !ctx.session ||
    !ctx.submit ||
    ctx.session.identity.account !== collection.record.owner
  )
    throw new Error("Only the album owner can add photos.");
  const current = await readCollection(ctx, collection.id),
    epoch = current.record.revision;
  if (current.record.audience === AUDIENCE.CUSTOM && !media.encryption)
    throw new Error(
      "This photo is already public. Upload a private copy before adding it to a private album."
    );
  if (current.record.audience === AUDIENCE.EVERYONE && media.encryption)
    throw new Error(
      "A private photo cannot be added to a public album. Upload a public copy explicitly."
    );
  const key = await epochKey(ctx, current, epoch),
    ck = key ? newEpochKey() : undefined;
  const content = buildContent({ text: "", media: [media] }, ck),
    envelope = encryptContent({
      content,
      contentKey: ck,
      epochKey: key,
      aad: aad(ctx, current, epoch, id),
    }).bytes;
  const old = (
    await protocol(ctx).reads.publications.get_album_item({
      collection_id: fromBase64url(current.id),
      id: fromBase64url(id),
    })
  )?.value;
  if (old && !old.removed) return;
  ctx.assertActive?.();
  await submitAction(
    ctx.submit,
    [
      await protocol(ctx).ops.publications.set_album_item({
        owner: ctx.session.identity.account,
        collection_id: fromBase64url(current.id),
        id: fromBase64url(id),
        epoch,
        previous_revision: old?.revision ?? 0,
        envelope,
      }),
    ],
    {
      label: "Adding photo to album",
      success: "Photo added",
      beforeSubmit: async () => ctx.assertActive?.(),
    }
  );
}
export async function removeAlbumPhoto(
  ctx: LibraryContext,
  collection: Collection,
  id: string,
  revision: number
): Promise<void> {
  if (
    !ctx.session ||
    !ctx.submit ||
    ctx.session.identity.account !== collection.record.owner
  )
    throw new Error("Only the album owner can remove photos.");
  const current = await readCollection(ctx, collection.id);
  await submitAction(
    ctx.submit,
    [
      await protocol(ctx).ops.publications.set_album_item({
        owner: ctx.session.identity.account,
        collection_id: fromBase64url(collection.id),
        id: fromBase64url(id),
        epoch: current.record.revision,
        previous_revision: revision,
        removed: true,
      }),
    ],
    {
      label: "Removing photo from album",
      success: "Photo removed from album",
      beforeSubmit: async () => ctx.assertActive?.(),
    }
  );
}
export function attachmentFromContent(
  content: OpenedContent,
  index: number
): MediaAttachment {
  const m = content.media[index]!;
  return {
    url: m.locations[0] ?? "",
    mime: m.mime,
    size: Number(m.size),
    contentHash: m.content_hash,
    altText: m.alt_text,
    ...(m.mediaKey && {
      encryption: { key: toBase64url(m.mediaKey), nonce: toBase64url(m.nonce) },
    }),
  };
}
