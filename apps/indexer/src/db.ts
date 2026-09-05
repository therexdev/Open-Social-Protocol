/**
 * SQLite storage (node:sqlite DatabaseSync) with versioned migrations.
 *
 * Two kinds of tables live here:
 *  - authoritative log: `checkpoints` and `event_log` (what the chain said, in canonical order);
 *  - projections: everything else, a pure function of the log. They can be truncated and
 *    rebuilt at any time (`replayProjections` in projections.ts), which is how reorgs are
 *    handled and how `--rebuild` works.
 *
 * Value conventions: addresses are Base58 TEXT; identifier-like bytes (post ids, hashes,
 * audience ids, community ids, scopes) are base64url TEXT; payload bytes (envelopes, sealed
 * keys, encryption keys) are BLOBs; every uint64 coming from the chain (timestamps, nonces,
 * sequences, expiries) is stored as its decimal string so it round-trips exactly; block heights
 * are INTEGER because the indexer controls them.
 */
import { DatabaseSync, type SQLInputValue, type StatementSync, type StatementResultingChanges } from "node:sqlite";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

export const SCHEMA_VERSION = 1;

/** Every projection table (truncated on replay), in a fixed order. */
export const PROJECTION_TABLES = [
  "identities",
  "devices",
  "relationships",
  "blocks_list",
  "follows",
  "audiences",
  "posts",
  "post_versions",
  "reactions",
  "key_packages",
  "cross_posts",
  "communities",
  "roles",
  "labels",
  "sponsors",
  "user_grants",
  "registry_entries",
  "notifications",
] as const;

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE checkpoints (
    height INTEGER PRIMARY KEY,
    block_id TEXT NOT NULL,
    previous_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    state_hash TEXT NOT NULL,
    event_count INTEGER NOT NULL
  );

  CREATE TABLE event_log (
    height INTEGER NOT NULL,
    tx_index INTEGER NOT NULL,
    sequence INTEGER NOT NULL,
    block_id TEXT NOT NULL,
    block_timestamp TEXT NOT NULL,
    tx_id TEXT NOT NULL,
    contract TEXT NOT NULL,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    data_json TEXT NOT NULL,
    impacted_json TEXT NOT NULL,
    PRIMARY KEY (height, tx_index, sequence)
  );

  CREATE TABLE identities (
    account TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    encryption_key BLOB NOT NULL,
    key_version INTEGER NOT NULL,
    profile_hash TEXT NOT NULL,
    profile_uri TEXT NOT NULL,
    protocol_version INTEGER NOT NULL,
    device_epoch INTEGER NOT NULL,
    registered_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    recovery_policy_json TEXT,
    pending_policy_json TEXT,
    pending_recovery_json TEXT
  );

  CREATE TABLE devices (
    account TEXT NOT NULL,
    device TEXT NOT NULL,
    capabilities INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    device_epoch INTEGER NOT NULL,
    revoked INTEGER NOT NULL,
    label TEXT NOT NULL,
    authorized_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account, device)
  );

  CREATE TABLE relationships (
    a TEXT NOT NULL,
    b TEXT NOT NULL,
    status INTEGER NOT NULL,
    requester TEXT NOT NULL,
    nonce TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    since TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (a, b)
  );
  CREATE INDEX relationships_b ON relationships (b);

  CREATE TABLE blocks_list (
    actor TEXT NOT NULL,
    target TEXT NOT NULL,
    since TEXT NOT NULL,
    PRIMARY KEY (actor, target)
  );
  CREATE INDEX blocks_list_target ON blocks_list (target);

  CREATE TABLE follows (
    follower TEXT NOT NULL,
    target TEXT NOT NULL,
    since TEXT NOT NULL,
    PRIMARY KEY (follower, target)
  );
  CREATE INDEX follows_target ON follows (target);

  CREATE TABLE audiences (
    account TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    since TEXT NOT NULL,
    reason TEXT NOT NULL,
    height INTEGER NOT NULL,
    PRIMARY KEY (account, epoch)
  );

  CREATE TABLE posts (
    post_id TEXT PRIMARY KEY,
    author TEXT NOT NULL,
    sequence TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    previous_version TEXT NOT NULL,
    audience INTEGER NOT NULL,
    audience_id TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    envelope BLOB NOT NULL,
    media_json TEXT NOT NULL,
    reply_to TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    protocol_version INTEGER NOT NULL,
    state INTEGER NOT NULL,
    state_reason TEXT NOT NULL,
    replacement_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    tx_id TEXT NOT NULL,
    block_height INTEGER NOT NULL,
    tx_index INTEGER NOT NULL,
    event_sequence INTEGER NOT NULL
  );
  CREATE INDEX posts_order ON posts (block_height, tx_index, event_sequence);
  CREATE INDEX posts_author ON posts (author, block_height, tx_index, event_sequence);
  CREATE INDEX posts_reply_to ON posts (reply_to);
  CREATE INDEX posts_idempotency ON posts (author, idempotency_key);

  CREATE TABLE post_versions (
    post_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    previous_version TEXT NOT NULL,
    envelope BLOB NOT NULL,
    media_json TEXT NOT NULL,
    tx_id TEXT NOT NULL,
    block_height INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    PRIMARY KEY (post_id, version_number)
  );

  CREATE TABLE reactions (
    post_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    reaction INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    block_height INTEGER NOT NULL,
    tx_id TEXT NOT NULL,
    PRIMARY KEY (post_id, actor, reaction)
  );

  CREATE TABLE key_packages (
    height INTEGER NOT NULL,
    tx_index INTEGER NOT NULL,
    sequence INTEGER NOT NULL,
    key_index INTEGER NOT NULL,
    author TEXT NOT NULL,
    audience_id TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    recipient TEXT NOT NULL,
    recipient_key_version INTEGER NOT NULL,
    sealed_key BLOB NOT NULL,
    tx_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    PRIMARY KEY (height, tx_index, sequence, key_index)
  );
  CREATE INDEX key_packages_recipient ON key_packages (recipient, author, audience_id, epoch);
  CREATE INDEX key_packages_author ON key_packages (author, audience_id, epoch);

  CREATE TABLE cross_posts (
    author TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    adapter TEXT NOT NULL,
    state INTEGER NOT NULL,
    external_ref TEXT NOT NULL,
    post_id TEXT NOT NULL,
    manifest_hash TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    block_height INTEGER NOT NULL,
    tx_id TEXT NOT NULL,
    PRIMARY KEY (author, idempotency_key, adapter)
  );

  CREATE TABLE communities (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    policy_uri TEXT NOT NULL,
    transfer_delay_ms TEXT NOT NULL,
    pending_owner TEXT NOT NULL,
    transfer_effective_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE roles (
    community_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    role INTEGER NOT NULL,
    scope TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    granted_by TEXT NOT NULL,
    granted_at TEXT NOT NULL,
    PRIMARY KEY (community_id, subject)
  );
  CREATE INDEX roles_subject ON roles (subject);

  CREATE TABLE labels (
    height INTEGER NOT NULL,
    tx_index INTEGER NOT NULL,
    sequence INTEGER NOT NULL,
    community_id TEXT NOT NULL,
    post_id TEXT NOT NULL,
    label TEXT NOT NULL,
    reason TEXT NOT NULL,
    actor TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    tx_id TEXT NOT NULL,
    PRIMARY KEY (height, tx_index, sequence)
  );
  CREATE INDEX labels_post ON labels (post_id);
  CREATE INDEX labels_community ON labels (community_id);

  CREATE TABLE sponsors (
    sponsor TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    policy_version INTEGER NOT NULL,
    active INTEGER NOT NULL,
    registered_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE user_grants (
    sponsor TEXT NOT NULL,
    user TEXT NOT NULL,
    daily_ops INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    revoked INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (sponsor, user)
  );

  CREATE TABLE registry_entries (
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    version INTEGER NOT NULL,
    abi_hash TEXT NOT NULL,
    status INTEGER NOT NULL,
    effective_at TEXT NOT NULL,
    notes TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (name, address, version)
  );

  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    account TEXT NOT NULL,
    kind TEXT NOT NULL,
    actor TEXT NOT NULL,
    post_id TEXT,
    community_id TEXT,
    data_json TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    block_height INTEGER NOT NULL,
    tx_index INTEGER NOT NULL,
    sequence INTEGER NOT NULL
  );
  CREATE INDEX notifications_account ON notifications (account, id);
  `,
];

export interface CheckpointRow {
  height: number;
  block_id: string;
  previous_id: string;
  timestamp: string;
  state_hash: string;
  event_count: number;
}

export type Row = Record<string, unknown>;

export interface OpenOptions {
  /** Skip WAL/synchronous pragmas (in-memory databases ignore them anyway). */
  readOnly?: boolean;
}

export class IndexerDb {
  readonly path: string;
  readonly sqlite: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private depth = 0;

  constructor(dbPath: string = ":memory:", options: OpenOptions = {}) {
    this.path = dbPath;
    if (dbPath !== ":memory:") {
      const dir = path.dirname(dbPath);
      if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    this.sqlite = new DatabaseSync(dbPath, { readOnly: options.readOnly ?? false });
    if (dbPath !== ":memory:" && !options.readOnly) {
      this.sqlite.exec("PRAGMA journal_mode = WAL");
      this.sqlite.exec("PRAGMA synchronous = NORMAL");
    }
    this.sqlite.exec("PRAGMA foreign_keys = OFF");
    if (!options.readOnly) this.migrate();
  }

  /** Opens an in-memory database (tests). */
  static memory(): IndexerDb {
    return new IndexerDb(":memory:");
  }

  /** Deletes a database file (and its WAL/SHM side files). */
  static remove(dbPath: string): void {
    if (dbPath === ":memory:") return;
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const file = dbPath + suffix;
      if (existsSync(file)) rmSync(file, { force: true });
    }
  }

  get schemaVersion(): number {
    const hasMeta = this.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
      .get();
    if (!hasMeta) return 0;
    const row = this.sqlite.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value?: string } | undefined;
    return row?.value ? Number(row.value) : 0;
  }

  private migrate(): void {
    const current = this.schemaVersion;
    if (current > MIGRATIONS.length) {
      throw new Error(`database schema version ${current} is newer than this indexer supports (${MIGRATIONS.length})`);
    }
    for (let v = current; v < MIGRATIONS.length; v++) {
      const sql = MIGRATIONS[v]!;
      this.transaction(() => {
        this.sqlite.exec(sql);
        this.sqlite
          .prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
          .run(String(v + 1));
      });
    }
  }

  prepare(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.sqlite.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  run(sql: string, ...params: SQLInputValue[]): StatementResultingChanges {
    return this.prepare(sql).run(...params);
  }

  get<T extends Row = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.prepare(sql).get(...params) as T | undefined;
  }

  all<T extends Row = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.prepare(sql).all(...params) as T[];
  }

  /** Runs `fn` inside a transaction (nested calls join the outer transaction). */
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth++;
      try {
        return fn();
      } finally {
        this.depth--;
      }
    }
    this.sqlite.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    try {
      const result = fn();
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // already rolled back
      }
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  getMeta(key: string): string | undefined {
    const row = this.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", key);
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  }

  deleteMeta(key: string): void {
    this.run("DELETE FROM meta WHERE key = ?", key);
  }

  lastCheckpoint(): CheckpointRow | undefined {
    return this.get<CheckpointRow>("SELECT * FROM checkpoints ORDER BY height DESC LIMIT 1");
  }

  firstCheckpoint(): CheckpointRow | undefined {
    return this.get<CheckpointRow>("SELECT * FROM checkpoints ORDER BY height ASC LIMIT 1");
  }

  checkpointAt(height: number): CheckpointRow | undefined {
    return this.get<CheckpointRow>("SELECT * FROM checkpoints WHERE height = ?", height);
  }

  /** Removes every projection row (the log and checkpoints are untouched). */
  truncateProjections(): void {
    this.transaction(() => {
      for (const table of PROJECTION_TABLES) this.sqlite.exec(`DELETE FROM ${table}`);
      for (const key of this.all<{ key: string }>("SELECT key FROM meta WHERE key LIKE 'projection.%'")) this.deleteMeta(key.key);
    });
  }

  close(): void {
    this.statements.clear();
    if (this.sqlite.isOpen) this.sqlite.close();
  }
}
