/** Relationship actions (spec section 4) and the local ignore list for incoming requests. */
import type { SubmitContext } from "../../tx/submit";
import { submitAction } from "../../tx/submit";
import { safeLocalStorage } from "../../util/webStorage";

export async function requestFriend(ctx: SubmitContext, target: string) {
  const op = await ctx.client.ops.relationships.request_friend({ requester: ctx.signer.getAddress(), recipient: target });
  return submitAction(ctx, [op], { label: "Sending the friend request", success: "Friend request sent" });
}

export async function acceptFriend(ctx: SubmitContext, requester: string) {
  const op = await ctx.client.ops.relationships.accept_friend({ approver: ctx.signer.getAddress(), requester });
  return submitAction(ctx, [op], { label: "Accepting the friend request", success: "You are now friends" });
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
