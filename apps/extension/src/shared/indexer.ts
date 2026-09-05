/**
 * Typed client for the INDEXER API v1 (apps/indexer/README.md). The indexer is a replaceable
 * convenience, never a source of truth: chain reads through the SDK stay authoritative.
 */
export interface StatusView {
  network: string;
  chainId: string | null;
  contracts: Record<string, string> | null;
  head: { height: string; id: string } | null;
  lastIrreversible: string | null;
  indexed: { height: string; id: string; stateHash: string } | null;
  startHeight: string;
  healthy: boolean;
  version: string;
}

export interface ProfileView {
  account: string;
  owner: string;
  /** base64url X25519 public key */
  encryptionKey: string;
  keyVersion: number;
  profileHash: string;
  profileUri: string;
  protocolVersion: number;
  deviceEpoch: number;
  registeredAt: string;
  updatedAt: string;
  counts: { posts: number; friends: number; followers: number; following: number };
}

export interface GraphView {
  account: string;
  friends: Array<{ account: string; since: string; nonce: string }>;
  pendingIncoming: Array<{ account: string; requestedAt: string }>;
  pendingOutgoing: Array<{ account: string; requestedAt: string }>;
  followers: string[];
  following: string[];
  blocked: string[];
  audienceEpoch: number;
}

export interface LabelView {
  communityId: string;
  label: string;
  reason: string;
  actor: string;
  timestamp: string;
}

export interface PostView {
  postId: string;
  author: string;
  sequence: string;
  versionNumber: number;
  contentHash: string;
  previousVersion: string;
  audience: number;
  audienceId: string;
  epoch: number;
  /** base64url of the latest version's envelope */
  envelope: string;
  media: Array<{ contentHash: string; mime: string; size: string; locations: string[]; keyRef: string }>;
  replyTo: string;
  state: number;
  stateReason: string;
  replacementId: string;
  createdAt: string;
  updatedAt: string;
  txId: string;
  blockHeight: string;
  reactions: { total: number; byType: Record<string, number>; viewer?: number[] };
  replyCount: number;
  versions: Array<{ contentHash: string; versionNumber: number; txId: string; blockHeight: string; timestamp: string }>;
  labels: LabelView[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface SealedKeyView {
  author: string;
  audienceId: string;
  epoch: number;
  recipient: string;
  /** base64url encoded osp.envelope.sealed_key */
  sealedKey: string;
  blockHeight: string;
  txId: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class IndexerError extends Error {
  override name = "IndexerError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  get notFound(): boolean {
    return this.status === 404;
  }
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
}

export interface IndexerClientOptions {
  baseUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class IndexerClient {
  readonly baseUrl: string;
  private readonly fetchFn: FetchLike | undefined;
  private readonly timeoutMs: number;

  constructor(options: IndexerClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchFn = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  get configured(): boolean {
    return this.baseUrl.length > 0;
  }

  status(): Promise<StatusView> {
    return this.get<StatusView>("/v1/status");
  }

  profile(account: string): Promise<ProfileView | undefined> {
    return this.optional(this.get<ProfileView>(`/v1/profiles/${encodeURIComponent(account)}`));
  }

  graph(account: string): Promise<GraphView> {
    return this.get<GraphView>(`/v1/graph/${encodeURIComponent(account)}`);
  }

  feed(query: { viewer?: string; scope?: "public" | "friends" | "all"; cursor?: string; limit?: number } = {}): Promise<Page<PostView>> {
    return this.get<Page<PostView>>(`/v1/feed${qs({ viewer: query.viewer, scope: query.scope, cursor: query.cursor, limit: query.limit })}`);
  }

  accountPosts(account: string, query: { cursor?: string; limit?: number } = {}): Promise<Page<PostView>> {
    return this.get<Page<PostView>>(`/v1/accounts/${encodeURIComponent(account)}/posts${qs({ cursor: query.cursor, limit: query.limit })}`);
  }

  post(postId: string): Promise<PostView | undefined> {
    return this.optional(this.get<PostView>(`/v1/posts/${encodeURIComponent(postId)}`));
  }

  async keys(account: string, filter: { author?: string; audienceId?: string; epoch?: number } = {}): Promise<SealedKeyView[]> {
    const body = await this.get<{ items: SealedKeyView[] }>(`/v1/keys/${encodeURIComponent(account)}${qs({ author: filter.author, audienceId: filter.audienceId, epoch: filter.epoch })}`);
    return body.items ?? [];
  }

  private async optional<T>(promise: Promise<T>): Promise<T | undefined> {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof IndexerError && error.notFound) return undefined;
      throw error;
    }
  }

  private async get<T>(path: string): Promise<T> {
    if (!this.configured) throw new IndexerError(0, "not_configured", "No indexer is configured. Add one in the extension options.");
    if (!this.fetchFn) throw new IndexerError(0, "no_fetch", "fetch is not available");
    const init: RequestInit = { method: "GET", headers: { accept: "application/json" } };
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") init.signal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, init);
    } catch (error) {
      throw new IndexerError(0, "unreachable", `The indexer at ${this.baseUrl} is not reachable (${error instanceof Error ? error.message : "network error"}).`);
    }
    const text = await response.text();
    let body: unknown;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        if (response.ok) throw new IndexerError(response.status, "invalid_json", "The indexer returned invalid JSON.");
      }
    }
    if (!response.ok) {
      const err = (body as { error?: { code?: string; message?: string } } | undefined)?.error;
      throw new IndexerError(response.status, err?.code ?? `http_${response.status}`, err?.message ?? `The indexer responded with ${response.status}.`);
    }
    return body as T;
  }
}
