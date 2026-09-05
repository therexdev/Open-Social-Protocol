/**
 * Chain writes performed by the service worker: publishing a post (with audience keys for
 * friends-only posts), authorizing the device key, recording cross-post proofs and checking the
 * device's authority. Everything is signed here with the device key; the owner key is used only
 * to authorize the device (spec sections 3, 5, 6, 8).
 */
import {
  AUDIENCE,
  CAPABILITY,
  OUTCOME,
  TransactionOutcomeUnknownError,
  TransactionRevertedError,
  SponsorError,
  buildKeyPackageSets,
  buildProofManifest,
  contentHash as hashOf,
  encryptContent,
  idempotencyKey,
  manifestHash,
  newEpochKey,
  postId as computePostId,
  signProofManifest,
  toHex,
  type OperationJson,
  type ProtocolClient,
  type Signer,
} from "@osp/sdk";
import { bytesOf, fromHex, toBase64url } from "../shared/bytes";
import { DEVICE_EXPIRY_MS, DEVICE_LABEL } from "../shared/config";
import type { IndexerClient } from "../shared/indexer";
import type { DeviceInfo, DeviceStatusView, StoredCrossPost } from "../shared/protocol";
import type { PaymentPreference } from "../shared/settings";
import { submitPaymentOptions } from "./clients";
import type { KeyStore } from "./keystore";
import { DEVICE_CAPABILITIES, type UnlockedSession, type VaultManager } from "./vault";

export interface PublishContext {
  client: ProtocolClient;
  indexer: IndexerClient;
  session: UnlockedSession;
  vault: VaultManager;
  keys: KeyStore;
  payment: PaymentPreference;
  now?: () => number;
}

export interface PublishInput {
  text: string;
  audience: number;
  /** hex, 16 bytes; the idempotency key derives from it. Persist it before calling. */
  attemptId: string;
  externalRef?: string;
}

export interface PublishOutcome {
  txId: string;
  /** hex */
  postId: string;
  /** hex */
  contentHash: string;
  sequence: string;
  epoch: number;
  versionNumber: 1;
  sponsored: boolean;
}

export type SubmitFailureKind = "unknown" | "duplicate" | "failed";

/** Maps a `ProtocolClient.submit` failure to the reconcile event it deserves (spec section 7). */
export function classifySubmitError(error: unknown): { kind: SubmitFailureKind; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof TransactionOutcomeUnknownError) return { kind: "unknown", message };
  if (error instanceof TransactionRevertedError) {
    return /duplicate idempotency key/i.test(message) ? { kind: "duplicate", message } : { kind: "failed", message };
  }
  if (/duplicate idempotency key/i.test(message)) return { kind: "duplicate", message };
  if (error instanceof SponsorError) return { kind: "failed", message: `Sponsor refused (${error.category}): ${message}` };
  if (/timeout|timed out|deadline|network|failed to fetch|aborted|ECONNRESET|socket/i.test(message)) return { kind: "unknown", message };
  return { kind: "failed", message };
}

function deviceSigner(ctx: Pick<PublishContext, "vault" | "session">): Signer {
  return ctx.vault.signers(ctx.session).device;
}

interface EpochKeyPlan {
  epoch: number;
  epochKey: Uint8Array;
  operations: OperationJson[];
  /** True when the key is new and must be cached after the transaction succeeds. */
  created: boolean;
}

/** The current friends epoch key: cached, resolvable from the indexer, or freshly created and sealed to me + friends. */
async function friendsEpochKey(ctx: PublishContext): Promise<EpochKeyPlan> {
  const author = ctx.session.account;
  const audience = await ctx.client.reads.relationships.get_audience({ account: author });
  const epoch = audience?.value?.epoch ?? 0;
  const ref = { author, audienceId: new Uint8Array(0), epoch };
  const me = { account: author, encryption: ctx.vault.encryption(ctx.session) };
  const existing = ctx.keys.get(ref) ?? (await ctx.keys.resolve(ref, me, ctx.indexer));
  if (existing) return { epoch, epochKey: existing, operations: [], created: false };

  let graph;
  try {
    graph = await ctx.indexer.graph(author);
  } catch (error) {
    throw new Error(`Friends-only posts need the indexer to find your friends' keys: ${error instanceof Error ? error.message : String(error)}`);
  }
  const recipients = [{ address: author, publicKey: me.encryption.publicKey, keyVersion: me.encryption.keyVersion }];
  for (const friend of graph.friends ?? []) {
    const profile = await ctx.indexer.profile(friend.account);
    const publicKey = bytesOf(profile?.encryptionKey);
    if (profile && publicKey.length === 32) recipients.push({ address: friend.account, publicKey, keyVersion: profile.keyVersion || 1 });
  }
  const epochKey = newEpochKey();
  const sets = buildKeyPackageSets({ author, epoch, epochKey, recipients });
  const operations: OperationJson[] = [];
  for (const set of sets) {
    operations.push(await ctx.client.ops.publications.distribute_keys({ author, epoch, packages: set.bytes, device: ctx.session.deviceAddress }));
  }
  return { epoch, epochKey, operations, created: true };
}

