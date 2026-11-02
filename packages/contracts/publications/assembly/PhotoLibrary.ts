import { System, Storage, Protobuf, Arrays, Crypto } from "@koinos/sdk-as";
import { publications } from "./proto/publications";
import { token } from "./proto/token";
import { Actor, Capability } from "./common/actor";
import { Util } from "./common/util";

// Keep archive bytes in history, not unbounded contract state. Indexers can be
// replaced and rebuilt from events; clients verify the state commitments.
export class PhotoLibrary {
  photos: Storage.Map<Uint8Array, publications.photo_archive_record> =
    new Storage.Map<Uint8Array, publications.photo_archive_record>(
      System.getContractId(),
      30,
      publications.photo_archive_record.decode,
      publications.photo_archive_record.encode,
      null
    );
  collections: Storage.Map<Uint8Array, publications.collection_record> =
    new Storage.Map<Uint8Array, publications.collection_record>(
      System.getContractId(),
      31,
      publications.collection_record.decode,
      publications.collection_record.encode,
      null
    );
  items: Storage.Map<Uint8Array, publications.album_item_record> =
    new Storage.Map<Uint8Array, publications.album_item_record>(
      System.getContractId(),
      32,
      publications.album_item_record.decode,
      publications.album_item_record.encode,
      null
    );

