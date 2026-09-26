/** Finish both directions of the friendship handshake while the author is unlocked. */
import { RELATIONSHIP_STATUS, addressToString, buildKeyPackageSets, type OperationJson } from "@osp/sdk";
import { chainKeyVerifier } from "../../api/keyProvenance";
import type { KeyStore } from "../../api/keystore";
import { paymentBlocker, withAccountSubmission, type SubmitContext } from "../../tx/submit";
import { collectRecipients, currentEpoch, type PublishIdentity, type PublishIndexer } from "../composer/publish";

export interface FriendKeySyncInput {
  ctx: SubmitContext;
  me: PublishIdentity;
  keys: KeyStore;
  indexer: PublishIndexer;
  /** Rechecked before signing so locking or switching accounts cancels in-flight reads. */
  isCurrent?: () => boolean;
}

const running = new WeakSet<KeyStore>();
// Bound each pass, retaining progress so a long history does not starve older keys.
const cursors = new WeakMap<KeyStore, number>();
const EPOCHS_PER_PASS = 16;

export async function syncFriendKeys(input: FriendKeySyncInput): Promise<string[]> {
  const { ctx, me, keys, indexer } = input;
  if (running.has(keys) || input.isCurrent?.() === false) return [];
  if (ctx.signer.getAddress() !== me.account) throw new Error("The active account changed. Unlock it again to share private posts.");
  running.add(keys);
  try {
    const epoch = await currentEpoch(ctx.client, me.account);
    // The indexer supplies candidate friends; the chain decides membership and public keys.
    const collected = await collectRecipients({ chain: ctx.client, indexer, me });
    if (collected.recipients.length === 0) return [];
    const shared = new Set<string>();
    const start = Math.min(cursors.get(keys) ?? 0, epoch);
    const count = Math.min(epoch + 1, EPOCHS_PER_PASS);
    for (let offset = 0; offset < count; offset++) {
      if (input.isCurrent?.() === false) break;
      const keyEpoch = (start + offset) % (epoch + 1);
      const ref = { author: me.account, audienceId: new Uint8Array(0), epoch: keyEpoch };
      const recovered = await keys.resolveTrusted(ref, me, indexer, chainKeyVerifier(ctx.client));
      if (recovered.unverifiable) throw new Error("Your private-post keys could not be verified. Sharing will retry when the network is reachable.");
      // Some periods contain no posts. Never manufacture keys to repair history access.
      if (recovered.entry) {
        const holders = new Set(recovered.entry.recipients);
        const recipients = collected.recipients.filter((r) => !holders.has(r.address as string));
        if (recipients.length > 0) {
          const blocker = paymentBlocker(ctx.payment, ctx.client.sponsors.sponsors.length);
          if (blocker) throw new Error(blocker);
          const sets = buildKeyPackageSets({ author: me.account, epoch: keyEpoch, epochKey: recovered.entry.key, recipients }, 6000);
          // Small transactions respect sponsor and chain limits even for long histories.
          for (const set of sets) {
            const operation: OperationJson = await ctx.client.ops.publications.distribute_keys({ author: me.account, epoch: keyEpoch, packages: set.bytes });
            const accounts = set.set.keys.map((key) => addressToString(key.recipient));
            const result = await withAccountSubmission(ctx, async () => {
              for (const account of accounts) {
                const relationship = await ctx.client.reads.relationships.get_relationship({ a: me.account, b: account });
                if (relationship?.value?.status !== RELATIONSHIP_STATUS.ACTIVE) return undefined;
              }
              if (await currentEpoch(ctx.client, me.account) !== epoch || input.isCurrent?.() === false) return undefined;
              return ctx.client.submit({
                operations: [operation], signer: ctx.signer, waitForReceipt: true,
                ...(ctx.payment === "self-only" && { sponsor: null }),
                selfPayFallback: ctx.payment !== "sponsor-only",
              });
            });
            if (!result) return [...shared];
            if (result.receipt.reverted) throw new Error("The network rejected private-post sharing. Please retry.");
            await keys.addRecipients(ref, accounts);
            for (const account of accounts) shared.add(account);
          }
        }
      }
      cursors.set(keys, (keyEpoch + 1) % (epoch + 1));
    }
    return [...shared];
  } finally {
    running.delete(keys);
  }
}