/** Encrypts, builds ids and submits a first-version post signed by the device key. */
export async function publishPost(input: PublishInput, ctx: PublishContext): Promise<PublishOutcome> {
  const now = ctx.now ?? (() => Date.now());
  const author = ctx.session.account;
  const device = ctx.session.deviceAddress;
  if (input.audience !== AUDIENCE.EVERYONE && input.audience !== AUDIENCE.FRIENDS) throw new Error("Only Everyone and Friends audiences are supported here.");

  const state = await ctx.client.reads.publications.get_author_state({ author });
  let sequence = state?.value?.next_sequence ?? "1";
  if (!/^\d+$/.test(sequence) || sequence === "0") sequence = "1";

  const plan = input.audience === AUDIENCE.FRIENDS ? await friendsEpochKey(ctx) : undefined;
  const epoch = plan?.epoch ?? 0;
  const content = {
    version: 1,
    text: input.text,
    mime: "text/plain",
    created_at: String(now()),
    ...(input.externalRef && { external_ref: input.externalRef }),
  };
  const aad = { chainId: ctx.client.chainId, author, audience: input.audience, epoch, versionNumber: 1 };
  const encrypted = plan ? encryptContent({ content, aad, epochKey: plan.epochKey }) : encryptContent({ content });
  const contentHash = hashOf(encrypted.bytes);
  const postId = computePostId({ chainId: ctx.client.chainId, author, sequence, contentHash });
  const key = idempotencyKey(author, fromHex(input.attemptId));

  const publish = await ctx.client.ops.publications.publish({
    author,
    post_id: postId,
    sequence,
    audience: input.audience,
    epoch,
    envelope: encrypted.bytes,
    content_hash: contentHash,
    idempotency_key: key,
    device,
  });
  const result = await ctx.client.submit({
    operations: [...(plan?.operations ?? []), publish],
    signer: deviceSigner(ctx),
    ...submitPaymentOptions(ctx.payment),
  });
  if (plan?.created) await ctx.keys.put({ author, audienceId: new Uint8Array(0), epoch }, plan.epochKey);
  return {
    txId: result.transaction.id ?? "",
    postId: toHex(postId),
    contentHash: toHex(contentHash),
    sequence,
    epoch,
    versionNumber: 1,
    sponsored: result.sponsored,
  };
}

export interface AuthorizeDeviceContext {
  client: ProtocolClient;
  session: UnlockedSession;
  vault: VaultManager;
  payment: PaymentPreference;
  now?: () => number;
}

/**
 * `identity.authorize_device` signed by the owner key (registering the identity first when it
 * does not exist yet, in the same transaction). Returns the DeviceInfo to store in the vault.
 */
export async function authorizeDevice(ctx: AuthorizeDeviceContext): Promise<DeviceInfo & { registered: boolean }> {
  const now = ctx.now ?? (() => Date.now());
  const signers = ctx.vault.signers(ctx.session);
  if (!signers.owner) throw new Error("The identity seed is not in this browser; import the identity file to authorize this device.");
  const account = ctx.session.account;
  const device = ctx.session.deviceAddress;
  const encryption = ctx.vault.encryption(ctx.session);
  const identity = await ctx.client.reads.identity.get_identity({ account });
  const operations: OperationJson[] = [];
  const registered = !identity?.value;
  if (registered) {
    operations.push(await ctx.client.ops.identity.register({ account, encryption_key: encryption.publicKey, key_version: encryption.keyVersion }));
  }
  const expiresAt = String(now() + DEVICE_EXPIRY_MS);
  operations.push(
    await ctx.client.ops.identity.authorize_device({ account, device, capabilities: DEVICE_CAPABILITIES, expires_at: expiresAt, label: DEVICE_LABEL }),
  );
  const result = await ctx.client.submit({ operations, signer: signers.owner, ...submitPaymentOptions(ctx.payment) });
  return {
    address: device,
    capabilities: DEVICE_CAPABILITIES,
    expiresAt,
    authorizedAt: now(),
    txId: result.transaction.id ?? "",
    label: DEVICE_LABEL,
    registered,
  };
}