  hash(data: Uint8Array): Uint8Array {
    const digest = System.hash(Crypto.multicodec.sha2_256, data)!;
    return digest.length == 34 ? digest.slice(2) : digest;
  }
  id(value: Uint8Array | null): Uint8Array {
    System.require(
      value != null && value!.length == 32,
      "expected 32-byte library id"
    );
    return value!;
  }
  charge(account: Uint8Array, units: u64, usage: Uint8Array | null): void {
    // Unlike legacy publications, archive writes cannot silently bypass usage.
    System.require(
      !Util.isEmpty(usage),
      "photo library requires configured usage contract"
    );
    const result = System.call(
      usage!,
      0x96f39e35,
      Protobuf.encode(
        new token.consume_arguments(account, units),
        token.consume_arguments.encode
      )
    );
    System.require(result.code == 0, "usage allowance exhausted");
  }
  units(size: u32): u32 {
    System.require(
      size > 0 && size <= 327680,
      "photo must fit 320 KiB including encryption"
    );
    if (size <= 32768) return 1;
    if (size <= 65536) return 2;
    if (size <= 131072) return 4;
    if (size <= 229376) return 7;
    return 10;
  }
  begin(
    args: publications.begin_photo_arguments,
    identity: Uint8Array,
    usage: Uint8Array | null
  ): void {
    const owner = Util.requireAddress(args.owner, "owner"),
      id = this.id(args.id),
      digest = this.id(args.digest);
    Actor.requireAuthorized(identity, owner, args.device, Capability.PUBLISH);
    const units = this.units(args.size),
      count = (args.size + 16383) / 16384;
    System.require(args.chunk_hashes.length == count, "incorrect chunk count");
    for (let i = 0; i < args.chunk_hashes.length; i++)
      this.id(args.chunk_hashes[i]);
    const old = this.photos.get(id);
    if (old != null) {
      System.require(
        Arrays.equal(old.owner!, owner) &&
          Arrays.equal(old.digest!, digest) &&
          old.size == args.size &&
          old.chunk_hashes.length == args.chunk_hashes.length,
        "archive id already used"
      );
      for (let i = 0; i < args.chunk_hashes.length; i++)
        System.require(
          Arrays.equal(old.chunk_hashes[i], args.chunk_hashes[i]),
          "archive commitment changed"
        );
      return; // retrying the same commitment never charges again
    }
    this.charge(owner, units, usage);
    const value = new publications.photo_archive_record(
      owner,
      digest,
      args.size,
      args.chunk_hashes,
      0,
      units
    );
    this.photos.put(id, value);
    System.event(
      "osp.publications.photo_started",
      Protobuf.encode(
        new publications.photo_started_event(id, value),
        publications.photo_started_event.encode
      ),
      [owner]
    );
  }
  append(
    args: publications.append_photo_arguments,
    identity: Uint8Array
  ): void {
    const owner = Util.requireAddress(args.owner, "owner"),
      id = this.id(args.id);
    Actor.requireAuthorized(identity, owner, args.device, Capability.PUBLISH);
    const value = this.photos.get(id);
    System.require(
      value != null && Arrays.equal(value!.owner!, owner),
      "archive not owned"
    );
    System.require(
      args.index < <u32>value!.chunk_hashes.length &&
        args.index <= value!.received,
      "unexpected chunk index"
    );
    const expected = min<u32>(16384, value!.size - args.index * 16384);
    System.require(
      args.data != null && args.data!.length == expected,
      "incorrect chunk size"
    );
    System.require(
      Arrays.equal(this.hash(args.data!), value!.chunk_hashes[args.index]),
      "chunk hash mismatch"
    );
    if (args.index < value!.received) return;
    value!.received++;
    this.photos.put(id, value!);
    System.event(
      "osp.publications.photo_chunk",
      Protobuf.encode(
        new publications.photo_chunk_event(id, args.index, args.data),
        publications.photo_chunk_event.encode
      ),
      [owner]
    );
  }
  member(value: publications.collection_record, account: Uint8Array): bool {
    if (Arrays.equal(value.owner!, account)) return true;
    for (let i = 0; i < value.members.length; i++)
      if (Arrays.equal(value.members[i], account)) return true;
    return false;
  }
  save(
    args: publications.save_collection_arguments,
    identity: Uint8Array,
    usage: Uint8Array | null
  ): void {
    const owner = Util.requireAddress(args.owner, "owner"),
      id = this.id(args.id);
    Actor.requireAuthorized(identity, owner, args.device, Capability.PUBLISH);
    System.require(args.kind == 1 || args.kind == 2, "unknown collection kind");
    System.require(
      args.audience == publications.audience_kind.everyone ||
        args.audience == publications.audience_kind.custom,
      "albums use public or selected people"
    );
    System.require(
      args.kind != 2 || args.audience == publications.audience_kind.custom,
      "groups must be private"
    );
    System.require(args.members.length <= 50, "at most 50 selected accounts");
    System.require(
      args.audience != publications.audience_kind.everyone ||
        args.members.length == 0,
      "public album has no private member list"
    );
    for (let i = 0; i < args.members.length; i++) {
      Util.requireAddress(args.members[i], "member");
      System.require(
        !Arrays.equal(owner, args.members[i]),
        "owner is already included"
      );
      for (let j = 0; j < i; j++)
        System.require(
          !Arrays.equal(args.members[i], args.members[j]),
          "duplicate member"
        );
    }
    System.require(
      args.envelope != null &&
        args.envelope!.length > 0 &&
        args.envelope!.length <= 4096,
      "invalid collection metadata"
    );
    const old = this.collections.get(id);
    if (old == null)
      System.require(args.previous_revision == 0, "collection missing");
    else {
      System.require(Arrays.equal(old.owner!, owner), "collection not owned");
      System.require(
        args.previous_revision == old.revision && old.revision < u32.MAX_VALUE,
        "stale collection revision"
      );
      System.require(
        args.kind == old.kind && args.audience == old.audience,
        "collection type and visibility are immutable"
      );
    }
    this.charge(owner, 1, usage);
    const value = new publications.collection_record(
      owner,
      args.kind,
      args.previous_revision + 1,
      args.audience,
      args.members,
      args.envelope,
      args.closed
    );
    this.collections.put(id, value);
    System.event(
      "osp.publications.collection_changed",
      Protobuf.encode(
        new publications.collection_changed_event(id, value),
        publications.collection_changed_event.encode
      ),
      [owner]
    );
  }
  setItem(
    args: publications.set_album_item_arguments,
    identity: Uint8Array,
    usage: Uint8Array | null
  ): void {
    const owner = Util.requireAddress(args.owner, "owner"),
      collectionId = this.id(args.collection_id),
      id = this.id(args.id);
    Actor.requireAuthorized(identity, owner, args.device, Capability.PUBLISH);
    const collection = this.collections.get(collectionId);
    System.require(
      collection != null &&
        !collection!.closed &&
        collection!.kind == 1 &&
        Arrays.equal(collection!.owner!, owner),
      "active owned album required"
    );
    System.require(
      args.epoch == collection!.revision,
      "album membership changed; review again"
    );
    const key = Util.concat([collectionId, id]),
      old = this.items.get(key);
    System.require(
      args.previous_revision == (old == null ? 0 : old!.revision) &&
        args.previous_revision < u32.MAX_VALUE,
      "stale album entry"
    );
    System.require(
      args.removed ||
        (args.envelope != null &&
          args.envelope!.length > 0 &&
          args.envelope!.length <= 4096),
      "invalid album photo"
    );
    this.charge(owner, 1, usage);
    const value = new publications.album_item_record(
      args.removed ? null : args.envelope,
      args.epoch,
      args.previous_revision + 1,
      args.removed
    );
    this.items.put(key, value);
    System.event(
      "osp.publications.album_item_changed",
      Protobuf.encode(
        new publications.album_item_changed_event(collectionId, id, value),
        publications.album_item_changed_event.encode
      ),
      [owner]
    );
  }
}
