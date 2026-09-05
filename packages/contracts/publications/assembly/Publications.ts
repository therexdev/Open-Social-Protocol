// Open Social Protocol - publications contract (protocol v1).
//
// Signed, versioned publications (posts, replies), lifecycle facts,
// non-economic reactions, audience-key distribution and cross-post outcome
// records. See docs/protocol-spec.md sections 2.1-2.3 (identifiers), 3.2
// (actor resolution) and 6 (publication lifecycle), and ADR 0002/0003.
//
// State is compact (ADR 0002): one post_record per post id, one author_state
// per author (publication sequence), one post_ref per (author, idempotency
// key) and the dependency configuration. Envelopes, media references, key
// packages and cross-post outcomes are carried only by call arguments and the
// osp.publications.* events (the history path); they are never stored.
//
// Authority: every mutating method resolves its signer through the identity
// contract (identity.resolve_actor) and then requires that signer's
// contract_call authority on the current transaction (Actor.requireAuthorized).
// Replies require the COMMENT capability (for edits: the *stored* thread
// position decides, never the caller-supplied reply_to), reactions REACT,
// everything else PUBLISH. The dependency setters are callable only by the
// contract account.
import { System, Storage, Protobuf, authority, Arrays, Crypto } from "@koinos/sdk-as";
import { publications } from "./proto/publications";
import { relationships } from "./proto/relationships";
import { Actor, Capability, IS_BLOCKED_ENTRY_POINT } from "./common/actor";
import { Util } from "./common/util";

// Call arguments and database reads are returned through the SDK's system-call
// buffer (1 KiB by default); the chain fails a call whose payload does not fit
// (publish envelopes are up to 4 KiB and key packages up to 16 KiB). Enlarged at
// module initialization: imported modules run their top-level statements before
// the generated index.ts calls main().
const SYSTEM_BUFFER_SIZE: u32 = 32 * 1024;
System.setSystemBufferSize(SYSTEM_BUFFER_SIZE);

// State spaces (one per map / object).
const POSTS_SPACE: u32 = 1;
const AUTHORS_SPACE: u32 = 2;
const IDEMPOTENCY_SPACE: u32 = 3;
const CONFIG_SPACE: u32 = 4;

// Protocol constants and pilot limits (spec section 6; exposed by get_limits).
const PROTOCOL_VERSION: u32 = 1;
const MAX_ENVELOPE_BYTES: u32 = 4096;
const MAX_MEDIA_REFS: u32 = 8;
const MAX_KEY_PACKAGE_BYTES: u32 = 16384;
const MAX_IDEMPOTENCY_KEY_BYTES: u32 = 32;
const MAX_LOCATION_CHARS: u32 = 256;
const MAX_LOCATIONS_PER_MEDIA: i32 = 4;
const MAX_MIME_CHARS: i32 = 128;
const MAX_REASON_CHARS: i32 = 256;
const MAX_ADAPTER_CHARS: i32 = 64;
const MAX_EXTERNAL_REF_CHARS: i32 = 256;
const MAX_AUDIENCE_ID_BYTES: i32 = 32;
// media_ref.key_ref is opaque key material (a wrapped content key + nonce or a
// key reference, spec 5.1); bounded so a publish event cannot smuggle
// arbitrary bytes past max_envelope_bytes.
const MAX_KEY_REF_BYTES: i32 = 128;
const HASH_LENGTH: i32 = 32;
const FIRST_SEQUENCE: u64 = 1;

// Domain separator for post ids (spec section 2).
const POST_ID_DOMAIN: string = "osp/v1/post-id";

// Highest enum values accepted on the wire.
const MAX_AUDIENCE_KIND: i32 = <i32>publications.audience_kind.custom;
const MAX_LIFECYCLE_STATE: i32 = <i32>publications.lifecycle_state.superseded;
const MAX_OUTCOME_STATE: i32 = <i32>publications.outcome_state.reconcile_required;

export class Publications {
  contractId: Uint8Array;
  posts: Storage.Map<Uint8Array, publications.post_record>;
  authors: Storage.Map<Uint8Array, publications.author_state>;
  idempotency: Storage.Map<Uint8Array, publications.post_ref>;
  config: Storage.Obj<publications.get_dependencies_result>;

