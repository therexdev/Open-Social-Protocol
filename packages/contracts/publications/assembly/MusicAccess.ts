import { Arrays, Crypto, Protobuf, Storage, System } from "@koinos/sdk-as";
import { publications } from "./proto/publications";
import { relationships } from "./proto/relationships";
import { identity } from "./proto/identity";
import { token } from "./proto/token";
import {
  Actor,
  Capability,
  GET_IDENTITY_ENTRY_POINT,
  IS_BLOCKED_ENTRY_POINT,
} from "./common/actor";
import { Util } from "./common/util";
import { MusicLibrary } from "./MusicLibrary";
import { PhotoLibrary } from "./PhotoLibrary";

const DAY: u64 = 86400000;
export class MusicAccess {
  library: MusicLibrary = new MusicLibrary();
  access: Storage.Map<Uint8Array, publications.music_access> = new Storage.Map<
    Uint8Array,
    publications.music_access
  >(
    System.getContractId(),
    45,
    publications.music_access.decode,
    publications.music_access.encode,
    null
  );
  pending: Storage.Map<Uint8Array, publications.music_access> = new Storage.Map<
    Uint8Array,
    publications.music_access
  >(
    System.getContractId(),
    46,
    publications.music_access.decode,
    publications.music_access.encode,
    null
  );
  comments: Storage.Map<Uint8Array, publications.music_comment> = new Storage.Map<
    Uint8Array,
    publications.music_comment
  >(
    System.getContractId(),
    47,
    publications.music_comment.decode,
    publications.music_comment.encode,
    null
  );
  commentOrder: Storage.Map<Uint8Array, publications.get_music_chunk_result> = new Storage.Map<
    Uint8Array,
    publications.get_music_chunk_result
  >(
    System.getContractId(),
    48,
    publications.get_music_chunk_result.decode,
    publications.get_music_chunk_result.encode,
    null
  );

