/**
 * Chain writes performed by the service worker: publishing a post (with audience keys for
 * friends-only posts), authorizing the device key, recording cross-post proofs and checking the
 * device's authority. Every protocol action is signed with the device key; the owner key is used
 * to authorize the device and, when the user kept the identity seed here, to pay for
 * transactions (spec sections 3, 5, 6, 8, 10).
 *
 * Trust: the indexer is an untrusted convenience (spec section 1). It may *suggest* who my
 * friends are, but every recipient of a friends epoch key is confirmed on chain
 * (`relationships.get_relationship` ACTIVE) and sealed to the encryption key the chain publishes
 * for that account (`identity.get_identity`), never to a key the indexer served.
 */
import {
  AUDIENCE,
  CAPABILITY,
  OUTCOME,
  RELATIONSHIP_STATUS,
  TransactionOutcomeUnknownError,
  TransactionRevertedError,
  SponsorError,
  buildKeyPackageSets,
  buildProofManifest,
  contentHash as hashOf,
  decodeReceiptEvents,
  encryptContent,
  idempotencyKey,
  isAddress,
  manifestHash,
  newEpochKey,
  postId as computePostId,
  signProofManifest,
  toHex,
  type OperationJson,
  type ProtocolClient,
  type Recipient,
  type Signer,
  type SubmitResult,
} from "@osp/sdk";
import { fromHex, toBase64url } from "../shared/bytes";
import { DEVICE_EXPIRY_MS, DEVICE_LABEL } from "../shared/config";
import { draftContent } from "../shared/draft";
import type { GraphView, IndexerClient } from "../shared/indexer";
import type { DeviceInfo, DeviceStatusView, StoredCrossPost } from "../shared/protocol";
import type { PaymentPreference } from "../shared/settings";
import { submitPaymentOptions } from "./clients";
import type { KeyStore } from "./keystore";
import { DEVICE_CAPABILITIES, type UnlockedSession, type VaultManager } from "./vault";

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

export interface PaymentContext {
  client: ProtocolClient;
  session: UnlockedSession;
  vault: VaultManager;
  payment: PaymentPreference;
  /** Sponsors the client is configured with (resolved settings); empty when none. */
  sponsorUrls: string[];
}

/** A transaction cannot be paid for with what this browser holds. Raised before anything is sent. */
export class PaymentError extends Error {
  override name = "PaymentError";
}

export const NO_SPONSOR_MESSAGE = "This browser publishes through a sponsor; add one in the options (it holds only a device key, which cannot pay for transactions).";

export type PaymentPlan = { mode: "sponsored"; selfPayFallback: boolean } | { mode: "self"; payer: Signer };

/**
 * How a device-signed transaction gets paid. A device key holds no KOIN or Mana, so self-pay
 * is possible only when the identity seed is kept here (the owner key signs as payer).
 */
export function paymentPlan(ctx: Pick<PaymentContext, "session" | "vault" | "payment" | "sponsorUrls">): PaymentPlan {
  const owner = ctx.vault.signers(ctx.session).owner;
  const sponsors = ctx.sponsorUrls.length > 0;
  if (ctx.payment === "self-only") {
    if (!owner) throw new PaymentError("This browser holds only a device key, which cannot pay for transactions. Choose a sponsored payment in the options, or keep the identity seed in this browser.");
    return { mode: "self", payer: owner };
  }
  if (!sponsors) {
    if (ctx.payment === "sponsor-only") throw new PaymentError("Sponsored only: add a sponsor in the options.");
    if (!owner) throw new PaymentError(NO_SPONSOR_MESSAGE);
    return { mode: "self", payer: owner };
  }
  return { mode: "sponsored", selfPayFallback: ctx.payment === "sponsor-then-self" && owner !== undefined };
}

/** Self-pay with the owner key as payer and the device key as payee (the device's nonce, both signatures). */
async function selfPayWithOwner(operations: OperationJson[], ctx: PaymentContext, device: Signer, owner: Signer): Promise<SubmitResult> {
  const prepared = await ctx.client.prepare(operations, { payee: device.getAddress(), payer: owner.getAddress() });
  const signed = await ctx.client.sign(await ctx.client.sign(prepared, device), owner);
  const { transaction, receipt } = await ctx.client.broadcast(signed);
  return { transaction, receipt, events: decodeReceiptEvents(receipt, ctx.client.deployment), rcUsed: receipt.rc_used ?? "0", sponsored: false, refusals: [] };
}

