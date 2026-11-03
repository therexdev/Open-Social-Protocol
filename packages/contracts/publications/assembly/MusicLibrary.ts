import { Arrays, authority, Crypto, Protobuf, Storage, System, Token } from "@koinos/sdk-as";
import { publications } from "./proto/publications";
import { Actor, Capability } from "./common/actor";
import { Util } from "./common/util";
import { PhotoLibrary } from "./PhotoLibrary";

const CHUNK: u32 = 16384;
const MAX_BYTES: u32 = 10 * 1024 * 1024;
const COIN: u64 = 100000000;

export class MusicLibrary {
  config: Storage.Obj<publications.music_config> = new Storage.Obj<publications.music_config>(
    System.getContractId(),
    40,
    publications.music_config.decode,
    publications.music_config.encode,
    null
  );
  tracks: Storage.Map<Uint8Array, publications.music_record> = new Storage.Map<
    Uint8Array,
    publications.music_record
  >(
    System.getContractId(),
    41,
    publications.music_record.decode,
    publications.music_record.encode,
    null
  );
  chunks: Storage.Map<Uint8Array, publications.get_music_chunk_result> = new Storage.Map<
    Uint8Array,
    publications.get_music_chunk_result
  >(
    System.getContractId(),
    42,
    publications.get_music_chunk_result.decode,
    publications.get_music_chunk_result.encode,
    null
  );
  directory: Storage.Map<Uint8Array, publications.get_music_chunk_result> = new Storage.Map<
    Uint8Array,
    publications.get_music_chunk_result
  >(
    System.getContractId(),
    43,
    publications.get_music_chunk_result.decode,
    publications.get_music_chunk_result.encode,
    null
  );

