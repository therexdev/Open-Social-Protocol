/**
 * Read models behind the INDEXER API v1 (README.md, "API reference").
 * Every function is a pure read of the projections; the JSON shapes are the API contract.
 */
import { toBase64url } from "@osp/sdk";
import type { CheckpointRow, IndexerDb, Row } from "./db.js";
import type { EventLogRow } from "./projections.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

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
  postId: string;
  label: string;
  reason: string;
  actor: string;
  timestamp: string;
  blockHeight: string;
  txId: string;
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

export const LISTING_STATES_EXCLUDED = [1, 2] as const;

// ---------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------

export type PositionCursor = [height: number, txIndex: number, sequence: number];

export function encodeCursor(position: PositionCursor): string {
  return Buffer.from(position.join(":"), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): PositionCursor | undefined {
  let text: string;
  try {
    text = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
  const parts = text.split(":");
  if (parts.length !== 3) return undefined;
  const numbers = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (numbers.some((n) => !Number.isSafeInteger(n))) return undefined;
  return numbers as PositionCursor;
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

interface PostRow extends Row {
  post_id: string;
  author: string;
  sequence: string;
  version_number: number;
  content_hash: string;
  previous_version: string;
  audience: number;
  audience_id: string;
  epoch: number;
  envelope: Uint8Array;
  media_json: string;
  reply_to: string;
  idempotency_key: string;
  protocol_version: number;
  state: number;
  state_reason: string;
  replacement_id: string;
  created_at: string;
  updated_at: string;
  tx_id: string;
  block_height: number;
  tx_index: number;
  event_sequence: number;
}

const POST_ORDER = "ORDER BY p.block_height DESC, p.tx_index DESC, p.event_sequence DESC";

function envelopeString(value: unknown): string {
  return value instanceof Uint8Array && value.length > 0 ? toBase64url(value) : "";
}

export function labelsForPost(db: IndexerDb, postId: string): LabelView[] {
  return db
    .all<Row>("SELECT * FROM labels WHERE post_id = ? ORDER BY height ASC, tx_index ASC, sequence ASC", postId)
    .map((row) => ({
      communityId: String(row.community_id),
      postId: String(row.post_id),
      label: String(row.label),
      reason: String(row.reason),
      actor: String(row.actor),
      timestamp: String(row.timestamp),
      blockHeight: String(row.height),
      txId: String(row.tx_id),
    }));
}

function postView(db: IndexerDb, row: PostRow, viewer?: string): PostView {
  const byType: Record<string, number> = {};
  let total = 0;
  for (const r of db.all<{ reaction: number; c: number }>("SELECT reaction, COUNT(*) AS c FROM reactions WHERE post_id = ? GROUP BY reaction ORDER BY reaction", row.post_id)) {
    byType[String(r.reaction)] = r.c;
    total += r.c;
  }
  const reactions: PostView["reactions"] = { total, byType };
  if (viewer) {
    reactions.viewer = db
      .all<{ reaction: number }>("SELECT reaction FROM reactions WHERE post_id = ? AND actor = ? ORDER BY reaction", row.post_id, viewer)
      .map((r) => r.reaction);
  }
  const replyCount =
    db.get<{ c: number }>("SELECT COUNT(*) AS c FROM posts WHERE reply_to = ? AND state NOT IN (1, 2)", row.post_id)?.c ?? 0;
  const versions = db
    .all<Row>("SELECT content_hash, version_number, tx_id, block_height, timestamp FROM post_versions WHERE post_id = ? ORDER BY version_number ASC", row.post_id)
    .map((v) => ({
      contentHash: String(v.content_hash),
      versionNumber: Number(v.version_number),
      txId: String(v.tx_id),
      blockHeight: String(v.block_height),
      timestamp: String(v.timestamp),
    }));
  let media: MediaView[] = [];
  try {
    media = JSON.parse(row.media_json) as MediaView[];
  } catch {
    media = [];
  }
  return {
    postId: row.post_id,
    author: row.author,
    sequence: row.sequence,
    versionNumber: row.version_number,
    contentHash: row.content_hash,
    previousVersion: row.previous_version,
    audience: row.audience,
    audienceId: row.audience_id,
    epoch: row.epoch,
    envelope: envelopeString(row.envelope),
    media,
    replyTo: row.reply_to,
    state: row.state,
    stateReason: row.state_reason,
    replacementId: row.replacement_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    txId: row.tx_id,
    blockHeight: String(row.block_height),
    reactions,
    replyCount,
    versions,
    labels: labelsForPost(db, row.post_id),
  };
}

function pagePosts(db: IndexerDb, where: string, params: unknown[], cursor: PositionCursor | undefined, limit: number, viewer?: string): Page<PostView> {
  const conditions = [where];
  const values = [...params];
  if (cursor) {
    conditions.push("(p.block_height, p.tx_index, p.event_sequence) < (?, ?, ?)");
    values.push(...cursor);
  }
  const rows = db.all<PostRow>(
    `SELECT p.* FROM posts p WHERE ${conditions.join(" AND ")} ${POST_ORDER} LIMIT ?`,
    ...(values as (string | number)[]),
    limit + 1,
  );
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map((row) => postView(db, row, viewer)),
    nextCursor: more && last ? encodeCursor([last.block_height, last.tx_index, last.event_sequence]) : null,
  };
}

export type FeedScope = "public" | "friends" | "all";

export interface FeedQuery {
  viewer?: string;
  scope: FeedScope;
  cursor?: PositionCursor;
  limit: number;
}

const FRIENDS_OF_VIEWER = `p.author IN (
  SELECT CASE WHEN a = ? THEN b ELSE a END FROM relationships WHERE status = 2 AND (a = ? OR b = ?)
)`;

/** Feed: top-level, non-deleted, non-hidden posts, newest first by (blockHeight, txIndex, sequence). */
export function feed(db: IndexerDb, query: FeedQuery): Page<PostView> {
  const conditions = ["p.reply_to = ''", "p.state NOT IN (1, 2)"];
  const params: unknown[] = [];
  const viewer = query.viewer;
  const friendsCondition = viewer ? `(p.author = ? OR ${FRIENDS_OF_VIEWER})` : undefined;
  const friendsParams = viewer ? [viewer, viewer, viewer, viewer] : [];
  switch (query.scope) {
    case "public":
      conditions.push("p.audience = 0");
      break;
    case "friends":
      conditions.push(friendsCondition ?? "0");
      params.push(...friendsParams);
      break;
    case "all":
      if (friendsCondition) {
        conditions.push(`(p.audience = 0 OR ${friendsCondition})`);
        params.push(...friendsParams);
      } else {
        conditions.push("p.audience = 0");
      }
      break;
  }
  if (viewer) {
    conditions.push("p.author NOT IN (SELECT target FROM blocks_list WHERE actor = ?)");
    params.push(viewer);
  }
  return pagePosts(db, conditions.join(" AND "), params, query.cursor, query.limit, viewer);
}

/** Posts (including replies) by one account, newest first, excluding deleted/hidden ones. */
export function accountPosts(db: IndexerDb, account: string, cursor: PositionCursor | undefined, limit: number, viewer?: string): Page<PostView> {
  return pagePosts(db, "p.author = ? AND p.state NOT IN (1, 2)", [account], cursor, limit, viewer);
}

export function getPost(db: IndexerDb, postId: string, viewer?: string): PostView | undefined {
  const row = db.get<PostRow>("SELECT * FROM posts WHERE post_id = ?", postId);
  return row ? postView(db, row, viewer) : undefined;
}

export function postExists(db: IndexerDb, postId: string): boolean {
  return db.get("SELECT 1 AS one FROM posts WHERE post_id = ?", postId) !== undefined;
}

/** Replies to a post, newest first, excluding deleted/hidden ones. */
export function replies(db: IndexerDb, postId: string, cursor: PositionCursor | undefined, limit: number, viewer?: string): Page<PostView> {
  return pagePosts(db, "p.reply_to = ? AND p.state NOT IN (1, 2)", [postId], cursor, limit, viewer);
}

// ---------------------------------------------------------------------------
// Profiles and graph
// ---------------------------------------------------------------------------

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
  encryptionKey: string;
  keyVersion: number;
  profileHash: string;
  profileUri: string;
  protocolVersion: number;
  deviceEpoch: number;
  registeredAt: string;
  updatedAt: string;
  counts: ProfileCounts;
  recovery: { policy: unknown; pendingPolicy: unknown; pendingRecovery: unknown };
  devices: DeviceView[];
}

export type ProfileSummary = Pick<ProfileView, "account" | "owner" | "encryptionKey" | "keyVersion" | "profileHash" | "profileUri" | "registeredAt" | "updatedAt">;

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function profileSummary(row: Row): ProfileSummary {
  return {
    account: String(row.account),
    owner: String(row.owner),
    encryptionKey: envelopeString(row.encryption_key),
    keyVersion: Number(row.key_version),
    profileHash: String(row.profile_hash),
    profileUri: String(row.profile_uri),
    registeredAt: String(row.registered_at),
    updatedAt: String(row.updated_at),
  };
}

export function profileCounts(db: IndexerDb, account: string): ProfileCounts {
  const count = (sql: string, ...params: string[]) => db.get<{ c: number }>(sql, ...params)?.c ?? 0;
  return {
    posts: count("SELECT COUNT(*) AS c FROM posts WHERE author = ? AND state NOT IN (1, 2)", account),
    friends: count("SELECT COUNT(*) AS c FROM relationships WHERE status = 2 AND (a = ? OR b = ?)", account, account),
    followers: count("SELECT COUNT(*) AS c FROM follows WHERE target = ?", account),
    following: count("SELECT COUNT(*) AS c FROM follows WHERE follower = ?", account),
  };
}

export function getProfile(db: IndexerDb, account: string): ProfileView | undefined {
  const row = db.get<Row>("SELECT * FROM identities WHERE account = ?", account);
  if (!row) return undefined;
  const devices = db.all<Row>("SELECT * FROM devices WHERE account = ? ORDER BY device ASC", account).map((d) => ({
    device: String(d.device),
    capabilities: Number(d.capabilities),
    expiresAt: String(d.expires_at),
    deviceEpoch: Number(d.device_epoch),
    revoked: Number(d.revoked) === 1,
    label: String(d.label),
    authorizedAt: String(d.authorized_at),
  }));
  return {
    ...profileSummary(row),
    protocolVersion: Number(row.protocol_version),
    deviceEpoch: Number(row.device_epoch),
    counts: profileCounts(db, account),
    recovery: {
      policy: parseJson(row.recovery_policy_json),
      pendingPolicy: parseJson(row.pending_policy_json),
      pendingRecovery: parseJson(row.pending_recovery_json),
    },
    devices,
  };
}

/** Accounts whose address starts with `query` (exact match first). */
export function searchProfiles(db: IndexerDb, query: string, limit: number): ProfileSummary[] {
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  return db
    .all<Row>(
      `SELECT * FROM identities WHERE account LIKE ? ESCAPE '\\' ORDER BY CASE WHEN account = ? THEN 0 ELSE 1 END, account ASC LIMIT ?`,
      `${escaped}%`,
      query,
      limit,
    )
    .map(profileSummary);
}

export interface GraphView {
  account: string;
  friends: Array<{ account: string; since: string; nonce: string }>;
  pendingIncoming: Array<{ account: string; requestedAt: string; nonce: string }>;
  pendingOutgoing: Array<{ account: string; requestedAt: string; nonce: string }>;
  followers: string[];
  following: string[];
  blocked: string[];
  blockedBy: string[];
  audienceEpoch: number;
}

export function currentEpoch(db: IndexerDb, account: string): number {
  return db.get<{ epoch: number | null }>("SELECT MAX(epoch) AS epoch FROM audiences WHERE account = ?", account)?.epoch ?? 0;
}

export function getGraph(db: IndexerDb, account: string): GraphView {
  const edges = db.all<Row>("SELECT * FROM relationships WHERE (a = ? OR b = ?) AND status IN (1, 2) ORDER BY a ASC, b ASC", account, account);
  const other = (row: Row) => (String(row.a) === account ? String(row.b) : String(row.a));
  const friends = edges
    .filter((r) => Number(r.status) === 2)
    .map((r) => ({ account: other(r), since: String(r.since), nonce: String(r.nonce) }));
  const pending = edges.filter((r) => Number(r.status) === 1);
  const pendingIncoming = pending
    .filter((r) => String(r.requester) !== account)
    .map((r) => ({ account: String(r.requester), requestedAt: String(r.requested_at), nonce: String(r.nonce) }));
  const pendingOutgoing = pending
    .filter((r) => String(r.requester) === account)
    .map((r) => ({ account: other(r), requestedAt: String(r.requested_at), nonce: String(r.nonce) }));
  const column = (sql: string, key: string) => db.all<Row>(sql, account).map((r) => String(r[key]));
  return {
    account,
    friends,
    pendingIncoming,
    pendingOutgoing,
    followers: column("SELECT follower FROM follows WHERE target = ? ORDER BY follower ASC", "follower"),
    following: column("SELECT target FROM follows WHERE follower = ? ORDER BY target ASC", "target"),
    blocked: column("SELECT target FROM blocks_list WHERE actor = ? ORDER BY target ASC", "target"),
    blockedBy: column("SELECT actor FROM blocks_list WHERE target = ? ORDER BY actor ASC", "actor"),
    audienceEpoch: currentEpoch(db, account),
  };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface NotificationView {
  id: string;
  kind: string;
  actor: string;
  postId?: string;
  communityId?: string;
  data: unknown;
  timestamp: string;
  blockHeight: string;
}

/**
 * Notifications in arrival order (ascending id). Without `since` the most recent `limit` items
 * are returned; with `since` (a previous `nextCursor`) only newer items, oldest first, so a
 * client polling with the cursor never misses one.
 */
export function notifications(db: IndexerDb, account: string, since: number | undefined, limit: number): Page<NotificationView> {
  const rows =
    since === undefined
      ? db.all<Row>("SELECT * FROM (SELECT * FROM notifications WHERE account = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC", account, limit)
      : db.all<Row>("SELECT * FROM notifications WHERE account = ? AND id > ? ORDER BY id ASC LIMIT ?", account, since, limit);
  const items = rows.map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    actor: String(row.actor),
    ...(row.post_id ? { postId: String(row.post_id) } : {}),
    ...(row.community_id ? { communityId: String(row.community_id) } : {}),
    data: parseJson(row.data_json) ?? {},
    timestamp: String(row.timestamp),
    blockHeight: String(row.block_height),
  }));
  const last = items[items.length - 1];
  return { items, nextCursor: last ? last.id : since !== undefined ? String(since) : null };
}

