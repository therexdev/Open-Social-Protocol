import { fromBase64url, toBase64url, type ProtocolClient, type Signer } from "@osp/sdk";
import type { SponsorConfig } from "./config.js";

const PAGE_SIZE = 4;
const INTERVAL_MS = 30_000;

export interface RewardSettlementStatus {
  state: "disabled" | "starting" | "ready" | "degraded";
  lastCheckedAt: string | null;
  lastSettledAt: string | null;
  lastError: string | null;
}

function targetId(encoded: unknown): Uint8Array {
  if (typeof encoded !== "string" || encoded.length > 88) throw new Error("Invalid reward target in indexer response");
  const id = fromBase64url(encoded);
  if (toBase64url(id) !== encoded ||
    !(id.length === 32 || (id.length === 33 && id[0] === 1) || (id.length === 65 && id[0] === 2))) {
    throw new Error("Invalid reward target in indexer response");
  }
  return id;
}

type Config = Pick<SponsorConfig, "rewardIndexerUrl" | "maxRcPerOp">;

/** The indexer supplies candidate IDs only. The token contract decides eligibility,
 * destination and amount, including for candidates rediscovered after a restart or fork. */
export class RewardSettler {
  readonly status: RewardSettlementStatus = { state: "starting", lastCheckedAt: null, lastSettledAt: null, lastError: null };
  private cursor: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: Promise<void> | undefined;
  private closing = false;

  constructor(private readonly client: ProtocolClient, private readonly signer: Signer,
    private readonly config: Config, private readonly withPayerNonce: <T>(submit: () => Promise<T>) => Promise<T>,
    private readonly request: typeof fetch = fetch) {}

  start(log: (message: string) => void): void {
    const poll = () => {
      const previous = this.status.lastError;
      void this.runOnce().then(() => {
        if (this.status.lastError && this.status.lastError !== previous) log(`automatic OSAT settlement: ${this.status.lastError}`);
        if (!this.closing) this.timer = setTimeout(poll, INTERVAL_MS);
      });
    };
    if (!this.active && !this.timer && !this.closing) poll();
  }

  runOnce(): Promise<void> {
    if (this.closing) return Promise.resolve();
    if (!this.active) this.active = this.sweep()
      .then(() => { this.status.state = "ready"; this.status.lastError = null; })
      .catch((error: unknown) => {
        this.status.state = "degraded";
        this.status.lastError = error instanceof Error ? error.message : String(error);
      }).finally(() => {
        this.status.lastCheckedAt = new Date().toISOString();
        this.active = undefined;
      });
    return this.active;
  }

  async stop(): Promise<void> {
    this.closing = true;
    clearTimeout(this.timer);
    await this.active;
  }

  private async readIndexer(path: string, query?: URLSearchParams) {
    const url = new URL(`${this.config.rewardIndexerUrl.replace(/\/+$/, "")}${path}`);
    if (query) url.search = query.toString();
    const response = await this.request(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`Reward indexer ${path} returned HTTP ${response.status}`);
    return response.json();
  }

  private async sweep(): Promise<void> {
    const { client } = this;
    const [chain, config, index] = await Promise.all([
      client.verifyChainId(), client.reads.token.get_economy(), this.readIndexer("/v1/status"),
    ]);
    if (!chain.ok || index?.chainId !== client.chainId || index?.chainIdMatch !== true ||
      index?.contracts?.token !== client.deployment.contracts.token.address || !index.indexed) {
      throw new Error("Reward indexer or RPC has not confirmed the configured chain and Token contract");
    }
    if (index.features?.rewardSettlementQueue !== 1 || index.healthy !== true) {
      throw new Error("Update the reward indexer and wait until it is synced and healthy");
    }
    if (!config?.self_paid_settlement || config.value?.version !== 1) {
      throw new Error("Upgrade Token and enable the OSAT economy before automatic settlement");
    }
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (this.cursor) params.set("cursor", this.cursor);
    const page = await this.readIndexer("/v1/token/settlements/due", params);
    if (!Array.isArray(page?.items) || page.items.length > PAGE_SIZE ||
      !(page.nextCursor === null || (typeof page.nextCursor === "string" && page.nextCursor.length > 0 && page.nextCursor.length <= 2048 && page.nextCursor !== this.cursor))) {
      throw new Error("Invalid reward queue response from indexer");
    }
    // Advance even if one target fails. At the end of a pass we wrap and retry all
    // remaining candidates, including reorgs and older items behind the cursor.
    this.cursor = page.nextCursor;
    let failure: Error | undefined;
    for (const candidate of page.items) {
      if (this.closing) break;
      try {
        const id = targetId(candidate);
        await this.withPayerNonce(async () => {
          if (this.closing) return;
          const post = await client.reads.token.get_post_economy({ post_id: id });
          if (!post?.reward || post.reward.settled || !post.epoch || BigInt(post.block) < BigInt(post.epoch.end_block)) return;
          const actor = this.signer.getAddress();
          const cap = BigInt(this.config.maxRcPerOp);
          if (cap <= 0n || BigInt(await client.provider.getAccountRc(actor)) < 2n * cap) {
            throw new Error("Reward settlement paused to reserve Mana for social actions");
          }
          const op = await client.ops.token.settle_reward({ actor, post_id: id });
          await client.submit({ operations: [op], signer: this.signer, sponsor: null,
            rcLimit: cap.toString(), waitForReceipt: true, waitTimeoutMs: 20_000 });
          const confirmed = await client.reads.token.get_post_economy({ post_id: id });
          if (!confirmed?.reward?.settled) {
            throw new Error("Submitted OSAT settlement is awaiting confirmation on chain");
          }
          this.status.lastSettledAt = new Date().toISOString();
        });
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
      }
    }
    if (failure) throw failure;
  }
}