/** Checks the device record on chain (spec section 3.2 rules). */
export async function lookupDeviceStatus(client: ProtocolClient, account: string, device: string | undefined, now = Date.now()): Promise<DeviceStatusView> {
  const identity = await client.reads.identity.get_identity({ account });
  if (!identity?.value) return { device, registered: false, authorized: false, checkedAt: now, message: "This account is not registered on chain yet. Authorizing the device registers it." };
  if (!device) return { registered: true, authorized: false, checkedAt: now, message: "No device key in this browser." };
  const record = await client.reads.identity.get_device({ account, device });
  if (!record?.value) return { device, registered: true, authorized: false, checkedAt: now, message: "This browser's device key is not authorized on chain yet." };
  const expired = BigInt(record.value.expires_at || "0") <= BigInt(now);
  const epochMismatch = record.value.device_epoch !== identity.value.device_epoch;
  const revoked = record.value.revoked;
  const canPublish = (record.value.capabilities & CAPABILITY.PUBLISH) !== 0;
  const authorized = !expired && !epochMismatch && !revoked && canPublish;
  const message = revoked
    ? "This device was revoked. Import the identity file to authorize it again."
    : epochMismatch
      ? "All devices were voided by an account recovery. Import the identity file to authorize this browser again."
      : expired
        ? "The device authorization expired. Import the identity file to renew it."
        : !canPublish
          ? "This device cannot publish."
          : "Authorized on chain.";
  return { device, registered: true, authorized, revoked, expired, epochMismatch, expiresAt: record.value.expires_at, capabilities: record.value.capabilities, checkedAt: now, message };
}

export interface ProofContext {
  client: ProtocolClient;
  indexer: IndexerClient;
  session: UnlockedSession;
  vault: VaultManager;
  payment: PaymentPreference;
  now?: () => number;
}

/** Block height of a post from the indexer, then the node; "0" when neither knows yet. */
async function blockHeightOf(record: StoredCrossPost, ctx: ProofContext): Promise<string> {
  if (record.blockHeight && /^\d+$/.test(record.blockHeight)) return record.blockHeight;
  if (record.postId) {
    try {
      const view = await ctx.indexer.post(toBase64url(fromHex(record.postId)));
      if (view?.blockHeight && /^\d+$/.test(view.blockHeight)) return view.blockHeight;
    } catch {
      // indexer optional
    }
  }
  if (record.koinosTxId) {
    try {
      const txs = await ctx.client.provider.getTransactionsById([record.koinosTxId]);
      const blockId = txs?.transactions?.[0]?.containing_blocks?.[0];
      if (blockId) {
        const blocks = await ctx.client.provider.getBlocksById([blockId]);
        const height = blocks?.block_items?.[0]?.block_height;
        if (height !== undefined && /^\d+$/.test(String(height))) return String(height);
      }
    } catch {
      // node optional here
    }
  }
  return "0";
}

/** Signs the proof manifest (section 8) with the device key and records it with `record_cross_post`. */
export async function recordCrossPostProof(record: StoredCrossPost, ctx: ProofContext): Promise<{ manifestHash: string; txId: string; outcome: number }> {
  const now = ctx.now ?? (() => Date.now());
  if (!record.postId || !record.koinosTxId || !record.contentHash) throw new Error("The Koinos side is not known yet.");
  const author = ctx.session.account;
  const outcome = record.hostStatus === "failed" ? OUTCOME.PARTIAL : OUTCOME.SUCCEEDED;
  const externalRef = record.hostRef ?? record.url ?? "";
  const manifest = buildProofManifest({
    author,
    post_id: fromHex(record.postId),
    content_hash: fromHex(record.contentHash),
    version_number: record.versionNumber ?? 1,
    transaction_id: record.koinosTxId,
    block_height: await blockHeightOf(record, ctx),
    audience: record.audience,
    epoch: record.epoch ?? 0,
    adapter: record.adapter,
    external_ref: externalRef,
    outcome,
    idempotency_key: fromHex(record.idempotencyKey),
    created_at: now(),
  });
  const signed = await signProofManifest(manifest, deviceSigner(ctx));
  const hash = manifestHash(signed);
  const op = await ctx.client.ops.publications.record_cross_post({
    author,
    idempotency_key: fromHex(record.idempotencyKey),
    adapter: record.adapter,
    state: outcome,
    external_ref: externalRef,
    post_id: fromHex(record.postId),
    manifest_hash: hash,
    device: ctx.session.deviceAddress,
  });
  const result = await ctx.client.submit({ operations: [op], signer: deviceSigner(ctx), ...submitPaymentOptions(ctx.payment) });
  return { manifestHash: toHex(hash), txId: result.transaction.id ?? "", outcome };
}