// ---------------------------------------------------------------------------
// Keys and audiences
// ---------------------------------------------------------------------------

export interface SealedKeyView {
  author: string;
  audienceId: string;
  epoch: number;
  recipient: string;
  recipientKeyVersion: number;
  sealedKey: string;
  blockHeight: string;
  txId: string;
  timestamp: string;
}

export interface KeysFilter {
  author?: string;
  audienceId?: string;
  epoch?: number;
  limit?: number;
}

export function keysFor(db: IndexerDb, recipient: string, filter: KeysFilter = {}): SealedKeyView[] {
  const conditions = ["recipient = ?"];
  const params: (string | number)[] = [recipient];
  if (filter.author !== undefined) {
    conditions.push("author = ?");
    params.push(filter.author);
  }
  if (filter.audienceId !== undefined) {
    conditions.push("audience_id = ?");
    params.push(filter.audienceId);
  }
  if (filter.epoch !== undefined) {
    conditions.push("epoch = ?");
    params.push(filter.epoch);
  }
  params.push(filter.limit ?? 500);
  return db
    .all<Row>(`SELECT * FROM key_packages WHERE ${conditions.join(" AND ")} ORDER BY height ASC, tx_index ASC, sequence ASC, key_index ASC LIMIT ?`, ...params)
    .map((row) => ({
      author: String(row.author),
      audienceId: String(row.audience_id),
      epoch: Number(row.epoch),
      recipient: String(row.recipient),
      recipientKeyVersion: Number(row.recipient_key_version),
      sealedKey: envelopeString(row.sealed_key),
      blockHeight: String(row.height),
      txId: String(row.tx_id),
      timestamp: String(row.timestamp),
    }));
}