  groupDirectory: Storage.Map<Uint8Array, publications.get_music_chunk_result> = new Storage.Map<
    Uint8Array,
    publications.get_music_chunk_result
  >(
    System.getContractId(),
    49,
    publications.get_music_chunk_result.decode,
    publications.get_music_chunk_result.encode,
    null
  );
  progress: Storage.Map<Uint8Array, publications.music_progress> = new Storage.Map<
    Uint8Array,
    publications.music_progress
  >(
    System.getContractId(),
    44,
    publications.music_progress.decode,
    publications.music_progress.encode,
    null
  );
  get(id: Uint8Array): publications.music_record | null {
    const value = this.tracks.get(id),
      progress = this.progress.get(id);
    if (value != null && progress != null) value.received = progress.received;
    return value;
  }
  validateKey(key: publications.music_key | null): void {
    System.require(
      key != null &&
        key!.key_version > 0 &&
        key!.ephemeral_public_key != null &&
        key!.ephemeral_public_key!.length == 32 &&
        key!.nonce != null &&
        key!.nonce!.length == 24 &&
        key!.ciphertext != null &&
        key!.ciphertext!.length == 48,
      "invalid sealed music key"
    );
  }
  id(value: Uint8Array | null): Uint8Array {
    System.require(value != null && value!.length == 32, "expected 32-byte music id");
    return value!;
  }
  hash(data: Uint8Array): Uint8Array {
    return System.hash(Crypto.multicodec.sha2_256, data)!.slice(2);
  }
  settings(): publications.music_config {
    const c = this.config.get();
    // Explicit recipient configuration is required before accepting money.
    const value =
      c == null ? new publications.music_config(1, 0, null, 8610000000, MAX_BYTES, false) : c!;
    value.version = 3;
    value.native_token = System.getContractAddress("koin");
    return value;
  }
  setConfig(args: publications.set_music_config_arguments): void {
    System.requireAuthority(authority.authorization_type.contract_call, System.getContractId());
    Util.requireAddress(args.recipient, "music fee recipient");
    System.require(
      args.rate_per_mb > 0 && args.rate_per_mb <= 1000000000000,
      "rate must be 0-10000 KOIN per MB"
    );
    System.require(
      args.max_bytes > 0 && args.max_bytes <= MAX_BYTES,
      "music size limit must be at most 10 MiB"
    );
    const old = this.settings();
    System.require(old.revision < u32.MAX_VALUE, "configuration revision exhausted");
    this.config.put(
      new publications.music_config(
        1,
        old.revision + 1,
        args.recipient,
        args.rate_per_mb,
        args.max_bytes,
        args.enabled
      )
    );
  }
  fee(size: u32, rate: u64): u64 {
    // Decimal MB, rounded UP to a whole KOIN. The bounded inputs prevent overflow.
    const divisor: u64 = 1000000 * COIN;
    return ((<u64>size * rate + divisor - 1) / divisor) * COIN;
  }
  begin(args: publications.begin_music_arguments, identity: Uint8Array): void {
    const owner = Util.requireAddress(args.owner, "owner"),
      id = this.id(args.id),
      digest = this.id(args.digest);
    Actor.requireAuthorized(identity, owner, args.device, Capability.PUBLISH);
    System.require(args.size > 0 && args.size <= MAX_BYTES, "music must fit 10 MiB");
    System.require(
      args.chunk_hashes.length == (args.size + CHUNK - 1) / CHUNK,
      "incorrect chunk count"
    );
    for (let i = 0; i < args.chunk_hashes.length; i++) this.id(args.chunk_hashes[i]);
    System.require(
      args.title != null && args.title!.trim().length > 0 && Util.str(args.title!).length <= 240,
      "title must contain 1-240 UTF-8 bytes"
    );
    System.require(
      args.mime == "audio/mpeg" ||
        args.mime == "audio/ogg" ||
        args.mime == "audio/mp4" ||
        args.mime == "audio/wav" ||
        args.mime == "audio/webm",
      "unsupported audio type"
    );
    System.require(
      args.duration_ms > 0 && args.duration_ms <= 3600000,
      "audio duration must be at most one hour"
    );
    System.require(
      Util.str(args.artist == null ? "" : args.artist!).length <= 240,
      "artist must fit 240 UTF-8 bytes"
    );
    System.require(
      Util.str(args.description == null ? "" : args.description!).length <= 2000,
      "description must fit 2000 UTF-8 bytes"
    );
    System.require(
      args.audience <= 2 && args.unlock_price <= 1000000,
      "invalid audience or OSAT price"
    );
    System.require(
      args.encrypted == (args.audience != 0 || args.unlock_price > 0),
      "restricted and paid music must be encrypted"
    );
    if (args.encrypted) {
      this.validateKey(args.owner_key);
      System.require(
        args.nonce != null && args.nonce!.length == 24 && args.size > 16,
        "invalid encrypted audio"
      );
      this.id(args.key_hash);
    } else
      System.require(
        Util.isEmpty(args.nonce) && args.owner_key == null && Util.isEmpty(args.key_hash),
        "public audio must not carry private keys"
      );
    if (args.audience == 2) {
      const library = new PhotoLibrary(),
        group = library.collections.get(this.id(args.group_id));
      System.require(
        group != null && !group!.closed && group!.kind == 2 && library.member(group!, owner),
        "active group membership required"
      );
    } else System.require(Util.isEmpty(args.group_id), "group id only allowed for group music");
    const payer = Util.requireAddress(args.payer, "payer");
    const old = this.get(id);
    if (old != null) {
      System.require(
        Arrays.equal(old.owner!, owner) &&
          Arrays.equal(old.digest!, digest) &&
          old.size == args.size &&
          old.title == args.title &&
          old.mime == args.mime &&
          old.duration_ms == args.duration_ms &&
          Arrays.equal(old.payer!, payer) &&
          (old.artist == null ? "" : old.artist!) == (args.artist == null ? "" : args.artist!) &&
          (old.description == null ? "" : old.description!) ==
            (args.description == null ? "" : args.description!) &&
          old.audience == args.audience &&
          old.encrypted == args.encrypted &&
          old.unlock_price == args.unlock_price &&
          Arrays.equal(old.group_id, args.group_id) &&
          Arrays.equal(old.nonce, args.nonce) &&
          Arrays.equal(old.key_hash, args.key_hash) &&
          old.chunk_hashes.length == args.chunk_hashes.length,
        "music id already used"
      );
      for (let i = 0; i < args.chunk_hashes.length; i++)
        System.require(
          Arrays.equal(old.chunk_hashes[i], args.chunk_hashes[i]),
          "music commitment changed"
        );
      return; // No second transfer, even after pricing changes or pausing new uploads.
    }
    const c = this.settings();
    System.require(c.enabled && c.recipient != null, "music uploads are not enabled");
    System.require(args.config_revision == c.revision, "music price changed; review the new quote");
    System.require(args.size <= c.max_bytes, "audio exceeds configured size limit");
    const price = this.fee(args.size, c.rate_per_mb);
    System.require(args.max_fee == price, "music fee does not match the accepted quote");
    System.require(!Arrays.equal(payer, c.recipient!), "payer cannot be the music fee recipient");
    System.requireAuthority(authority.authorization_type.contract_call, payer);
    const native = new Token(System.getContractAddress("koin"));
    // Payment and reservation are one atomic transaction. Never trust a supplied
    // transaction id, arbitrary token address, UI quote, or external receipt.
    System.require(
      native.transfer(payer, c.recipient!, price),
      "native KOIN payment failed (balance or locked Mana)"
    );
    const value = new publications.music_record(
      owner,
      digest,
      args.size,
      args.chunk_hashes,
      0,
      args.title,
      args.mime,
      args.duration_ms,
      price,
      c.recipient,
      payer
    );
    value.artist = args.artist;
    value.description = args.description;
    value.audience = args.audience;
    value.group_id = args.group_id;
    value.encrypted = args.encrypted;
    value.nonce = args.nonce;
    value.owner_key = args.owner_key;
    value.unlock_price = args.unlock_price;
    value.version = 2;
    value.key_hash = args.key_hash;
    this.tracks.put(id, value);
    System.event(
      "osp.publications.music_paid",
      Protobuf.encode(
        new publications.music_paid_event(id, value),
        publications.music_paid_event.encode
      ),
      [owner, payer, c.recipient!]
    );
  }
  append(args: publications.append_music_arguments, identity: Uint8Array): void {
    System.require(args.data != null, "missing audio chunk");
    this.appendBatch(
      new publications.append_music_batch_arguments(
        args.owner,
        args.id,
        args.index,
        [args.data!],
        args.device
      ),
      identity
    );
  }
  appendBatch(args: publications.append_music_batch_arguments, identity: Uint8Array): void {
    const owner = Util.requireAddress(args.owner, "owner"),
      id = this.id(args.id);
    System.require(
      args.chunks.length > 0 && args.chunks.length <= 16,
      "one to sixteen audio chunks required"
    );
    Actor.requireAuthorized(identity, owner, args.device, Capability.PUBLISH);
    const v = this.get(id);
    System.require(
      v != null && Arrays.equal(v!.owner!, owner) && v!.fee > 0,
      "paid music upload not owned"
    );
    System.require(
      args.index <= v!.received &&
        args.index < <u32>v!.chunk_hashes.length &&
        args.chunks.length <= v!.chunk_hashes.length - args.index,
      "unexpected music chunk index"
    );
    const before = v!.received;
    for (let i = 0; i < args.chunks.length; i++) {
      const index = args.index + <u32>i,
        data = args.chunks[i];
      System.require(
        data.length == min<u32>(CHUNK, v!.size - index * CHUNK),
        "incorrect music chunk size"
      );
      System.require(
        Arrays.equal(this.hash(data), v!.chunk_hashes[index]),
        "music chunk hash mismatch"
      );
      if (index < v!.received) continue;
      this.chunks.put(
        Util.concat([id, Util.u32be(index)]),
        new publications.get_music_chunk_result(data)
      );
      v!.received++;
    }
    if (v!.received == before) return;
    // Never rewrite the immutable manifest. Legacy tracks migrate lazily here.
    this.progress.put(id, new publications.music_progress(v!.received));
    if (v!.received == <u32>v!.chunk_hashes.length) {
      this.directory.put(Util.concat([owner, id]), new publications.get_music_chunk_result(id));
      if (v!.audience == 2)
        this.groupDirectory.put(
          Util.concat([v!.group_id!, id]),
          new publications.get_music_chunk_result(id)
        );
      System.event(
        "osp.publications.music_completed",
        Protobuf.encode(
          new publications.music_completed_event(id, owner),
          publications.music_completed_event.encode
        ),
        [owner]
      );
    }
  }
  readChunks(args: publications.get_music_chunks_arguments): publications.get_music_chunks_result {
    const id = this.id(args.id);
    System.require(args.count > 0 && args.count <= 16, "read one to sixteen audio chunks");
    const result = new publications.get_music_chunks_result();
    const progress = this.progress.get(id);
    let received: u32 = 0;
    if (progress != null) received = progress.received;
    else {
      // V1 kept its counter in the manifest. V2+ reads only the compact counter.
      const track = this.tracks.get(id);
      if (track == null) return result;
      received = track.received;
    }
    System.require(args.index < received, "audio chunk not available");
    const count = min<u32>(args.count, received - args.index);
    for (let offset: u32 = 0; offset < count; offset++) {
      const chunk = this.chunks.get(Util.concat([id, Util.u32be(args.index + offset)]));
      System.require(chunk != null && chunk.data != null, "audio chunk not available");
      result.chunks.push(chunk!.data!);
    }
    return result;
  }
  list(args: publications.list_music_arguments): publications.list_music_result {
    const grouped = !Util.isEmpty(args.group_id);
    System.require(!grouped || Util.isEmpty(args.owner), "choose owner or group, not both");
    const owner = grouped ? this.id(args.group_id) : Util.requireAddress(args.owner, "owner"),
      directory = grouped ? this.groupDirectory : this.directory;
    let key = Util.isEmpty(args.after) ? owner : Util.concat([owner, this.id(args.after)]);
    const ids: Uint8Array[] = [];
    for (let i = 0; i < 20; i++) {
      const next = directory.getNext(key);
      if (next == null || !Arrays.equal(next.key!.slice(0, owner.length), owner)) break;
      ids.push(next.value.data!);
      key = next.key!;
    }
    return new publications.list_music_result(ids);
  }
}