/** Submits device-signed operations following the payment plan. Throws `PaymentError` before sending when it cannot pay. */
export async function submitOperations(operations: OperationJson[], ctx: PaymentContext): Promise<SubmitResult> {
  const plan = paymentPlan(ctx);
  const device = ctx.vault.signers(ctx.session).device;
  if (plan.mode === "self") return selfPayWithOwner(operations, ctx, device, plan.payer);
  try {
    return await ctx.client.submit({ operations, signer: device, selfPayFallback: false });
  } catch (error) {
    if (error instanceof SponsorError && plan.selfPayFallback) {
      const owner = ctx.vault.signers(ctx.session).owner;
      if (owner) return selfPayWithOwner(operations, ctx, device, owner);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export interface PublishContext extends PaymentContext {
  indexer: IndexerClient;
  keys: KeyStore;
  now?: () => number;
}

export interface PublishInput {
  text: string;
  audience: number;
  /** hex, 16 bytes; the idempotency key derives from it. Persist it before calling. */
  attemptId: string;
  externalRef?: string;
}

/** What is known about a Koinos attempt before the node answers (persisted so lookups can match it). */
export interface PublishAttempt {
  /** hex */
  postId: string;
  /** hex */
  contentHash: string;
  sequence: string;
  epoch: number;
  versionNumber: 1;
  /** Transaction id, when the transaction was built before the failure. */
  transactionId?: string;
}

export interface PublishOutcome extends PublishAttempt {
  txId: string;
  sponsored: boolean;
}

/**
 * A failure raised by the submission step itself (after the envelope, ids and transaction were
 * built). Carries the attempt so the record keeps the content hash, expected post id and
 * transaction id even when the outcome is unknown. Errors raised earlier (reads, indexer,
 * encryption, payment) are thrown as they are: nothing was sent.
 */
export class PublishAttemptError extends Error {
  override name = "PublishAttemptError";
  constructor(
    override readonly cause: unknown,
    readonly attempt: PublishAttempt,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

export type SubmitFailureKind = "unknown" | "duplicate" | "failed";

export interface SubmitFailure {
  kind: SubmitFailureKind;
  message: string;
  /** Present when the failure happened at submission time. */
  attempt?: PublishAttempt;
}

const TRANSPORT_RE = /timeout|timed out|deadline|network|failed to fetch|aborted|ECONNRESET|socket/i;

/**
 * Maps a publication failure to the reconcile event it deserves (spec section 7). Only failures
 * of the submission itself can be "unknown": a transport error before anything was sent is a
 * plain failure that a retry can repeat safely.
 */
export function classifySubmitError(error: unknown): SubmitFailure {
  if (error instanceof PublishAttemptError) return { ...classify(error.cause, true), attempt: error.attempt };
  return classify(error, false);
}

function classify(error: unknown, submitted: boolean): SubmitFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof TransactionOutcomeUnknownError) return { kind: "unknown", message };
  if (error instanceof TransactionRevertedError) {
    return /duplicate idempotency key/i.test(message) ? { kind: "duplicate", message } : { kind: "failed", message };
  }
  if (/duplicate idempotency key/i.test(message)) return { kind: "duplicate", message };
  if (error instanceof SponsorError) return { kind: "failed", message: `Sponsor refused (${error.category}): ${message}` };
  if (submitted && TRANSPORT_RE.test(message)) return { kind: "unknown", message };
  return { kind: "failed", message };
}

function deviceSigner(ctx: Pick<PublishContext, "vault" | "session">): Signer {
  return ctx.vault.signers(ctx.session).device;
}

const FRIENDS_AUDIENCE_ID = new Uint8Array(0);

interface EpochKeyPlan {
  epoch: number;
  epochKey: Uint8Array;
  operations: OperationJson[];
  /** True when the key is new and must be cached after the transaction succeeds. */
  created: boolean;
}

/**
 * Recipients of a new friends epoch key: me plus every friend the chain confirms. The indexer
 * graph is only a candidate list; a candidate the chain does not confirm as ACTIVE, or whose
 * identity has no 32-byte encryption key on chain, is skipped. Keys are always the chain's.
 */
export async function verifiedFriendRecipients(ctx: Pick<PublishContext, "client" | "indexer" | "session" | "vault">): Promise<Recipient[]> {
  const me = ctx.session.account;
  const encryption = ctx.vault.encryption(ctx.session);
  let graph: GraphView;
  try {
    graph = await ctx.indexer.graph(me);
  } catch (error) {
    throw new Error(`Friends-only posts need the indexer to list your friends: ${error instanceof Error ? error.message : String(error)}`);
  }
  const recipients: Recipient[] = [{ address: me, publicKey: encryption.publicKey, keyVersion: encryption.keyVersion }];
  const seen = new Set<string>([me]);
  for (const candidate of graph.friends ?? []) {
    const friend = candidate?.account;
    if (typeof friend !== "string" || seen.has(friend) || !isAddress(friend)) continue;
    seen.add(friend);
    const relationship = (await ctx.client.reads.relationships.get_relationship({ a: me, b: friend }))?.value;
    if (!relationship || relationship.status !== RELATIONSHIP_STATUS.ACTIVE) continue;
    if (!(relationship.a === me && relationship.b === friend) && !(relationship.a === friend && relationship.b === me)) continue;
    const identity = (await ctx.client.reads.identity.get_identity({ account: friend }))?.value;
    const publicKey = identity?.encryption_key;
    if (!identity || !publicKey || publicKey.length !== 32) continue;
    recipients.push({ address: friend, publicKey, keyVersion: identity.key_version || 1 });
  }
  return recipients;
}

/**
 * The friends epoch key to encrypt with: the cached one, else the one the indexer serves sealed
 * to me. When neither exists the key of the current epoch may still exist elsewhere (another
 * device, an indexer that lags a `distribute_keys`), and spec 5.2 allows exactly one key per
 * epoch: instead of minting a second key for the same epoch, the audience is rotated and the
 * new epoch's key is minted and distributed in the same transaction as the post.
 */
async function friendsEpochKey(ctx: PublishContext): Promise<EpochKeyPlan> {
  const author = ctx.session.account;
  const device = ctx.session.deviceAddress;
  const audience = await ctx.client.reads.relationships.get_audience({ account: author });
  const epoch = audience?.value?.epoch ?? 0;
  const me = { account: author, encryption: ctx.vault.encryption(ctx.session) };
  const lookup = await ctx.keys.lookup({ author, audienceId: FRIENDS_AUDIENCE_ID, epoch }, me, ctx.indexer, { missCache: false });
  if (lookup.status === "found") return { epoch, epochKey: lookup.key, operations: [], created: false };
  if (lookup.status === "unavailable") {
    throw new Error(`Friends-only posts need the indexer to find your current friends key: ${lookup.error.message}`);
  }
  const recipients = await verifiedFriendRecipients(ctx);
  const nextEpoch = epoch + 1;
  const epochKey = newEpochKey();
  const sets = buildKeyPackageSets({ author, epoch: nextEpoch, epochKey, recipients });
  const operations: OperationJson[] = [await ctx.client.ops.relationships.rotate_audience({ actor: author, device })];
  for (const set of sets) {
    operations.push(await ctx.client.ops.publications.distribute_keys({ author, epoch: nextEpoch, packages: set.bytes, device }));
  }
  return { epoch: nextEpoch, epochKey, operations, created: true };
}

/** Encrypts, builds ids and submits a first-version post signed by the device key. */
export async function publishPost(input: PublishInput, ctx: PublishContext): Promise<PublishOutcome> {
  const now = ctx.now ?? (() => Date.now());
  const author = ctx.session.account;
  const device = ctx.session.deviceAddress;
  if (input.audience !== AUDIENCE.EVERYONE && input.audience !== AUDIENCE.FRIENDS) throw new Error("Only Everyone and Friends audiences are supported here.");
  paymentPlan(ctx); // fail before any read when this browser cannot pay

  const state = await ctx.client.reads.publications.get_author_state({ author });
  let sequence = state?.value?.next_sequence ?? "1";
  if (!/^\d+$/.test(sequence) || sequence === "0") sequence = "1";

  const plan = input.audience === AUDIENCE.FRIENDS ? await friendsEpochKey(ctx) : undefined;
  const epoch = plan?.epoch ?? 0;
  const content = draftContent(input.text, input.externalRef, String(now()));
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
  const attempt: PublishAttempt = { postId: toHex(postId), contentHash: toHex(contentHash), sequence, epoch, versionNumber: 1 };
  let result: SubmitResult;
  try {
    result = await submitOperations([...(plan?.operations ?? []), publish], ctx);
  } catch (error) {
    const transactionId = (error as { transaction?: { id?: string } } | null)?.transaction?.id;
    throw new PublishAttemptError(error, { ...attempt, ...(transactionId && { transactionId }) });
  }
  if (plan?.created) await ctx.keys.put({ author, audienceId: FRIENDS_AUDIENCE_ID, epoch }, plan.epochKey);
  return { ...attempt, txId: result.transaction.id ?? "", sponsored: result.sponsored };
}

// ---------------------------------------------------------------------------
// Device authorization
// ---------------------------------------------------------------------------

export interface AuthorizeDeviceContext {
  client: ProtocolClient;
  session: UnlockedSession;
  vault: VaultManager;
  payment: PaymentPreference;
  now?: () => number;
}

/**
 * `identity.authorize_device` signed by the owner key (registering the identity first when it
 * does not exist yet, in the same transaction). The owner pays when no sponsor takes it.
 * Returns the DeviceInfo to store in the vault.
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

// ---------------------------------------------------------------------------
// Proof manifests
// ---------------------------------------------------------------------------

export interface ProofContext extends PaymentContext {
  indexer: IndexerClient;
  now?: () => number;
}

export interface ProofResult {
  manifestHash: string;
  txId: string;
  outcome: number;
  /** The Koinos transaction id the manifest names (backfilled from the indexer when the record lacked it). */
  koinosTxId: string;
}

/** The indexer's view of the post; undefined when it is not configured or does not know the post yet. */
async function indexedPost(record: StoredCrossPost, ctx: ProofContext) {
  if (!record.postId || !ctx.indexer.configured) return undefined;
  try {
    return await ctx.indexer.post(toBase64url(fromHex(record.postId)));
  } catch {
    return undefined;
  }
}

/** Block height of a post from the indexer, then the node; "0" when neither knows yet. */
async function blockHeightOf(record: StoredCrossPost, koinosTxId: string, ctx: ProofContext): Promise<string> {
  if (record.blockHeight && /^\d+$/.test(record.blockHeight)) return record.blockHeight;
  const view = await indexedPost(record, ctx);
  if (view?.blockHeight && /^\d+$/.test(view.blockHeight)) return view.blockHeight;
  try {
    const txs = await ctx.client.provider.getTransactionsById([koinosTxId]);
    const blockId = txs?.transactions?.[0]?.containing_blocks?.[0];
    if (blockId) {
      const blocks = await ctx.client.provider.getBlocksById([blockId]);
      const height = blocks?.block_items?.[0]?.block_height;
      if (height !== undefined && /^\d+$/.test(String(height))) return String(height);
    }
  } catch {
    // node optional here
  }
  return "0";
}

/**
 * Signs the proof manifest (section 8) with the device key and records it with
 * `record_cross_post`. Requires both sides to be known: the Koinos post (id, content hash and,
 * for a SUCCEEDED outcome, its transaction id) and the host outcome the user reported.
 * `external_ref` is the host post reference the user gave, never the page the draft came from.
 */
export async function recordCrossPostProof(record: StoredCrossPost, ctx: ProofContext): Promise<ProofResult> {
  const now = ctx.now ?? (() => Date.now());
  if (record.koinosStatus !== "ok" || !record.postId || !record.contentHash) throw new Error("The Koinos side is not known yet.");
  if (record.hostStatus !== "ok" && record.hostStatus !== "failed") throw new Error("The host side is not known yet: mark it posted or failed first.");
  const koinosTxId = record.koinosTxId ?? (await indexedPost(record, ctx))?.txId;
  if (!koinosTxId) throw new Error("The transaction id of the Koinos post is not known yet (the indexer has not caught up). Try again later.");
  const author = ctx.session.account;
  const outcome = record.hostStatus === "failed" ? OUTCOME.PARTIAL : OUTCOME.SUCCEEDED;
  const externalRef = record.hostStatus === "ok" ? (record.hostRef ?? "") : "";
  const manifest = buildProofManifest({
    author,
    post_id: fromHex(record.postId),
    content_hash: fromHex(record.contentHash),
    version_number: record.versionNumber ?? 1,
    transaction_id: koinosTxId,
    block_height: await blockHeightOf(record, koinosTxId, ctx),
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
  const result = await submitOperations([op], ctx);
  return { manifestHash: toHex(hash), txId: result.transaction.id ?? "", outcome, koinosTxId };
}
