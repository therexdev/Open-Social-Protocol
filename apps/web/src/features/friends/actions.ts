/** Relationship actions (spec section 4) and the local ignore list for incoming requests. */
import { LIMITS, buildKeyPackageSets, type OperationJson } from "@osp/sdk";
import type { EpochKeyRef, KeyStore } from "../../api/keystore";
import type { SubmitContext } from "../../tx/submit";
import { submitAction } from "../../tx/submit";
import { safeLocalStorage } from "../../util/webStorage";

/** What accepting a request needs to hand the new friend the current reading key (spec 5.4, future-only). */
export interface KeyShare {
  keys: KeyStore;
}

export interface KeyShareOps {
  ref: EpochKeyRef;
  operations: OperationJson[];
}

/**
 * distribute_keys operations sealing the author's current, trusted epoch key to `friend`, or
 * undefined when there is nothing to share yet (no trusted key on this device, friend already
 * holds it, friend has no encryption key on chain, chain unreachable). The next friends-only
 * post distributes to every friend the chain confirms anyway.
 */
export async function currentKeyShare(ctx: SubmitContext, share: KeyShare, friend: string): Promise<KeyShareOps | undefined> {
  const author = ctx.signer.getAddress();
  try {
    const epoch = (await ctx.client.reads.relationships.get_audience({ account: author }))?.value?.epoch ?? 0;
    const ref: EpochKeyRef = { author, audienceId: new Uint8Array(0), epoch };
    const entry = share.keys.trusted(ref);
    if (!entry || entry.recipients.includes(friend)) return undefined;
    const record = (await ctx.client.reads.identity.get_identity({ account: friend }))?.value;
    if (!record || record.encryption_key.length !== LIMITS.keyBytes) return undefined;
    const sets = buildKeyPackageSets({ author, epoch, epochKey: entry.key, recipients: [{ address: friend, publicKey: record.encryption_key, keyVersion: record.key_version || 1 }] });
    const operations: OperationJson[] = [];
    for (const set of sets) operations.push(await ctx.client.ops.publications.distribute_keys({ author, epoch, packages: set.bytes }));
    return { ref, operations };
  } catch {
    return undefined;
  }
}

export async function requestFriend(ctx: SubmitContext, target: string) {
  const op = await ctx.client.ops.relationships.request_friend({ requester: ctx.signer.getAddress(), recipient: target });
  return submitAction(ctx, [op], { label: "Sending the friend request", success: "Friend request sent" });
}

/** [accept_friend, distribute_keys(current epoch -> requester)] in one transaction when the key is at hand. */
export async function acceptFriend(ctx: SubmitContext, requester: string, share?: KeyShare) {
  const operations = [await ctx.client.ops.relationships.accept_friend({ approver: ctx.signer.getAddress(), requester })];
  const shared = share ? await currentKeyShare(ctx, share, requester) : undefined;
  if (shared) operations.push(...shared.operations);
  const result = await submitAction(ctx, operations, { label: "Accepting the friend request", success: shared ? "You are now friends; they received your reading key" : "You are now friends" });
  if (share && shared) await share.keys.addRecipients(shared.ref, [requester]);
  return result;
}

export async function removeFriend(ctx: SubmitContext, peer: string) {
  const op = await ctx.client.ops.relationships.remove_friend({ actor: ctx.signer.getAddress(), peer });
  return submitAction(ctx, [op], { label: "Removing the friend", success: "Friend removed" });
}

export async function follow(ctx: SubmitContext, target: string) {
  const op = await ctx.client.ops.relationships.follow({ follower: ctx.signer.getAddress(), target });
  return submitAction(ctx, [op], { label: "Following", success: "Following" });
}

export async function unfollow(ctx: SubmitContext, target: string) {
  const op = await ctx.client.ops.relationships.unfollow({ follower: ctx.signer.getAddress(), target });
  return submitAction(ctx, [op], { label: "Unfollowing", success: "Unfollowed" });
}

export async function block(ctx: SubmitContext, target: string) {
  const op = await ctx.client.ops.relationships.block({ actor: ctx.signer.getAddress(), target });
  return submitAction(ctx, [op], { label: "Blocking the account", success: "Account blocked" });
}

export async function unblock(ctx: SubmitContext, target: string) {
  const op = await ctx.client.ops.relationships.unblock({ actor: ctx.signer.getAddress(), target });
  return submitAction(ctx, [op], { label: "Unblocking the account", success: "Account unblocked" });
}

const storage = safeLocalStorage();

function ignoredKey(account: string): string {
  return `osp.web.ignored.${account}`;
}

export function ignoredRequests(account: string): string[] {
  try {
    const raw = storage.getItem(ignoredKey(account));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function ignoreRequest(account: string, requester: string): void {
  const list = new Set(ignoredRequests(account));
  list.add(requester);
  storage.setItem(ignoredKey(account), JSON.stringify([...list]));
}

export function unignoreRequest(account: string, requester: string): void {
  const list = ignoredRequests(account).filter((a) => a !== requester);
  storage.setItem(ignoredKey(account), JSON.stringify(list));
}

export const REMOVE_FRIEND_WARNING =
  "Removing a friend stops them from receiving the key to your future friends-only posts. It cannot take back posts they could already read: copies may already exist on their devices.";

export const BLOCK_WARNING =
  "Blocking ends the friendship, removes follows in both directions, prevents new requests and stops future friends-only keys. Like removing a friend, it cannot erase what they already received. Blocks are visible on the network.";