export interface AudienceView {
  author: string;
  audienceId: string;
  epoch: number;
  epochs: Array<{ epoch: number; since: string; reason: string }>;
}

/** Epoch history of the friends audience (from audience_rotated) or of a custom audience (from key distributions). */
export function audienceView(db: IndexerDb, author: string, audienceId: string): AudienceView {
  if (audienceId === "") {
    const identity = db.get<{ registered_at: string }>("SELECT registered_at FROM identities WHERE account = ?", author);
    const epochs = db
      .all<Row>("SELECT epoch, since, reason FROM audiences WHERE account = ? ORDER BY epoch ASC", author)
      .map((r) => ({ epoch: Number(r.epoch), since: String(r.since), reason: String(r.reason) }));
    if (identity && !epochs.some((e) => e.epoch === 0)) epochs.unshift({ epoch: 0, since: identity.registered_at, reason: "initial" });
    const last = epochs[epochs.length - 1];
    return { author, audienceId, epoch: last?.epoch ?? 0, epochs };
  }
  const epochs = db
    .all<Row>("SELECT epoch, MIN(timestamp) AS since FROM key_packages WHERE author = ? AND audience_id = ? GROUP BY epoch ORDER BY epoch ASC", author, audienceId)
    .map((r) => ({ epoch: Number(r.epoch), since: String(r.since), reason: "keys_distributed" }));
  const last = epochs[epochs.length - 1];
  return { author, audienceId, epoch: last?.epoch ?? 0, epochs };
}