  constructor() {
    const contractId = System.getContractId();
    this.contractId = contractId;
    this.posts = new Storage.Map<Uint8Array, publications.post_record>(
      contractId,
      POSTS_SPACE,
      publications.post_record.decode,
      publications.post_record.encode,
      null
    );
    this.authors = new Storage.Map<Uint8Array, publications.author_state>(
      contractId,
      AUTHORS_SPACE,
      publications.author_state.decode,
      publications.author_state.encode,
      null
    );
    this.idempotency = new Storage.Map<Uint8Array, publications.post_ref>(
      contractId,
      IDEMPOTENCY_SPACE,
      publications.post_ref.decode,
      publications.post_ref.encode,
      null
    );
    this.config = new Storage.Obj<publications.get_dependencies_result>(
      contractId,
      CONFIG_SPACE,
      publications.get_dependencies_result.decode,
      publications.get_dependencies_result.encode,
      null
    );
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  /** Stored dependency configuration (empty addresses when unset). */
  dependencies(): publications.get_dependencies_result {
    const cfg = this.config.get();
    if (cfg == null) return new publications.get_dependencies_result(null, null);
    return cfg;
  }

  /** Configured identity contract address, or empty bytes when unset. */
  identityContract(): Uint8Array {
    const cfg = this.dependencies();
    if (Util.isEmpty(cfg.identity)) return new Uint8Array(0);
    return cfg.identity!;
  }

  /** Configured relationships contract address, or empty bytes when unset. */
  relationshipsContract(): Uint8Array {
    const cfg = this.dependencies();
    if (Util.isEmpty(cfg.relationships)) return new Uint8Array(0);
    return cfg.relationships!;
  }

  /**
   * Raw 32-byte SHA-256 digest of `data`. The hash system call answers with
   * a multihash (varint code 0x12, varint length 0x20, digest); the protocol
   * uses raw digests inside every structure (spec section 2), so the prefix
   * is stripped here.
   */
  sha256(data: Uint8Array): Uint8Array {
    const digest = System.hash(Crypto.multicodec.sha2_256, data)!;
    if (digest.length == HASH_LENGTH + 2 && digest[0] == 0x12 && digest[1] == 0x20) {
      return digest.slice(2);
    }
    System.require(digest.length == HASH_LENGTH, "unexpected digest length");
    return digest;
  }

  /**
   * post_id = sha256("osp/v1/post-id" || chain_id || u32be(protocol_version)
   *                  || author || u64be(sequence) || content_hash)   (spec 2.1)
   */
  computePostId(author: Uint8Array, sequence: u64, contentHash: Uint8Array): Uint8Array {
    return this.sha256(
      Util.concat([
        Util.str(POST_ID_DOMAIN),
        System.getChainId(),
        Util.u32be(PROTOCOL_VERSION),
        author,
        Util.u64be(sequence),
        contentHash,
      ])
    );
  }

  /** Require a bytes field to be exactly 32 bytes. */
  requireHash(v: Uint8Array | null, what: string): Uint8Array {
    System.require(!Util.isEmpty(v), what + " is required");
    System.require(v!.length == HASH_LENGTH, what + " must be 32 bytes");
    return v!;
  }

  /** Validate an optional hash (empty or 32 bytes); empty becomes null. */
  optionalHash(v: Uint8Array | null, what: string): Uint8Array | null {
    if (Util.isEmpty(v)) return null;
    System.require(v!.length == HASH_LENGTH, what + " must be empty or 32 bytes");
    return v;
  }

  /** Validate an optional bounded bytes field; empty becomes null. */
  optionalBytes(v: Uint8Array | null, max: i32, what: string): Uint8Array | null {
    if (Util.isEmpty(v)) return null;
    System.require(v!.length <= max, what + " too large");
    return v;
  }

  /** Author sequence state (never null; defaults to next_sequence 1). */
  loadAuthor(author: Uint8Array): publications.author_state {
    const state = this.authors.get(author);
    if (state == null) return new publications.author_state(FIRST_SEQUENCE, 0, 0);
    return state;
  }

  /** Key of the (author, idempotency key) map: author || key. */
  idempotencyKey(author: Uint8Array, key: Uint8Array): Uint8Array {
    return Util.concat([author, key]);
  }

  /** Validate media references (count, mime, content hash, locations, key_ref). */
  validateMedia(media: Array<publications.media_ref>): void {
    System.require(<u32>media.length <= MAX_MEDIA_REFS, "too many media refs");
    for (let i = 0; i < media.length; i++) {
      const ref = media[i];
      Util.requireString(ref.mime, MAX_MIME_CHARS, "media mime");
      this.optionalHash(ref.content_hash, "media content_hash");
      System.require(ref.locations.length <= MAX_LOCATIONS_PER_MEDIA, "too many media locations");
      for (let j = 0; j < ref.locations.length; j++) {
        System.require(<u32>ref.locations[j].length <= MAX_LOCATION_CHARS, "media location too long");
      }
      this.optionalBytes(ref.key_ref, MAX_KEY_REF_BYTES, "media key_ref");
    }
  }

  /**
   * True when `actor` currently blocks `target` according to the
   * relationships contract (relationships.is_blocked).
   */
  isBlocked(actor: Uint8Array, target: Uint8Array): bool {
    const relationshipsContract = this.relationshipsContract();
    System.require(relationshipsContract.length > 0, "relationships contract not configured");
    const args = new relationships.is_blocked_arguments(actor, target);
    const call = System.call(
      relationshipsContract,
      IS_BLOCKED_ENTRY_POINT,
      Protobuf.encode(args, relationships.is_blocked_arguments.encode)
    );
    System.require(call.code == 0, "block check failed");
    const payload = call.res.object;
    if (payload == null) return false;
    const res = Protobuf.decode<relationships.is_blocked_result>(
      payload,
      relationships.is_blocked_result.decode
    );
    return res.value;
  }

  /**
   * Reserve an idempotency key for the author (reverts on reuse) and bind it
   * to `postId`. No-op when the key is empty.
   */
  reserveIdempotencyKey(author: Uint8Array, key: Uint8Array | null, postId: Uint8Array): void {
    if (key == null) return;
    const mapKey = this.idempotencyKey(author, key);
    System.require(!this.idempotency.has(mapKey), "duplicate idempotency key");
    this.idempotency.put(mapKey, new publications.post_ref(postId));
  }

  // ---------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------

  set_identity_contract(
    args: publications.set_identity_contract_arguments
  ): publications.set_identity_contract_result {
    System.requireAuthority(authority.authorization_type.contract_call, this.contractId);
    const address = Util.requireAddress(args.address, "address");
    const cfg = this.dependencies();
    cfg.identity = address;
    this.config.put(cfg);
    return new publications.set_identity_contract_result();
  }

  set_relationships_contract(
    args: publications.set_relationships_contract_arguments
  ): publications.set_relationships_contract_result {
    System.requireAuthority(authority.authorization_type.contract_call, this.contractId);
    const address = Util.requireAddress(args.address, "address");
    const cfg = this.dependencies();
    cfg.relationships = address;
    this.config.put(cfg);
    return new publications.set_relationships_contract_result();
  }

  // ---------------------------------------------------------------------
  // publish
  // ---------------------------------------------------------------------

  publish(args: publications.publish_arguments): publications.publish_result {
    const author = Util.requireAddress(args.author, "author");
    const postId = this.requireHash(args.post_id, "post_id");
    const contentHash = this.requireHash(args.content_hash, "content_hash");

    // Envelope: bounded, and content-addressed when present.
    const envelope: Uint8Array | null = Util.isEmpty(args.envelope) ? null : args.envelope;
    if (envelope != null) {
      System.require(<u32>envelope.length <= MAX_ENVELOPE_BYTES, "envelope too large");
      System.require(Arrays.equal(this.sha256(envelope), contentHash), "content hash mismatch");
    }

    System.require(<i32>args.audience >= 0 && <i32>args.audience <= MAX_AUDIENCE_KIND, "unknown audience");
    const audienceId = this.optionalBytes(args.audience_id, MAX_AUDIENCE_ID_BYTES, "audience_id");
    if (args.audience == publications.audience_kind.custom) {
      System.require(audienceId != null, "custom audience requires audience_id");
    } else {
      // everyone / friends: the audience id is implicit and must be empty (spec 2.3).
      System.require(audienceId == null, "audience_id not allowed for this audience");
    }
    this.validateMedia(args.media);
    const idempotencyKey = this.optionalBytes(
      args.idempotency_key,
      <i32>MAX_IDEMPOTENCY_KEY_BYTES,
      "idempotency key"
    );
    // reply_to is shape-checked here so a malformed link, like every other
    // argument error, reverts before the identity lookup.
    const requestedReplyTo: Uint8Array | null = Util.isEmpty(args.reply_to)
      ? null
      : this.requireHash(args.reply_to, "reply_to");

    // Replies need the COMMENT capability, top-level posts PUBLISH (spec 3.1).
    // For an edit the *stored* thread position decides: a comment stays a
    // comment whether or not the caller repeats reply_to, so a device holding
    // only PUBLISH can never rewrite one (ADR 0003 bounded-damage model).
    const isFirstVersion = Util.isEmpty(args.previous_version);
    let existing: publications.post_record | null = null;
    let capability: u32 = Capability.PUBLISH;
    if (isFirstVersion) {
      if (requestedReplyTo != null) capability = Capability.COMMENT;
    } else {
      existing = this.posts.get(postId);
      System.require(existing != null, "post not found");
      if (!Util.isEmpty(existing!.reply_to)) capability = Capability.COMMENT;
    }
    Actor.requireAuthorized(this.identityContract(), author, args.device, capability);

    const now = Util.now();
    let record: publications.post_record;
    let previousVersion: Uint8Array | null = null;
    let replyTo: Uint8Array | null = null;
    let replyAuthor: Uint8Array | null = null;

    if (isFirstVersion) {
      System.require(!this.posts.has(postId), "post already exists");

      const state = this.loadAuthor(author);
      System.require(args.sequence == state.next_sequence, "sequence mismatch");
      System.require(
        Arrays.equal(this.computePostId(author, args.sequence, contentHash), postId),
        "post id mismatch"
      );

      if (requestedReplyTo != null) {
        const parentId = requestedReplyTo;
        const parent = this.posts.get(parentId);
        System.require(parent != null, "reply target not found");
        System.require(parent!.state != publications.lifecycle_state.deleted, "reply target deleted");
        const parentAuthor = parent!.author!;
        // A reply to your own post never needs a block check.
        if (!Arrays.equal(parentAuthor, author)) {
          System.require(!this.isBlocked(parentAuthor, author), "blocked by author");
        }
        replyTo = parentId;
        replyAuthor = parentAuthor;
      }

      this.reserveIdempotencyKey(author, idempotencyKey, postId);

      record = new publications.post_record(
        author,
        args.sequence,
        1,
        contentHash,
        publications.lifecycle_state.active,
        replyTo,
        args.audience,
        now,
        now
      );
      this.posts.put(postId, record);

      state.next_sequence = state.next_sequence + 1;
      state.post_count = state.post_count + 1;
      state.last_publish_at = now;
      this.authors.put(author, state);
    } else {
      record = existing!;
      System.require(Arrays.equal(record.author!, author), "author mismatch");
      System.require(record.state != publications.lifecycle_state.deleted, "post deleted");
      const previous = args.previous_version!;
      System.require(Arrays.equal(previous, record.latest_version!), "stale version");
      previousVersion = previous;
      System.require(args.audience == record.audience, "audience change not allowed");

      // The thread position of a post is fixed by its first version.
      replyTo = Util.isEmpty(record.reply_to) ? null : record.reply_to;
      if (requestedReplyTo != null) {
        System.require(
          replyTo != null && Arrays.equal(requestedReplyTo, replyTo),
          "reply_to change not allowed"
        );
      }
      if (replyTo != null) {
        const parent = this.posts.get(replyTo);
        if (parent != null) replyAuthor = parent.author!;
      }

      this.reserveIdempotencyKey(author, idempotencyKey, postId);

      record.version_count = record.version_count + 1;
      record.latest_version = contentHash;
      record.updated_at = now;
      this.posts.put(postId, record);
    }

    const impacted: Uint8Array[] = [author];
    if (replyAuthor != null && !Arrays.equal(replyAuthor, author)) impacted.push(replyAuthor);

    const ev = new publications.published_event(
      author,
      postId,
      contentHash,
      previousVersion,
      record.version_count,
      record.sequence,
      args.audience,
      audienceId,
      args.epoch,
      envelope,
      args.media,
      replyTo,
      idempotencyKey,
      PROTOCOL_VERSION,
      now
    );
    System.event(
      "osp.publications.published",
      Protobuf.encode(ev, publications.published_event.encode),
      impacted
    );
    return new publications.publish_result();
  }

  // ---------------------------------------------------------------------
  // set_lifecycle
  // ---------------------------------------------------------------------

  set_lifecycle(
    args: publications.set_lifecycle_arguments
  ): publications.set_lifecycle_result {
    const author = Util.requireAddress(args.author, "author");
    const postId = this.requireHash(args.post_id, "post_id");
    const version = this.requireHash(args.version, "version");
    System.require(<i32>args.state >= 0 && <i32>args.state <= MAX_LIFECYCLE_STATE, "unknown lifecycle state");
    const reason = Util.requireString(args.reason, MAX_REASON_CHARS, "reason");

    let replacementId: Uint8Array | null = null;
    if (
      args.state == publications.lifecycle_state.migrated ||
      args.state == publications.lifecycle_state.superseded
    ) {
      const replacement = this.requireHash(args.replacement_id, "replacement_id");
      System.require(!Arrays.equal(replacement, postId), "replacement_id must differ from post_id");
      replacementId = replacement;
    } else {
      System.require(Util.isEmpty(args.replacement_id), "replacement_id not allowed for this state");
    }

    Actor.requireAuthorized(this.identityContract(), author, args.device, Capability.PUBLISH);

    const record = this.posts.get(postId);
    System.require(record != null, "post not found");
    System.require(Arrays.equal(record!.author!, author), "author mismatch");
    System.require(Arrays.equal(record!.latest_version!, version), "version mismatch");
    // deleted is terminal (spec section 6).
    System.require(record!.state != publications.lifecycle_state.deleted, "post deleted");

    const now = Util.now();
    record!.state = args.state;
    record!.updated_at = now;
    this.posts.put(postId, record!);

    const ev = new publications.lifecycle_event(author, postId, version, args.state, reason, replacementId, now);
    System.event(
      "osp.publications.lifecycle",
      Protobuf.encode(ev, publications.lifecycle_event.encode),
      [author]
    );
    return new publications.set_lifecycle_result();
  }

  // ---------------------------------------------------------------------
  // react (event only)
  // ---------------------------------------------------------------------

  react(args: publications.react_arguments): publications.react_result {
    const actor = Util.requireAddress(args.actor, "actor");
    const postId = this.requireHash(args.post_id, "post_id");
    System.require(args.reaction != 0, "reaction is required");

    Actor.requireAuthorized(this.identityContract(), actor, args.device, Capability.REACT);

    const record = this.posts.get(postId);
    System.require(record != null, "post not found");
    System.require(record!.state != publications.lifecycle_state.deleted, "post deleted");
    const postAuthor = record!.author!;

    const now = Util.now();
    const impacted: Uint8Array[] = [actor];
    if (!Arrays.equal(postAuthor, actor)) impacted.push(postAuthor);

    const ev = new publications.reaction_event(actor, postId, postAuthor, args.reaction, args.remove, now);
    System.event(
      "osp.publications.reaction",
      Protobuf.encode(ev, publications.reaction_event.encode),
      impacted
    );
    return new publications.react_result();
  }

  // ---------------------------------------------------------------------
  // distribute_keys (event only)
  // ---------------------------------------------------------------------

  distribute_keys(
    args: publications.distribute_keys_arguments
  ): publications.distribute_keys_result {
    const author = Util.requireAddress(args.author, "author");
    const packages = Util.requireBytes(args.packages, <i32>MAX_KEY_PACKAGE_BYTES, "packages");
    const audienceId = this.optionalBytes(args.audience_id, MAX_AUDIENCE_ID_BYTES, "audience_id");

    Actor.requireAuthorized(this.identityContract(), author, args.device, Capability.PUBLISH);

    const now = Util.now();
    const ev = new publications.keys_distributed_event(author, audienceId, args.epoch, packages, now);
    System.event(
      "osp.publications.keys_distributed",
      Protobuf.encode(ev, publications.keys_distributed_event.encode),
      [author]
    );
    return new publications.distribute_keys_result();
  }

  // ---------------------------------------------------------------------
  // record_cross_post (event only)
  // ---------------------------------------------------------------------

  record_cross_post(
    args: publications.record_cross_post_arguments
  ): publications.record_cross_post_result {
    const author = Util.requireAddress(args.author, "author");
    const idempotencyKey = Util.requireBytes(
      args.idempotency_key,
      <i32>MAX_IDEMPOTENCY_KEY_BYTES,
      "idempotency_key"
    );
    System.require(args.adapter != null && args.adapter!.length > 0, "adapter is required");
    const adapter = Util.requireString(args.adapter, MAX_ADAPTER_CHARS, "adapter");
    const externalRef = Util.requireString(args.external_ref, MAX_EXTERNAL_REF_CHARS, "external_ref");
    const manifestHash = this.optionalHash(args.manifest_hash, "manifest_hash");
    System.require(<i32>args.state >= 0 && <i32>args.state <= MAX_OUTCOME_STATE, "unknown outcome state");

    let postId: Uint8Array | null = null;
    if (!Util.isEmpty(args.post_id)) {
      postId = this.requireHash(args.post_id, "post_id");
    }
    if (args.state == publications.outcome_state.succeeded) {
      System.require(postId != null, "post_id is required for a succeeded outcome");
    }

    Actor.requireAuthorized(this.identityContract(), author, args.device, Capability.PUBLISH);

    // The post this author's key was bound to by publish, if any.
    const bound = this.idempotency.get(this.idempotencyKey(author, idempotencyKey));
    const boundPostId: Uint8Array | null = bound != null && !Util.isEmpty(bound.post_id) ? bound.post_id : null;

    if (postId != null) {
      const record = this.posts.get(postId);
      System.require(record != null, "post not found");
      System.require(Arrays.equal(record!.author!, author), "author mismatch");
      // A key already bound to a publication cannot be reported for another post.
      if (boundPostId != null) {
        System.require(Arrays.equal(boundPostId, postId), "idempotency key bound to another post");
      }
    }
    // A succeeded outcome must be traceable back to the attempt: the key must
    // belong to the author and refer to an existing post (spec 6). Together
    // with the checks above this means the key is bound to exactly post_id.
    if (args.state == publications.outcome_state.succeeded) {
      System.require(boundPostId != null, "idempotency key not bound to a post");
    }

    const now = Util.now();
    const ev = new publications.cross_post_outcome_event(
      author,
      idempotencyKey,
      adapter,
      args.state,
      externalRef,
      postId,
      manifestHash,
      now
    );
    System.event(
      "osp.publications.cross_post_outcome",
      Protobuf.encode(ev, publications.cross_post_outcome_event.encode),
      [author]
    );
    return new publications.record_cross_post_result();
  }

  // ---------------------------------------------------------------------
  // Reads (never call other contracts)
  // ---------------------------------------------------------------------

  get_post(args: publications.get_post_arguments): publications.get_post_result {
    const res = new publications.get_post_result();
    if (Util.isEmpty(args.post_id)) return res;
    res.value = this.posts.get(args.post_id!);
    return res;
  }

  get_author_state(
    args: publications.get_author_state_arguments
  ): publications.get_author_state_result {
    const res = new publications.get_author_state_result();
    if (Util.isEmpty(args.author)) {
      res.value = new publications.author_state(FIRST_SEQUENCE, 0, 0);
      return res;
    }
    res.value = this.loadAuthor(args.author!);
    return res;
  }

  get_post_by_idempotency_key(
    args: publications.get_post_by_idempotency_key_arguments
  ): publications.get_post_by_idempotency_key_result {
    const res = new publications.get_post_by_idempotency_key_result();
    if (Util.isEmpty(args.author) || Util.isEmpty(args.idempotency_key)) return res;
    res.value = this.idempotency.get(this.idempotencyKey(args.author!, args.idempotency_key!));
    return res;
  }

  get_limits(args: publications.get_limits_arguments): publications.get_limits_result {
    const res = new publications.get_limits_result();
    res.value = new publications.limits(
      MAX_ENVELOPE_BYTES,
      MAX_MEDIA_REFS,
      MAX_KEY_PACKAGE_BYTES,
      MAX_IDEMPOTENCY_KEY_BYTES,
      MAX_LOCATION_CHARS,
      PROTOCOL_VERSION
    );
    return res;
  }

  get_dependencies(
    args: publications.get_dependencies_arguments
  ): publications.get_dependencies_result {
    return this.dependencies();
  }
}
