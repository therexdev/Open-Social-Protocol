/**
 * Projections: every `osp.*` event applied deterministically to the query tables.
 *
 * Projections are a pure function of the event log (`event_log` in canonical order:
 * height, transaction index, event sequence). `replayProjections` truncates them and
 * re-applies the whole log, which is what a reorg rollback and `--rebuild` rely on.
 *
 * Decoded values follow the SDK object model: addresses are Base58 strings, bytes are
 * Uint8Array, uint64 are decimal strings, enums are numbers.
 */
import { decodeEventData, encode, parseKeyPackageSet, toBase58, toBase64url, type ContractName, type ProtoObject } from "@osp/sdk";
import type { IndexerDb, Row } from "./db.js";
import { toJsonValue } from "./hash.js";

export interface LogEvent {
  height: number;
  blockId: string;
  /** Block timestamp (ms, decimal string). */
  blockTimestamp: string;
  txIndex: number;
  sequence: number;
  txId: string;
  contract: ContractName;
  name: string;
  data: ProtoObject;
  impacted: string[];
}

export type NotificationKind =
  | "friend_request"
  | "friend_accepted"
  | "reaction"
  | "reply"
  | "keys"
  | "role"
  | "label"
  | "recovery"
  | "device";

export interface EventLogRow extends Row {
  height: number;
  tx_index: number;
  sequence: number;
  block_id: string;
  block_timestamp: string;
  tx_id: string;
  contract: string;
  name: string;
  data: string;
  data_json: string;
  impacted_json: string;
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

const EMPTY = new Uint8Array(0);

function bytes(value: unknown): Uint8Array {
  return value instanceof Uint8Array ? value : EMPTY;
}

/** base64url of a bytes field ("" when empty). */
function b64(value: unknown): string {
  const b = bytes(value);
  return b.length === 0 ? "" : toBase64url(b);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function u64(value: unknown): string {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return String(value);
  if (typeof value === "bigint" && value >= 0n) return value.toString();
  return "0";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function bool(value: unknown): number {
  return value === true ? 1 : 0;
}

/** The event's own timestamp, falling back to the block timestamp for events without one. */
function timestampOf(event: LogEvent): string {
  const own = event.data.timestamp;
  return typeof own === "string" ? own : event.blockTimestamp;
}

/** Canonical (sorted) pair key for relationships. */
export function pairKey(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

function json(value: unknown): string {
  return JSON.stringify(toJsonValue(value));
}

function nextNotificationId(db: IndexerDb): number {
  const row = db.get<{ next: number }>("SELECT COALESCE(MAX(id), 0) + 1 AS next FROM notifications");
  return row?.next ?? 1;
}

interface NotificationInput {
  account: string;
  kind: NotificationKind;
  actor: string;
  postId?: string;
  communityId?: string;
  data?: Record<string, unknown>;
}

function notify(db: IndexerDb, event: LogEvent, n: NotificationInput): void {
  if (!n.account || n.account === n.actor) return;
  db.run(
    `INSERT INTO notifications (id, account, kind, actor, post_id, community_id, data_json, timestamp, block_height, tx_index, sequence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    nextNotificationId(db),
    n.account,
    n.kind,
    n.actor,
    n.postId ?? null,
    n.communityId ?? null,
    JSON.stringify(n.data ?? {}),
    timestampOf(event),
    event.height,
    event.txIndex,
    event.sequence,
  );
}

// ---------------------------------------------------------------------------
// identity
// ---------------------------------------------------------------------------

function recoveryPolicyJson(policy: unknown): string | null {
  if (!policy || typeof policy !== "object") return null;
  const p = policy as Record<string, unknown>;
  return JSON.stringify({
    guardians: Array.isArray(p.guardians) ? p.guardians.map(String) : [],
    threshold: num(p.threshold),
    delayMs: u64(p.delay_ms),
  });
}

function applyIdentity(db: IndexerDb, event: LogEvent): void {
  const d = event.data;
  const account = str(d.account);
  const ts = timestampOf(event);
  switch (event.name) {
    case "osp.identity.registered":
      db.run(
        `INSERT INTO identities (account, owner, encryption_key, key_version, profile_hash, profile_uri, protocol_version, device_epoch, registered_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(account) DO UPDATE SET owner = excluded.owner, encryption_key = excluded.encryption_key, key_version = excluded.key_version,
           profile_hash = excluded.profile_hash, profile_uri = excluded.profile_uri, protocol_version = excluded.protocol_version,
           device_epoch = 0, registered_at = excluded.registered_at, updated_at = excluded.updated_at,
           recovery_policy_json = NULL, pending_policy_json = NULL, pending_recovery_json = NULL`,
        account,
        account,
        bytes(d.encryption_key),
        num(d.key_version),
        b64(d.profile_hash),
        str(d.profile_uri),
        num(d.protocol_version),
        ts,
        ts,
      );
      return;
    case "osp.identity.profile_updated":
      db.run("UPDATE identities SET profile_hash = ?, profile_uri = ?, updated_at = ? WHERE account = ?", b64(d.profile_hash), str(d.profile_uri), ts, account);
      return;
    case "osp.identity.key_rotated":
      db.run(
        "UPDATE identities SET encryption_key = ?, key_version = ?, updated_at = ? WHERE account = ?",
        bytes(d.encryption_key),
        num(d.key_version),
        ts,
        account,
      );
      return;
    case "osp.identity.device_authorized": {
      const device = str(d.device);
      db.run(
        `INSERT INTO devices (account, device, capabilities, expires_at, device_epoch, revoked, label, authorized_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
         ON CONFLICT(account, device) DO UPDATE SET capabilities = excluded.capabilities, expires_at = excluded.expires_at,
           device_epoch = excluded.device_epoch, revoked = 0, label = excluded.label, authorized_at = excluded.authorized_at, updated_at = excluded.updated_at`,
        account,
        device,
        num(d.capabilities),
        u64(d.expires_at),
        num(d.device_epoch),
        str(d.label),
        ts,
        ts,
      );
      notify(db, event, {
        account,
        kind: "device",
        actor: device,
        data: { action: "authorized", device, capabilities: num(d.capabilities), expiresAt: u64(d.expires_at), label: str(d.label) },
      });
      return;
    }
    case "osp.identity.device_revoked": {
      const device = str(d.device);
      db.run("UPDATE devices SET revoked = 1, updated_at = ? WHERE account = ? AND device = ?", ts, account, device);
      notify(db, event, { account, kind: "device", actor: device, data: { action: "revoked", device } });
      return;
    }
    case "osp.identity.recovery_policy_proposed":
      db.run(
        "UPDATE identities SET pending_policy_json = ?, updated_at = ? WHERE account = ?",
        JSON.stringify({ policy: JSON.parse(recoveryPolicyJson(d.policy) ?? "null"), effectiveAt: u64(d.effective_at) }),
        ts,
        account,
      );
      return;
    case "osp.identity.recovery_policy_set":
      db.run(
        "UPDATE identities SET recovery_policy_json = ?, pending_policy_json = NULL, updated_at = ? WHERE account = ?",
        recoveryPolicyJson(d.policy),
        ts,
        account,
      );
      return;
    case "osp.identity.recovery_policy_cancelled":
      db.run("UPDATE identities SET pending_policy_json = NULL, updated_at = ? WHERE account = ?", ts, account);
      return;
    case "osp.identity.recovery_proposed": {
      const pending = {
        newOwner: str(d.new_owner),
        guardian: str(d.guardian),
        approvals: num(d.approvals),
        threshold: num(d.threshold),
        effectiveAt: u64(d.effective_at),
        proposedAt: ts,
      };
      db.run("UPDATE identities SET pending_recovery_json = ?, updated_at = ? WHERE account = ?", JSON.stringify(pending), ts, account);
      notify(db, event, { account, kind: "recovery", actor: str(d.guardian), data: { action: "proposed", ...pending } });
      return;
    }
    case "osp.identity.recovery_cancelled":
      db.run("UPDATE identities SET pending_recovery_json = NULL, updated_at = ? WHERE account = ?", ts, account);
      return;
    case "osp.identity.recovered": {
      const newOwner = str(d.new_owner);
      db.run(
        "UPDATE identities SET owner = ?, device_epoch = ?, pending_recovery_json = NULL, updated_at = ? WHERE account = ?",
        newOwner,
        num(d.device_epoch),
        ts,
        account,
      );
      notify(db, event, {
        account,
        kind: "recovery",
        actor: newOwner,
        data: { action: "executed", previousOwner: str(d.previous_owner), newOwner, deviceEpoch: num(d.device_epoch) },
      });
      return;
    }
    default:
      return;
  }
}

// ---------------------------------------------------------------------------
// relationships
// ---------------------------------------------------------------------------

interface RelationshipRow extends Row {
  a: string;
  b: string;
  status: number;
  requester: string;
  nonce: string;
  requested_at: string;
  since: string;
  updated_at: string;
}

function getRelationship(db: IndexerDb, x: string, y: string): RelationshipRow | undefined {
  const [a, b] = pairKey(x, y);
  return db.get<RelationshipRow>("SELECT * FROM relationships WHERE a = ? AND b = ?", a, b);
}

function upsertRelationship(db: IndexerDb, row: RelationshipRow): void {
  db.run(
    `INSERT INTO relationships (a, b, status, requester, nonce, requested_at, since, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(a, b) DO UPDATE SET status = excluded.status, requester = excluded.requester, nonce = excluded.nonce,
       requested_at = excluded.requested_at, since = excluded.since, updated_at = excluded.updated_at`,
    row.a,
    row.b,
    row.status,
    row.requester,
    row.nonce,
    row.requested_at,
    row.since,
    row.updated_at,
  );
}

function applyRelationships(db: IndexerDb, event: LogEvent): void {
  const d = event.data;
  const ts = timestampOf(event);
  switch (event.name) {
    case "osp.relationships.friend_requested": {
      const requester = str(d.requester);
      const recipient = str(d.recipient);
      const [a, b] = pairKey(requester, recipient);
      upsertRelationship(db, {
        a,
        b,
        status: 1,
        requester,
        nonce: u64(d.nonce),
        requested_at: ts,
        since: "0",
        updated_at: ts,
      });
      notify(db, event, { account: recipient, kind: "friend_request", actor: requester, data: { nonce: u64(d.nonce) } });
      return;
    }
    case "osp.relationships.friend_accepted": {
      const approver = str(d.approver);
      const requester = str(d.requester);
      const [a, b] = pairKey(approver, requester);
      const existing = getRelationship(db, a, b);
      upsertRelationship(db, {
        a,
        b,
        status: 2,
        requester,
        nonce: u64(d.nonce),
        requested_at: existing?.requested_at ?? ts,
        since: ts,
        updated_at: ts,
      });
      notify(db, event, { account: requester, kind: "friend_accepted", actor: approver, data: { nonce: u64(d.nonce), keyPackageRef: b64(d.key_package_ref) } });
      return;
    }
    case "osp.relationships.friend_removed": {
      const actor = str(d.actor);
      const peer = str(d.peer);
      const [a, b] = pairKey(actor, peer);
      const existing = getRelationship(db, a, b);
      upsertRelationship(db, {
        a,
        b,
        status: 3,
        requester: existing?.requester ?? "",
        nonce: u64(d.nonce),
        requested_at: existing?.requested_at ?? "0",
        since: existing?.since ?? "0",
        updated_at: ts,
      });
      return;
    }
    case "osp.relationships.blocked": {
      const actor = str(d.actor);
      const target = str(d.target);
      db.run("INSERT INTO blocks_list (actor, target, since) VALUES (?, ?, ?) ON CONFLICT(actor, target) DO UPDATE SET since = excluded.since", actor, target, ts);
      const existing = getRelationship(db, actor, target);
      if (existing && (existing.status === 1 || existing.status === 2)) {
        // Mirrors the contract: the edge becomes inactive and its nonce advances (spec section 4).
        upsertRelationship(db, { ...existing, status: 3, nonce: (BigInt(existing.nonce) + 1n).toString(), updated_at: ts });
      }
      db.run("DELETE FROM follows WHERE (follower = ? AND target = ?) OR (follower = ? AND target = ?)", actor, target, target, actor);
      return;
    }
    case "osp.relationships.unblocked":
      db.run("DELETE FROM blocks_list WHERE actor = ? AND target = ?", str(d.actor), str(d.target));
      return;
    case "osp.relationships.followed":
      db.run(
        "INSERT INTO follows (follower, target, since) VALUES (?, ?, ?) ON CONFLICT(follower, target) DO UPDATE SET since = excluded.since",
        str(d.follower),
        str(d.target),
        ts,
      );
      return;
    case "osp.relationships.unfollowed":
      db.run("DELETE FROM follows WHERE follower = ? AND target = ?", str(d.follower), str(d.target));
      return;
    case "osp.relationships.audience_rotated":
      db.run(
        `INSERT INTO audiences (account, epoch, since, reason, height) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(account, epoch) DO UPDATE SET since = excluded.since, reason = excluded.reason, height = excluded.height`,
        str(d.account),
        num(d.new_epoch),
        ts,
        str(d.reason),
        event.height,
      );
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------------------
// publications
// ---------------------------------------------------------------------------

/** API shape of a media ref (`PostView.media[]`). */
export function mediaView(media: unknown): Array<{ contentHash: string; mime: string; size: string; locations: string[]; keyRef: string }> {
  if (!Array.isArray(media)) return [];
  return media.map((item) => {
    const m = (item ?? {}) as Record<string, unknown>;
    return {
      contentHash: b64(m.content_hash),
      mime: str(m.mime),
      size: u64(m.size),
      locations: Array.isArray(m.locations) ? m.locations.map(String) : [],
      keyRef: b64(m.key_ref),
    };
  });
}

interface PostRow extends Row {
  post_id: string;
  author: string;
  state: number;
}

function applyPublications(db: IndexerDb, event: LogEvent): void {
  const d = event.data;
  const ts = timestampOf(event);
  switch (event.name) {
    case "osp.publications.published": {
      const author = str(d.author);
      const postId = b64(d.post_id);
      const contentHash = b64(d.content_hash);
      const versionNumber = num(d.version_number) || 1;
      const envelope = bytes(d.envelope);
      const media = JSON.stringify(mediaView(d.media));
      const existing = db.get<PostRow>("SELECT post_id, author, state FROM posts WHERE post_id = ?", postId);
      if (!existing) {
        db.run(
          `INSERT INTO posts (post_id, author, sequence, version_number, content_hash, previous_version, audience, audience_id, epoch, envelope, media_json,
             reply_to, idempotency_key, protocol_version, state, state_reason, replacement_id, created_at, updated_at, tx_id, block_height, tx_index, event_sequence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', '', ?, ?, ?, ?, ?, ?)`,
          postId,
          author,
          u64(d.sequence),
          versionNumber,
          contentHash,
          b64(d.previous_version),
          num(d.audience),
          b64(d.audience_id),
          num(d.epoch),
          envelope,
          media,
          b64(d.reply_to),
          b64(d.idempotency_key),
          num(d.protocol_version),
          ts,
          ts,
          event.txId,
          event.height,
          event.txIndex,
          event.sequence,
        );
      } else {
        db.run(
          `UPDATE posts SET version_number = ?, content_hash = ?, previous_version = ?, epoch = ?, envelope = ?, media_json = ?, updated_at = ?
           WHERE post_id = ?`,
          versionNumber,
          contentHash,
          b64(d.previous_version),
          num(d.epoch),
          envelope,
          media,
          ts,
          postId,
        );
      }
      db.run(
        `INSERT INTO post_versions (post_id, version_number, content_hash, previous_version, envelope, media_json, tx_id, block_height, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(post_id, version_number) DO UPDATE SET content_hash = excluded.content_hash, previous_version = excluded.previous_version,
           envelope = excluded.envelope, media_json = excluded.media_json, tx_id = excluded.tx_id, block_height = excluded.block_height, timestamp = excluded.timestamp`,
        postId,
        versionNumber,
        contentHash,
        b64(d.previous_version),
        envelope,
        media,
        event.txId,
        event.height,
        ts,
      );
      const replyTo = b64(d.reply_to);
      if (!existing && replyTo) {
        const parent = db.get<PostRow>("SELECT post_id, author, state FROM posts WHERE post_id = ?", replyTo);
        if (parent) notify(db, event, { account: parent.author, kind: "reply", actor: author, postId: replyTo, data: { replyId: postId } });
      }
      return;
    }
    case "osp.publications.lifecycle": {
      // A later lifecycle event wins; deleted is terminal (spec section 6).
      db.run(
        "UPDATE posts SET state = ?, state_reason = ?, replacement_id = ?, updated_at = ? WHERE post_id = ? AND state != 2",
        num(d.state),
        str(d.reason),
        b64(d.replacement_id),
        ts,
        b64(d.post_id),
      );
      return;
    }
    case "osp.publications.reaction": {
      const actor = str(d.actor);
      const postId = b64(d.post_id);
      const reaction = num(d.reaction);
      if (d.removed === true) {
        db.run("DELETE FROM reactions WHERE post_id = ? AND actor = ? AND reaction = ?", postId, actor, reaction);
        return;
      }
      db.run(
        `INSERT INTO reactions (post_id, actor, reaction, timestamp, block_height, tx_id) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(post_id, actor, reaction) DO UPDATE SET timestamp = excluded.timestamp, block_height = excluded.block_height, tx_id = excluded.tx_id`,
        postId,
        actor,
        reaction,
        ts,
        event.height,
        event.txId,
      );
      notify(db, event, { account: str(d.post_author), kind: "reaction", actor, postId, data: { reaction } });
      return;
    }
    case "osp.publications.keys_distributed": {
      const author = str(d.author);
      const audienceId = b64(d.audience_id);
      const epoch = num(d.epoch);
      let set;
      try {
        set = parseKeyPackageSet(bytes(d.packages));
      } catch {
        return; // malformed package set: the event stays in the log, nothing to project
      }
      set.keys.forEach((key, index) => {
        if (key.recipient.length !== 25) return;
        const recipient = toBase58(key.recipient);
        const sealed = encode("osp.envelope.sealed_key", key as unknown as ProtoObject);
        db.run(
          `INSERT INTO key_packages (height, tx_index, sequence, key_index, author, audience_id, epoch, recipient, recipient_key_version, sealed_key, tx_id, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(height, tx_index, sequence, key_index) DO NOTHING`,
          event.height,
          event.txIndex,
          event.sequence,
          index,
          author,
          audienceId,
          epoch,
          recipient,
          num(key.recipient_key_version),
          sealed,
          event.txId,
          ts,
        );
        notify(db, event, { account: recipient, kind: "keys", actor: author, data: { audienceId, epoch } });
      });
      return;
    }
    case "osp.publications.cross_post_outcome":
      db.run(
        `INSERT INTO cross_posts (author, idempotency_key, adapter, state, external_ref, post_id, manifest_hash, timestamp, block_height, tx_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(author, idempotency_key, adapter) DO UPDATE SET state = excluded.state, external_ref = excluded.external_ref, post_id = excluded.post_id,
           manifest_hash = excluded.manifest_hash, timestamp = excluded.timestamp, block_height = excluded.block_height, tx_id = excluded.tx_id`,
        str(d.author),
        b64(d.idempotency_key),
        str(d.adapter),
        num(d.state),
        str(d.external_ref),
        b64(d.post_id),
        b64(d.manifest_hash),
        ts,
        event.height,
        event.txId,
      );
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------------------
// communities
// ---------------------------------------------------------------------------

function applyCommunities(db: IndexerDb, event: LogEvent): void {
  const d = event.data;
  const ts = timestampOf(event);
  switch (event.name) {
    case "osp.communities.community_created":
      db.run(
        `INSERT INTO communities (id, owner, name, policy_hash, policy_uri, transfer_delay_ms, pending_owner, transfer_effective_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '', '0', ?, ?)
         ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, name = excluded.name, policy_hash = excluded.policy_hash, policy_uri = excluded.policy_uri,
           transfer_delay_ms = excluded.transfer_delay_ms, pending_owner = '', transfer_effective_at = '0', created_at = excluded.created_at, updated_at = excluded.updated_at`,
        b64(d.id),
        str(d.owner),
        str(d.name),
        b64(d.policy_hash),
        str(d.policy_uri),
        u64(d.transfer_delay_ms),
        ts,
        ts,
      );
      return;
    case "osp.communities.role_set": {
      const communityId = b64(d.community_id);
      const subject = str(d.subject);
      const actor = str(d.actor);
      const role = num(d.role);
      if (role === 0) {
        db.run("DELETE FROM roles WHERE community_id = ? AND subject = ?", communityId, subject);
      } else {
        db.run(
          `INSERT INTO roles (community_id, subject, role, scope, expires_at, granted_by, granted_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(community_id, subject) DO UPDATE SET role = excluded.role, scope = excluded.scope, expires_at = excluded.expires_at,
             granted_by = excluded.granted_by, granted_at = excluded.granted_at`,
          communityId,
          subject,
          role,
          b64(d.scope),
          u64(d.expires_at),
          actor,
          ts,
        );
      }
      db.run("UPDATE communities SET updated_at = ? WHERE id = ?", ts, communityId);
      notify(db, event, { account: subject, kind: "role", actor, communityId, data: { role, scope: b64(d.scope), expiresAt: u64(d.expires_at) } });
      return;
    }
    case "osp.communities.policy_set":
      db.run("UPDATE communities SET policy_hash = ?, policy_uri = ?, updated_at = ? WHERE id = ?", b64(d.policy_hash), str(d.policy_uri), ts, b64(d.community_id));
      return;
    case "osp.communities.owner_transfer_proposed":
      db.run(
        "UPDATE communities SET pending_owner = ?, transfer_effective_at = ?, updated_at = ? WHERE id = ?",
        str(d.new_owner),
        u64(d.effective_at),
        ts,
        b64(d.community_id),
      );
      return;
    case "osp.communities.owner_transfer_cancelled":
      db.run("UPDATE communities SET pending_owner = '', transfer_effective_at = '0', updated_at = ? WHERE id = ?", ts, b64(d.community_id));
      return;
    case "osp.communities.owner_transferred":
      db.run(
        "UPDATE communities SET owner = ?, pending_owner = '', transfer_effective_at = '0', updated_at = ? WHERE id = ?",
        str(d.new_owner),
        ts,
        b64(d.community_id),
      );
      return;
    case "osp.communities.label_set": {
      const communityId = b64(d.community_id);
      const postId = b64(d.post_id);
      const actor = str(d.actor);
      db.run(
        `INSERT INTO labels (height, tx_index, sequence, community_id, post_id, label, reason, actor, timestamp, tx_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(height, tx_index, sequence) DO NOTHING`,
        event.height,
        event.txIndex,
        event.sequence,
        communityId,
        postId,
        str(d.label),
        str(d.reason),
        actor,
        ts,
        event.txId,
      );
      const post = db.get<PostRow>("SELECT post_id, author, state FROM posts WHERE post_id = ?", postId);
      if (post) notify(db, event, { account: post.author, kind: "label", actor, postId, communityId, data: { label: str(d.label), reason: str(d.reason) } });
      return;
    }
    default:
      return;
  }
}

// ---------------------------------------------------------------------------
// sponsorship
// ---------------------------------------------------------------------------

function applySponsorship(db: IndexerDb, event: LogEvent): void {
  const d = event.data;
  const ts = timestampOf(event);
  switch (event.name) {
    case "osp.sponsorship.sponsor_set":
      db.run(
        `INSERT INTO sponsors (sponsor, endpoint, policy_version, active, registered_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(sponsor) DO UPDATE SET endpoint = excluded.endpoint, policy_version = excluded.policy_version, active = excluded.active, updated_at = excluded.updated_at`,
        str(d.sponsor),
        str(d.endpoint),
        num(d.policy_version),
        bool(d.active),
        ts,
        ts,
      );
      return;
    case "osp.sponsorship.sponsor_deactivated":
      db.run("UPDATE sponsors SET active = 0, updated_at = ? WHERE sponsor = ?", ts, str(d.sponsor));
      return;
    case "osp.sponsorship.user_grant_set":
      db.run(
        `INSERT INTO user_grants (sponsor, user, daily_ops, expires_at, revoked, updated_at) VALUES (?, ?, ?, ?, 0, ?)
         ON CONFLICT(sponsor, user) DO UPDATE SET daily_ops = excluded.daily_ops, expires_at = excluded.expires_at, revoked = 0, updated_at = excluded.updated_at`,
        str(d.sponsor),
        str(d.user),
        num(d.daily_ops),
        u64(d.expires_at),
        ts,
      );
      return;
    case "osp.sponsorship.user_grant_revoked":
      db.run("UPDATE user_grants SET revoked = 1, updated_at = ? WHERE sponsor = ? AND user = ?", ts, str(d.sponsor), str(d.user));
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

function applyRegistry(db: IndexerDb, event: LogEvent): void {
  const d = event.data;
  const ts = timestampOf(event);
  const upsert = (status: number, effectiveAt: string, abiHash?: string) =>
    db.run(
      `INSERT INTO registry_entries (name, address, version, abi_hash, status, effective_at, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, '', ?)
       ON CONFLICT(name, address, version) DO UPDATE SET status = excluded.status, effective_at = excluded.effective_at,
         abi_hash = CASE WHEN excluded.abi_hash = '' THEN registry_entries.abi_hash ELSE excluded.abi_hash END, updated_at = excluded.updated_at`,
      str(d.name),
      str(d.address),
      num(d.version),
      abiHash ?? "",
      status,
      effectiveAt,
      ts,
    );
  switch (event.name) {
    case "osp.registry.contract_proposed":
      upsert(0, u64(d.effective_at), b64(d.abi_hash));
      return;
    case "osp.registry.contract_activated":
      upsert(1, ts);
      return;
    case "osp.registry.contract_cancelled":
      db.run("DELETE FROM registry_entries WHERE name = ? AND status = 0", str(d.name));
      return;
    case "osp.registry.contract_deprecated":
      upsert(2, ts);
      return;
    case "osp.registry.admin_proposed":
      db.setMeta("projection.registry.pending_admin", JSON.stringify({ newAdmin: str(d.new_admin), effectiveAt: u64(d.effective_at) }));
      return;
    case "osp.registry.admin_changed":
      db.setMeta("projection.registry.admin", str(d.new_admin));
      db.deleteMeta("projection.registry.pending_admin");
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------------------
// Dispatch and replay
// ---------------------------------------------------------------------------

/** Applies one decoded event to the projections. Must run inside a transaction. */
export function applyEvent(db: IndexerDb, event: LogEvent): void {
  switch (event.contract) {
    case "identity":
      return applyIdentity(db, event);
    case "relationships":
      return applyRelationships(db, event);
    case "publications":
      return applyPublications(db, event);
    case "communities":
      return applyCommunities(db, event);
    case "sponsorship":
      return applySponsorship(db, event);
    case "registry":
      return applyRegistry(db, event);
    default:
      return;
  }
}

/** Rehydrates a log row into a LogEvent (decoding the raw event bytes again). */
export function logEventFromRow(row: EventLogRow): LogEvent | undefined {
  const data = decodeEventData(row.name, row.data);
  if (!data) return undefined;
  let impacted: string[] = [];
  try {
    const parsed = JSON.parse(row.impacted_json) as unknown;
    if (Array.isArray(parsed)) impacted = parsed.map(String);
  } catch {
    impacted = [];
  }
  return {
    height: row.height,
    blockId: row.block_id,
    blockTimestamp: row.block_timestamp,
    txIndex: row.tx_index,
    sequence: row.sequence,
    txId: row.tx_id,
    contract: row.contract as ContractName,
    name: row.name,
    data,
    impacted,
  };
}

/** Truncates every projection table and re-applies the whole event log. Returns the number of events applied. */
export function replayProjections(db: IndexerDb): number {
  return db.transaction(() => {
    db.truncateProjections();
    let applied = 0;
    // Keyset pagination keeps memory bounded and avoids holding a read cursor open while writing.
    let cursor: [number, number, number] = [-1, -1, -1];
    for (;;) {
      const rows = db.all<EventLogRow>(
        `SELECT * FROM event_log WHERE (height, tx_index, sequence) > (?, ?, ?) ORDER BY height ASC, tx_index ASC, sequence ASC LIMIT 1000`,
        ...cursor,
      );
      if (rows.length === 0) break;
      for (const row of rows) {
        const event = logEventFromRow(row);
        if (event) {
          applyEvent(db, event);
          applied++;
        }
      }
      const last = rows[rows.length - 1]!;
      cursor = [last.height, last.tx_index, last.sequence];
    }
    return applied;
  });
}
