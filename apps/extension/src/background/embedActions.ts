import {
  AUDIENCE, CAPABILITY, SponsorError, TransactionRevertedError, contentHash, idempotencyKey,
  toBase64url, utf8, type OperationJson,
} from "@osp/sdk";
import { buildPublishPlan } from "../../../web/src/features/composer/publish";
import { KeyStore as PublishKeys } from "../../../web/src/api/keystore";
import { threadFriends } from "../../../web/src/features/post/replyAudience";
import { bytesOf, fromHex, toHex } from "../shared/bytes";
import type { FeedItem, FeedPage } from "../shared/protocol";
import type { KeyValueArea } from "../shared/storage";
import { draftSizeError } from "../shared/draft";
import type { FeedDeps, FeedService } from "./feed";
import { EncryptedStore, deriveAesKey } from "./keystore";
import { PaymentError, lookupDeviceStatus, submitOperations } from "./publish";
import { requireProtocol } from "./clients";
import type { UnlockedSession } from "./vault";

type Deps = FeedDeps & { feed: FeedService; local: KeyValueArea; enabled: () => Promise<boolean> };
type Target = { postId: string; targetId?: string; version?: string };
interface SavedReply {
  createdAt: number; parent: string; textHash: string; version: string; postId: string; audience: number; epoch: number;
  audienceId?: string; epochKey?: string; operations: OperationJson[];
  state: "ready" | "submitted" | "confirmed"; txId?: string;
}

/** Narrow card operations. Actor, signing key, audience and recipients are worker-derived. */
export class EmbeddedActions {
  private busy = false;
  constructor(private deps: Deps) {}

  async target(p: Target): Promise<FeedItem> {
    if (!await this.deps.enabled()) throw Error("The Facebook feed is disabled.");
    const root = await this.deps.feed.card(p.postId);
    if (!root || !["plain", "decrypted"].includes(root.status)) throw Error(root?.message || "This post is unavailable.");
    const targetId = p.targetId ?? p.postId;
    if (targetId !== p.postId) {
      const client = requireProtocol(await this.deps.clients());
      let cursor = targetId, related = false;
      for (let n=0;n<16;n++) {
        const post = (await client.reads.publications.get_post({ post_id: bytesOf(cursor) }))?.value;
        if (!post?.reply_to?.length || post.state !== 0) break;
        cursor = toBase64url(post.reply_to);
        if (cursor === p.postId) { related = true; break; }
      }
      if (!related) throw Error("This comment does not belong to the displayed thread.");
    }
    const item = targetId === p.postId ? root : await this.deps.feed.card(targetId);
    if (!item || !["plain", "decrypted"].includes(item.status)) throw Error("This comment is unavailable.");
    if (p.version && item.contentHash !== p.version) throw Error("This post changed. Refresh it before acting.");
    return item;
  }

  async replies(p: Target & { cursor?: string }): Promise<FeedPage> {
    const item = await this.target(p), clients = await this.deps.clients(), session = await this.deps.session();
    const page = await clients.indexer.replies(item.postId, session?.account, p.cursor);
    const items: FeedItem[] = [];
    // The indexer proposes replies; card() verifies their parent, version and audience on chain.
    for (const post of page.items.slice(0,10)) {
      if (post.replyTo !== item.postId) continue;
      const child = await this.deps.feed.card(post.postId);
      if (child?.replyTo === item.postId) items.push(child);
    }
    await this.target(p);
    if (session) await this.active(session);
    return { items, nextCursor: page.nextCursor };
  }

  async run<T>(p: Target, capability: number, operation: (session: UnlockedSession, item: FeedItem) => Promise<T>): Promise<T> {
    if (this.busy) throw Error("Wait for your current action to finish.");
    this.busy = true;
    try {
      const session = await this.deps.session();
      if (!session) throw Error("Unlock Open Social in Browser tools to interact with posts here.");
      const client = requireProtocol(await this.deps.clients());
      const device = await lookupDeviceStatus(client, session.account, session.deviceAddress, this.deps.now?.());
      if (!device.authorized || ((device.capabilities ?? 0) & capability) !== capability)
        throw Error("This browser needs renewed interaction permission. Authorize it again in Browser tools.");
      const item = await this.target(p);
      await this.active(session);
      const result = await operation(session, item);
      this.deps.feed.invalidate();
      await this.deps.vault.touch(); // explicit interactions count; reads/media/polling do not
      return result;
    } finally { this.busy = false; }
  }

  private async active(session: UnlockedSession) {
    const current = await this.deps.session();
    if (current?.account !== session.account || current.unlockedAt !== session.unlockedAt || !await this.deps.enabled()) throw Error("Your session changed. Unlock Open Social and try again.");
  }

  private async submit(ops: OperationJson[], session: UnlockedSession) {
    const clients = await this.deps.clients(), client = requireProtocol(clients);
    await this.active(session);
    const result = await submitOperations(ops, { client, session, vault: this.deps.vault, payment: clients.resolved.payment, sponsorUrls: clients.resolved.sponsorUrls });
    if (result.transaction.id) await client.provider.wait(result.transaction.id, "byTransactionId", 120000);
    return { txId: result.transaction.id };
  }

  react(p: Target & { reaction: number; remove: boolean }) {
    return this.run(p, CAPABILITY.REACT, async (session, item) => {
      const client = requireProtocol(await this.deps.clients());
      const result = await this.submit([await client.ops.publications.react({ actor: session.account, device: session.deviceAddress,
        post_id: bytesOf(item.postId), reaction: p.reaction, remove: p.remove })], session);
      return { ...result, reaction: p.remove ? 0 : p.reaction };
    });
  }

