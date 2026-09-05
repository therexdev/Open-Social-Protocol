/**
 * Typed client for the INDEXER API v1 (see apps/indexer/README.md). Every read the web client
 * performs goes through here; the indexer is a replaceable convenience, never a source of truth.
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
  deployed?: boolean;
  message?: string;
}

export interface ProfileCounts {
  posts: number;
  friends: number;
  followers: number;
  following: number;
}

export interface DeviceView {
  device: string;
  capabilities: number;
  expiresAt: string;
  deviceEpoch: number;
  revoked: boolean;
  label: string;
  authorizedAt: string;
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
  counts: ProfileCounts;
  recovery?: { policy: unknown; pendingPolicy: unknown; pendingRecovery: unknown };
  devices?: DeviceView[];
}

export type ProfileSummary = Pick<ProfileView, "account" | "owner" | "encryptionKey" | "keyVersion" | "profileHash" | "profileUri" | "registeredAt" | "updatedAt">;

export interface GraphView {
  account: string;
  friends: Array<{ account: string; since: string; nonce: string }>;
  pendingIncoming: Array<{ account: string; requestedAt: string; nonce?: string }>;
  pendingOutgoing: Array<{ account: string; requestedAt: string; nonce?: string }>;
  followers: string[];
  following: string[];
  blocked: string[];
  blockedBy?: string[];
  audienceEpoch: number;
}

export interface MediaView {
  contentHash: string;
  mime: string;
  size: string;
  locations: string[];
  keyRef: string;
}

export interface PostVersionView {
  contentHash: string;
  versionNumber: number;
  txId: string;
  blockHeight: string;
  timestamp: string;
}

export interface LabelView {
  communityId: string;
  postId?: string;
  label: string;
  reason: string;
  actor: string;
  timestamp: string;
  blockHeight?: string;
  txId?: string;
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
  media: MediaView[];
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
  versions: PostVersionView[];
  labels: LabelView[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type NotificationKind = "friend_request" | "friend_accepted" | "reaction" | "reply" | "keys" | "role" | "label" | "recovery" | "device";

export interface NotificationView {
  id: string;
  kind: NotificationKind | string;
  actor: string;
  postId?: string;
  communityId?: string;
  data: Record<string, unknown>;
  timestamp: string;
  blockHeight: string;
}

export interface SealedKeyView {
  author: string;
  audienceId: string;
  epoch: number;
  recipient: string;
  recipientKeyVersion?: number;
  /** base64url encoded osp.envelope.sealed_key */
  sealedKey: string;
  blockHeight: string;
  txId: string;
  timestamp?: string;
}

export interface AudienceView {
  author: string;
  audienceId: string;
  epoch: number;
  epochs: Array<{ epoch: number; since: string; reason: string }>;
}

export interface RoleView {
  subject: string;
  role: number;
  scope: string;
  expiresAt: string;
  grantedBy: string;
  grantedAt?: string;
}

export interface CommunityView {
  id: string;
  owner: string;
  name: string;
  policyHash: string;
  policyUri: string;
  transferDelayMs: string;
  pendingOwner: string;
  transferEffectiveAt: string;
  createdAt: string;
  updatedAt: string;
  roles: RoleView[];
}

export interface SponsorView {
  sponsor: string;
  endpoint: string;
  policyVersion: number;
  active: boolean;
  registeredAt: string;
  updatedAt: string;
  [extra: string]: unknown;
}

export interface EventLogView {
  height: string;
  blockId: string;
  txId: string;
  sequence: number;
  contract: string;
  name: string;
  data: unknown;
  impacted: string[];
}

export interface StateHashView {
  height: string;
  blockId: string;
  stateHash: string;
}

export type FeedScope = "public" | "friends" | "all";

export interface FeedQuery {
  viewer?: string;
  scope?: FeedScope;
  cursor?: string;
  limit?: number;
}

export interface PageQuery {
  cursor?: string;
  limit?: number;
  viewer?: string;
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

export interface IndexerClientOptions {
  baseUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
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

  async profile(account: string): Promise<ProfileView | undefined> {
    return this.optional(this.get<ProfileView>(`/v1/profiles/${encodeURIComponent(account)}`));
  }

  async searchProfiles(query: string, limit = 20): Promise<ProfileSummary[]> {
    const body = await this.get<{ items: ProfileSummary[] }>(`/v1/profiles${qs({ query, limit })}`);
    return body.items ?? [];
  }

  graph(account: string): Promise<GraphView> {
    return this.get<GraphView>(`/v1/graph/${encodeURIComponent(account)}`);
  }

  feed(query: FeedQuery = {}): Promise<Page<PostView>> {
    return this.get<Page<PostView>>(`/v1/feed${qs({ viewer: query.viewer, scope: query.scope, cursor: query.cursor, limit: query.limit })}`);
  }

  accountPosts(account: string, query: PageQuery = {}): Promise<Page<PostView>> {
    return this.get<Page<PostView>>(`/v1/accounts/${encodeURIComponent(account)}/posts${qs({ cursor: query.cursor, limit: query.limit, viewer: query.viewer })}`);
  }

  async post(postId: string, viewer?: string): Promise<PostView | undefined> {
    return this.optional(this.get<PostView>(`/v1/posts/${encodeURIComponent(postId)}${qs({ viewer })}`));
  }

  replies(postId: string, query: PageQuery = {}): Promise<Page<PostView>> {
    return this.get<Page<PostView>>(`/v1/posts/${encodeURIComponent(postId)}/replies${qs({ cursor: query.cursor, limit: query.limit, viewer: query.viewer })}`);
  }

  notifications(account: string, query: { since?: string; limit?: number } = {}): Promise<Page<NotificationView>> {
    return this.get<Page<NotificationView>>(`/v1/notifications/${encodeURIComponent(account)}${qs({ since: query.since, limit: query.limit })}`);
  }

  async keys(account: string, filter: { author?: string; audienceId?: string; epoch?: number; limit?: number } = {}): Promise<SealedKeyView[]> {
    const body = await this.get<{ items: SealedKeyView[] }>(
      `/v1/keys/${encodeURIComponent(account)}${qs({ author: filter.author, audienceId: filter.audienceId, epoch: filter.epoch, limit: filter.limit })}`,
    );
    return body.items ?? [];
  }

  audience(author: string, audienceId?: string): Promise<AudienceView> {
    return this.get<AudienceView>(`/v1/audiences/${encodeURIComponent(author)}${qs({ audienceId })}`);
  }

  async community(id: string): Promise<CommunityView | undefined> {
    return this.optional(this.get<CommunityView>(`/v1/communities/${encodeURIComponent(id)}`));
  }

  async labels(filter: { postId?: string; communityId?: string } = {}): Promise<LabelView[]> {
    const body = await this.get<{ items: LabelView[] }>(`/v1/labels${qs({ postId: filter.postId, communityId: filter.communityId })}`);
    return body.items ?? [];
  }

  async sponsors(): Promise<SponsorView[]> {
    const body = await this.get<{ items: SponsorView[] }>("/v1/sponsors");
    return body.items ?? [];
  }

  events(query: { fromHeight?: string | number; limit?: number } = {}): Promise<{ items: EventLogView[]; nextHeight: string | null }> {
    return this.get(`/v1/events${qs({ fromHeight: query.fromHeight, limit: query.limit })}`);
  }

  stateHash(height?: string | number): Promise<StateHashView> {
    return this.get<StateHashView>(`/v1/conformance/state-hash${qs({ height })}`);
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
    if (!this.configured) throw new IndexerError(0, "not_configured", "No indexer is configured. Add one in Settings.");
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
    let body: unknown = undefined;
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