  track(id: Uint8Array): publications.music_record {
    const v = this.library.get(id);
    System.require(
      v != null && v!.received == <u32>v!.chunk_hashes.length,
      "track is not complete"
    );
    return v!;
  }
  eligible(v: publications.music_record, buyer: Uint8Array, rel: Uint8Array): bool {
    if (Arrays.equal(v.owner!, buyer)) return true;
    System.require(rel.length > 0, "relationships not configured");
    for (let i = 0; i < 2; i++) {
      const call = System.call(
        rel,
        IS_BLOCKED_ENTRY_POINT,
        Protobuf.encode(
          new relationships.is_blocked_arguments(
            i == 0 ? v.owner! : buyer,
            i == 0 ? buyer : v.owner!
          ),
          relationships.is_blocked_arguments.encode
        )
      );
      System.require(call.code == 0 && call.res.object != null, "could not check blocks");
      if (
        Protobuf.decode<relationships.is_blocked_result>(
          call.res.object!,
          relationships.is_blocked_result.decode
        ).value
      )
        return false;
    }
    if (v.audience == 0) return true;
    if (v.audience == 1) {
      const call = System.call(
        rel,
        0x803706cb,
        Protobuf.encode(
          new relationships.get_relationship_arguments(v.owner, buyer),
          relationships.get_relationship_arguments.encode
        )
      );
      System.require(call.code == 0 && call.res.object != null, "could not check friendship");
      const result = Protobuf.decode<relationships.get_relationship_result>(
        call.res.object!,
        relationships.get_relationship_result.decode
      );
      return (
        result.value != null && result.value!.status == relationships.relationship_status.active
      );
    }
    const photos = new PhotoLibrary(),
      group = photos.collections.get(v.group_id!);
    return group != null && !group!.closed && group!.kind == 2 && photos.member(group!, buyer);
  }
  recipient(account: Uint8Array, identityContract: Uint8Array): identity.identity_record {
    const call = System.call(
      identityContract,
      GET_IDENTITY_ENTRY_POINT,
      Protobuf.encode(
        new identity.get_identity_arguments(account),
        identity.get_identity_arguments.encode
      )
    );
    System.require(call.code == 0 && call.res.object != null, "recipient key unavailable");
    const result = Protobuf.decode<identity.get_identity_result>(
      call.res.object!,
      identity.get_identity_result.decode
    );
    System.require(
      result.value != null &&
        result.value!.encryption_key != null &&
        result.value!.encryption_key!.length == 32 &&
        result.value!.key_version > 0,
      "recipient needs a registered encryption key"
    );
    return result.value!;
  }
  usage(account: Uint8Array, usage: Uint8Array): void {
    const call = System.call(
      usage,
      0x96f39e35,
      Protobuf.encode(new token.consume_arguments(account, 1), token.consume_arguments.encode)
    );
    System.require(call.code == 0, "usage allowance exhausted");
  }
  event(owner: Uint8Array, value: publications.music_access): void {
    System.event(
      "osp.publications.music_access",
      Protobuf.encode(
        new publications.music_access_event(owner, value),
        publications.music_access_event.encode
      ),
      [owner, value.buyer!]
    );
  }
  request(
    args: publications.request_music_access_arguments,
    ident: Uint8Array,
    rel: Uint8Array,
    usage: Uint8Array
  ): void {
    const buyer = Util.requireAddress(args.buyer, "buyer"),
      id = this.library.id(args.id),
      v = this.track(id);
    Actor.requireAuthorized(ident, buyer, null, 0);
    System.require(v.encrypted && !Arrays.equal(v.owner!, buyer), "no unlock required");
    System.require(this.eligible(v, buyer, rel), "track is not shared with this account");
    System.require(args.max_price == v.unlock_price, "OSAT price changed");
    const key = Util.concat([id, buyer]),
      old = this.access.get(key);
    if (old != null && (old!.status == 1 || old!.status == 2)) return;
    const recipient = this.recipient(buyer, ident),
      now = Util.now();
    const paymentId = this.library.hash(
      Util.concat([id, buyer, Util.u64be(now), old == null ? new Uint8Array(0) : old!.payment_id!])
    );
    if (v.unlock_price > 0) {
      const call = System.call(
        usage,
        0x6ebfdf84,
        Protobuf.encode(
          new token.reserve_music_payment_arguments(paymentId, buyer, v.owner, v.unlock_price),
          token.reserve_music_payment_arguments.encode
        )
      );
      System.require(call.code == 0, "OSAT payment could not be reserved");
    }
    this.usage(buyer, usage);
    const value = new publications.music_access(
      id,
      buyer,
      v.unlock_price,
      now + DAY,
      1,
      null,
      recipient.encryption_key,
      recipient.key_version,
      paymentId
    );
    this.access.put(key, value);
    this.pending.put(Util.concat([v.owner!, key]), value);
    this.event(v.owner!, value);
  }
  grant(
    args: publications.grant_music_access_arguments,
    ident: Uint8Array,
    rel: Uint8Array,
    usage: Uint8Array
  ): void {
    const owner = Util.requireAddress(args.owner, "owner"),
      buyer = Util.requireAddress(args.buyer, "buyer"),
      id = this.library.id(args.id),
      v = this.track(id);
    Actor.requireAuthorized(ident, owner, null, 0);
    System.require(
      Arrays.equal(owner, v.owner!) && v.encrypted && !Arrays.equal(owner, buyer),
      "encrypted track not owned"
    );
    System.require(this.eligible(v, buyer, rel), "recipient is no longer in the audience");
    this.library.validateKey(args.key);
    const key = Util.concat([id, buyer]);
    let value = this.access.get(key);
    if (value != null && value!.status == 2) return; // idempotent delivery; never pay twice
    if (value == null || value!.status == 3) {
      System.require(v.unlock_price == 0, "paid unlock request required");
      const recipient = this.recipient(buyer, ident);
      value = new publications.music_access(
        id,
        buyer,
        0,
        0,
        0,
        null,
        recipient.encryption_key,
        recipient.key_version
      );
    } else System.require(Util.now() < value!.expires_at, "delivery expired; buyer can refund");
    System.require(args.key!.key_version == value!.key_version, "recipient key version changed");
    if (value!.amount > 0) {
      const call = System.call(
        usage,
        0xe4587c1b,
        Protobuf.encode(
          new token.settle_music_payment_arguments(value!.payment_id, false),
          token.settle_music_payment_arguments.encode
        )
      );
      System.require(call.code == 0, "OSAT payment settlement failed");
    }
    this.usage(owner, usage);
    value!.status = 2;
    value!.key = args.key;
    this.access.put(key, value!);
    this.pending.remove(Util.concat([owner, key]));
    this.event(owner, value!);
  }
  refund(
    args: publications.refund_music_access_arguments,
    ident: Uint8Array,
    rel: Uint8Array,
    usage: Uint8Array
  ): void {
    const buyer = Util.requireAddress(args.buyer, "buyer"),
      id = this.library.id(args.id),
      v = this.track(id);
    Actor.requireAuthorized(ident, buyer, null, 0);
    const key = Util.concat([id, buyer]),
      value = this.access.get(key);
    System.require(value != null, "unlock request not found");
    if (value!.status == 3) return;
    System.require(
      value!.status == 1 && (Util.now() >= value!.expires_at || !this.eligible(v, buyer, rel)),
      "refund is not available yet"
    );
    if (value!.amount > 0) {
      const call = System.call(
        usage,
        0xe4587c1b,
        Protobuf.encode(
          new token.settle_music_payment_arguments(value!.payment_id, true),
          token.settle_music_payment_arguments.encode
        )
      );
      System.require(call.code == 0, "OSAT refund failed");
    }
    // Refunds must work even if the buyer has exhausted usage credits.
    value!.status = 3;
    this.access.put(key, value!);
    this.pending.remove(Util.concat([v.owner!, key]));
    this.event(v.owner!, value!);
  }
  read(
    args: publications.get_music_access_arguments,
    rel: Uint8Array
  ): publications.get_music_access_result {
    const id = this.library.id(args.id),
      buyer = Util.requireAddress(args.buyer, "buyer"),
      v = this.track(id);
    return new publications.get_music_access_result(
      this.access.get(Util.concat([id, buyer])),
      this.eligible(v, buyer, rel),
      Util.now()
    );
  }
  requests(
    args: publications.list_music_requests_arguments
  ): publications.list_music_requests_result {
    const owner = Util.requireAddress(args.owner, "owner");
    System.require(Util.isEmpty(args.after) || args.after!.length == 57, "invalid request cursor");
    let cursor = Util.isEmpty(args.after) ? owner : Util.concat([owner, args.after!]);
    const items: publications.music_access[] = [];
    for (let i = 0; i < 20; i++) {
      const next = this.pending.getNext(cursor);
      if (next == null || !Arrays.equal(next.key!.slice(0, 25), owner)) break;
      items.push(next.value);
      cursor = next.key!;
    }
    return new publications.list_music_requests_result(
      items,
      items.length == 20 ? cursor.slice(25) : null
    );
  }
  comment(
    args: publications.comment_music_arguments,
    ident: Uint8Array,
    rel: Uint8Array,
    usage: Uint8Array
  ): void {
    const author = Util.requireAddress(args.author, "author"),
      id = this.library.id(args.id),
      commentId = this.library.id(args.comment_id),
      v = this.track(id);
    Actor.requireAuthorized(ident, author, null, Capability.COMMENT);
    System.require(this.eligible(v, author, rel), "track is not shared with this account");
    if (v.encrypted && !Arrays.equal(v.owner!, author)) {
      const license = this.access.get(Util.concat([id, author]));
      System.require(license != null && license!.status == 2, "unlock the track before commenting");
    }
    System.require(
      args.body != null && args.body!.length > 0 && args.body!.length <= 4000,
      "comment must fit 4000 bytes"
    );
    System.require(
      v.encrypted
        ? args.nonce != null && args.nonce!.length == 24 && args.body!.length > 16
        : Util.isEmpty(args.nonce),
      "invalid comment encryption"
    );
    const key = Util.concat([id, commentId]),
      old = this.comments.get(key);
    if (old != null) {
      System.require(
        !old!.deleted &&
          Arrays.equal(old!.author!, author) &&
          Arrays.equal(old!.body, args.body) &&
          Arrays.equal(old!.nonce, args.nonce) &&
          Arrays.equal(old!.reply_to, args.reply_to),
        "comment id already used"
      );
      return;
    }
    if (!Util.isEmpty(args.reply_to)) {
      const parent = this.comments.get(Util.concat([id, this.library.id(args.reply_to)]));
      System.require(parent != null && !parent!.deleted, "comment reply target unavailable");
    }
    this.usage(author, usage);
    const value = new publications.music_comment(
      commentId,
      author,
      args.body,
      args.nonce,
      args.reply_to,
      Util.now()
    );
    this.comments.put(key, value);
    this.commentOrder.put(
      Util.concat([id, Util.u64be(value.created_at), commentId]),
      new publications.get_music_chunk_result(commentId)
    );
    System.event(
      "osp.publications.music_comment",
      Protobuf.encode(
        new publications.music_comment_event(id, value),
        publications.music_comment_event.encode
      ),
      [v.owner!, author]
    );
  }
  deleteComment(args: publications.delete_music_comment_arguments, ident: Uint8Array): void {
    const author = Util.requireAddress(args.author, "author"),
      id = this.library.id(args.id),
      key = Util.concat([id, this.library.id(args.comment_id)]);
    Actor.requireAuthorized(ident, author, null, Capability.COMMENT);
    const value = this.comments.get(key);
    System.require(value != null && Arrays.equal(value!.author!, author), "comment not owned");
    if (value!.deleted) return;
    value!.deleted = true;
    value!.body = null;
    value!.nonce = null;
    this.comments.put(key, value!);
    System.event(
      "osp.publications.music_comment",
      Protobuf.encode(
        new publications.music_comment_event(id, value),
        publications.music_comment_event.encode
      ),
      [author]
    );
  }
  listComments(
    args: publications.list_music_comments_arguments
  ): publications.list_music_comments_result {
    const id = this.library.id(args.id);
    System.require(Util.isEmpty(args.after) || args.after!.length == 40, "invalid comment cursor");
    let cursor = Util.isEmpty(args.after) ? id : Util.concat([id, args.after!]);
    const items: publications.music_comment[] = [];
    for (let i = 0; i < 20; i++) {
      const next = this.commentOrder.getNext(cursor);
      if (next == null || !Arrays.equal(next.key!.slice(0, 32), id)) break;
      const value = this.comments.get(Util.concat([id, next.value.data!]));
      if (value != null) items.push(value!);
      cursor = next.key!;
    }
    return new publications.list_music_comments_result(
      items,
      items.length == 20 ? cursor.slice(32) : null
    );
  }
}