  poll(p: Target & { option: number }) {
    return this.run(p, CAPABILITY.REACT, async (session,item) => {
      const client = requireProtocol(await this.deps.clients());
      const view = await client.reads.publications.get_poll({ post_id: bytesOf(item.postId), viewer: session.account });
      if (!view?.value || BigInt(view.now) >= BigInt(view.value.definition.closes_at)) throw Error("This poll is closed.");
      if (p.option >= view.value.definition.options.length) throw Error("Choose an available answer.");
      if (view.ballot?.option === p.option) return { pollView: view };
      const result = await this.submit([await client.ops.publications.answer_poll({ actor: session.account, device: session.deviceAddress,
        post_id: bytesOf(item.postId), option: p.option })], session);
      return { ...result, pollView: await client.reads.publications.get_poll({ post_id: bytesOf(item.postId), viewer: session.account }) };
    });
  }

  comment(p: Target & { text: string; attemptId: string }) {
    return this.run(p, CAPABILITY.PUBLISH | CAPABILITY.COMMENT, async (session, parent) => {
      const clients = await this.deps.clients(), client = requireProtocol(clients);
      const text = p.text.trim(), textHash = toHex(contentHash(utf8(text)));
      if (!text) throw Error("Write a comment first.");
      const sizeError = draftSizeError(text); if(sizeError) throw Error(sizeError);
      const store = new EncryptedStore<Record<string,SavedReply>>(this.deps.local,
        `osp.embed-replies:${client.chainId}:${session.account}`, await deriveAesKey(fromHex(session.encryptionSecret), "embed-replies"));
      const saved = await store.load() ?? {};
      const now = this.deps.now?.() ?? Date.now();
      // Reopening/reloading a card must not create a second copy of a pending comment.
      const prior = Object.entries(saved).find(([,d]) => d.parent === parent.postId && d.textHash === textHash &&
        (d.state === "submitted" || d.state === "confirmed" && now - d.createdAt < 300000));
      const replyAttempt = prior?.[0] ?? p.attemptId;
      let draft = saved[replyAttempt];
      if (draft && (draft.parent !== parent.postId || draft.textHash !== textHash)) throw Error("This saved comment attempt has different content.");
      const existing = (await client.reads.publications.get_post_by_idempotency_key({ author: session.account,
        idempotency_key: idempotencyKey(session.account, fromHex(replyAttempt)) }))?.value;
      if (existing) return { postId: toBase64url(existing.post_id), confirmed: true };
      if (draft?.state === "submitted" || draft?.state === "confirmed") throw Error("This comment is still being checked on the network. Check again before sending another copy.");
      if (draft && draft.version !== parent.contentHash) throw Error("The thread changed. Refresh before composing a new comment.");
      if (!draft) {
        const restricted = parent.audience !== AUDIENCE.EVERYONE;
        const friends = parent.audience === AUDIENCE.FRIENDS ? await threadFriends(client, clients.indexer, parent.author, session.account) : undefined;
        const selected = friends?.selected ?? [...new Set([parent.author, ...(parent.shareWith ?? [])])];
        const encryption = this.deps.vault.encryption(session);
        // Public/custom reply plans do not use a seed or a reusable friends key.
        // The device stays the signer; the owner seed is never exposed to the card.
        const plan = await buildPublishPlan({
          chain: { chainId: client.chainId, deployment: client.deployment, reads: client.reads, ops: { publications: {
            publish: args => client.ops.publications.publish({ ...args, device: session.deviceAddress }),
            distribute_keys: args => client.ops.publications.distribute_keys({ ...args, device: session.deviceAddress }),
          } } }, indexer: clients.indexer, keys: new PublishKeys(),
          me: { account: session.account, seed: new Uint8Array(), encryption }, text,
          audience: restricted ? AUDIENCE.CUSTOM : AUDIENCE.EVERYONE, selectedAccounts: selected,
          collectionId: parent.collectionId || undefined, replyTo: parent.postId,
          replyGuard: { parentHash: parent.contentHash!, friendsEpoch: friends?.epoch }, attemptId: replyAttempt,
          createdAt: this.deps.now?.() ?? Date.now(),
        });
        draft = { createdAt: now, parent: parent.postId, version: parent.contentHash!, textHash, postId: toBase64url(plan.postId),
          audience: plan.audience, epoch: plan.epoch, audienceId: plan.audienceId && toBase64url(plan.audienceId),
          epochKey: plan.epochKey && toBase64url(plan.epochKey), operations: plan.operations, state: "ready" };
        saved[replyAttempt] = draft; await store.save(saved);
      }
      await this.target(p); await this.active(session);
      draft.state = "submitted"; await store.save(saved);
      try {
        const result = await this.submit(draft.operations,session);
        draft.state = "confirmed"; draft.txId = result.txId; await store.save(saved);
        if (draft.epochKey) await (await this.deps.keys(session)).put({ author: session.account, audienceId: bytesOf(draft.audienceId), epoch: draft.epoch },bytesOf(draft.epochKey));
        return { ...result, postId: draft.postId, confirmed: true };
      } catch(e) {
        // A known refusal/revert may be retried. Uncertain broadcasts retain their
        // idempotency key and encrypted operations, and are checked without resending.
        if(e instanceof TransactionRevertedError || e instanceof SponsorError || e instanceof PaymentError) { draft.state="ready";await store.save(saved); }
        throw e;
      }
    });
  }
}