// ---------------------------------------------------------------------------
// Communities, labels, sponsors, registry
// ---------------------------------------------------------------------------

export interface RoleView {
  subject: string;
  role: number;
  scope: string;
  expiresAt: string;
  grantedBy: string;
  grantedAt: string;
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

export function getCommunity(db: IndexerDb, id: string): CommunityView | undefined {
  const row = db.get<Row>("SELECT * FROM communities WHERE id = ?", id);
  if (!row) return undefined;
  const roles = db.all<Row>("SELECT * FROM roles WHERE community_id = ? ORDER BY subject ASC", id).map((r) => ({
    subject: String(r.subject),
    role: Number(r.role),
    scope: String(r.scope),
    expiresAt: String(r.expires_at),
    grantedBy: String(r.granted_by),
    grantedAt: String(r.granted_at),
  }));
  return {
    id: String(row.id),
    owner: String(row.owner),
    name: String(row.name),
    policyHash: String(row.policy_hash),
    policyUri: String(row.policy_uri),
    transferDelayMs: String(row.transfer_delay_ms),
    pendingOwner: String(row.pending_owner),
    transferEffectiveAt: String(row.transfer_effective_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    roles,
  };
}

export function labelsQuery(db: IndexerDb, filter: { postId?: string; communityId?: string }, limit: number): LabelView[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filter.postId !== undefined) {
    conditions.push("post_id = ?");
    params.push(filter.postId);
  }
  if (filter.communityId !== undefined) {
    conditions.push("community_id = ?");
    params.push(filter.communityId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .all<Row>(`SELECT * FROM labels ${where} ORDER BY height DESC, tx_index DESC, sequence DESC LIMIT ?`, ...params, limit)
    .map((row) => ({
      communityId: String(row.community_id),
      postId: String(row.post_id),
      label: String(row.label),
      reason: String(row.reason),
      actor: String(row.actor),
      timestamp: String(row.timestamp),
      blockHeight: String(row.height),
      txId: String(row.tx_id),
    }));
}

export interface SponsorView {
  sponsor: string;
  endpoint: string;
  policyVersion: number;
  active: boolean;
  registeredAt: string;
  updatedAt: string;
}

export function sponsors(db: IndexerDb): SponsorView[] {
  return db.all<Row>("SELECT * FROM sponsors ORDER BY active DESC, sponsor ASC").map((row) => ({
    sponsor: String(row.sponsor),
    endpoint: String(row.endpoint),
    policyVersion: Number(row.policy_version),
    active: Number(row.active) === 1,
    registeredAt: String(row.registered_at),
    updatedAt: String(row.updated_at),
  }));
}

export interface RegistryEntryView {
  name: string;
  address: string;
  version: number;
  abiHash: string;
  status: number;
  effectiveAt: string;
  updatedAt: string;
}

export function registryEntries(db: IndexerDb): RegistryEntryView[] {
  return db.all<Row>("SELECT * FROM registry_entries ORDER BY name ASC, version ASC, address ASC").map((row) => ({
    name: String(row.name),
    address: String(row.address),
    version: Number(row.version),
    abiHash: String(row.abi_hash),
    status: Number(row.status),
    effectiveAt: String(row.effective_at),
    updatedAt: String(row.updated_at),
  }));
}

// ---------------------------------------------------------------------------
// Events and conformance
// ---------------------------------------------------------------------------

export interface EventLogView {
  height: string;
  blockId: string;
  txId: string;
  txIndex: number;
  sequence: number;
  contract: string;
  name: string;
  data: unknown;
  impacted: string[];
}

function eventLogView(row: EventLogRow): EventLogView {
  return {
    height: String(row.height),
    blockId: row.block_id,
    txId: row.tx_id,
    txIndex: row.tx_index,
    sequence: row.sequence,
    contract: row.contract,
    name: row.name,
    data: parseJson(row.data_json) ?? {},
    impacted: (parseJson(row.impacted_json) as string[] | null) ?? [],
  };
}

/**
 * Decoded events from `fromHeight`, whole blocks at a time (never splits a block across pages).
 * `nextHeight` is the height to continue from; it is `null` once the indexed tip is reached.
 */
export function eventsFrom(db: IndexerDb, fromHeight: number, limit: number): { items: EventLogView[]; nextHeight: string | null } {
  const tip = db.lastCheckpoint();
  if (!tip || fromHeight > tip.height) return { items: [], nextHeight: null };
  const rows = db.all<EventLogRow>("SELECT * FROM event_log WHERE height >= ? ORDER BY height ASC, tx_index ASC, sequence ASC LIMIT ?", fromHeight, limit + 1);
  if (rows.length <= limit) {
    return { items: rows.map(eventLogView), nextHeight: null };
  }
  const extra = rows[limit]!;
  let page = rows.slice(0, limit);
  const lastFull = page[page.length - 1]!;
  if (extra.height === lastFull.height) {
    // The block at extra.height is split by the limit: drop it from this page ...
    page = page.filter((row) => row.height !== extra.height);
    if (page.length === 0) {
      // ... unless it is the only block, which is then served whole.
      const whole = db.all<EventLogRow>("SELECT * FROM event_log WHERE height = ? ORDER BY tx_index ASC, sequence ASC", extra.height);
      return { items: whole.map(eventLogView), nextHeight: extra.height >= tip.height ? null : String(extra.height + 1) };
    }
  }
  return { items: page.map(eventLogView), nextHeight: String(extra.height) };
}

export interface StateHashView {
  height: string;
  blockId: string;
  stateHash: string;
}

export function stateHashAt(db: IndexerDb, height?: number): StateHashView | undefined {
  const row: CheckpointRow | undefined = height === undefined ? db.lastCheckpoint() : db.checkpointAt(height);
  return row ? { height: String(row.height), blockId: row.block_id, stateHash: row.state_hash } : undefined;
}
