import {
  Arrays,
  authority,
  Crypto,
  Protobuf,
  Storage,
  System,
  Token,
} from "@koinos/sdk-as";
import { publications } from "./proto/publications";
import { Actor, Capability } from "./common/actor";
import { Util } from "./common/util";

const CHUNK: u32 = 16384;
const MAX_BYTES: u32 = 10 * 1024 * 1024;
const COIN: u64 = 100000000;

export class MusicLibrary {
  config: Storage.Obj<publications.music_config> =
    new Storage.Obj<publications.music_config>(
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
  chunks: Storage.Map<Uint8Array, publications.get_music_chunk_result> =
    new Storage.Map<Uint8Array, publications.get_music_chunk_result>(
      System.getContractId(),
      42,
      publications.get_music_chunk_result.decode,
      publications.get_music_chunk_result.encode,
      null
    );
  directory: Storage.Map<Uint8Array, publications.get_music_chunk_result> =
    new Storage.Map<Uint8Array, publications.get_music_chunk_result>(
      System.getContractId(),
      43,
      publications.get_music_chunk_result.decode,
      publications.get_music_chunk_result.encode,
      null
    );

  id(value: Uint8Array | null): Uint8Array {
    System.require(
      value != null && value!.length == 32,
      "expected 32-byte music id"
    );
    return value!;
  }
  hash(data: Uint8Array): Uint8Array {
    return System.hash(Crypto.multicodec.sha2_256, data)!.slice(2);
  }
  settings(): publications.music_config {
    const c = this.config.get();
    // Explicit recipient configuration is required before accepting money.
    const value =
      c == null
        ? new publications.music_config(
            1,
            0,
            null,
            8610000000,
            MAX_BYTES,
            false
          )
        : c!;
    value.native_token = System.getContractAddress("koin");
    return value;
  }
  setConfig(args: publications.set_music_config_arguments): void {
    System.requireAuthority(
      authority.authorization_type.contract_call,
      System.getContractId()
    );
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
    System.require(
      old.revision < u32.MAX_VALUE,
      "configuration revision exhausted"
    );
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
    System.require(
      args.size > 0 && args.size <= MAX_BYTES,
      "music must fit 10 MiB"
    );
    System.require(
      args.chunk_hashes.length == (args.size + CHUNK - 1) / CHUNK,
      "incorrect chunk count"
    );
    for (let i = 0; i < args.chunk_hashes.length; i++)
      this.id(args.chunk_hashes[i]);
    System.require(
      args.title != null &&
        args.title!.trim().length > 0 &&
        Util.str(args.title!).length <= 240,
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
    const payer = Util.requireAddress(args.payer, "payer");
    const old = this.tracks.get(id);
    if (old != null) {
      System.require(
        Arrays.equal(old.owner!, owner) &&
          Arrays.equal(old.digest!, digest) &&
          old.size == args.size &&
          old.title == args.title &&
          old.mime == args.mime &&
          old.duration_ms == args.duration_ms &&
          Arrays.equal(old.payer!, payer),
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
    System.require(
      c.enabled && c.recipient != null,
      "music uploads are not enabled"
    );
    System.require(
      args.config_revision == c.revision,
      "music price changed; review the new quote"
    );
    System.require(
      args.size <= c.max_bytes,
      "audio exceeds configured size limit"
    );
    const price = this.fee(args.size, c.rate_per_mb);
    System.require(
      args.max_fee == price,
      "music fee does not match the accepted quote"
    );
    System.require(
      !Arrays.equal(payer, c.recipient!),
      "payer cannot be the music fee recipient"
    );
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
  append(
    args: publications.append_music_arguments,
    identity: Uint8Array
  ): void {
    const owner = Util.requireAddress(args.owner, "owner"),
      id = this.id(args.id);
    Actor.requireAuthorized(identity, owner, args.device, Capability.PUBLISH);
    const v = this.tracks.get(id);
    System.require(
      v != null && Arrays.equal(v!.owner!, owner) && v!.fee > 0,
      "paid music upload not owned"
    );
    System.require(
      args.index < <u32>v!.chunk_hashes.length && args.index <= v!.received,
      "unexpected music chunk index"
    );
    System.require(
      args.data != null &&
        args.data!.length == min<u32>(CHUNK, v!.size - args.index * CHUNK),
      "incorrect music chunk size"
    );
    System.require(
      Arrays.equal(this.hash(args.data!), v!.chunk_hashes[args.index]),
      "music chunk hash mismatch"
    );
    if (args.index < v!.received) return;
    this.chunks.put(
      Util.concat([id, Util.u32be(args.index)]),
      new publications.get_music_chunk_result(args.data)
    );
    v!.received++;
    this.tracks.put(id, v!);
    if (v!.received == <u32>v!.chunk_hashes.length) {
      this.directory.put(
        Util.concat([owner, id]),
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
  list(
    args: publications.list_music_arguments
  ): publications.list_music_result {
    const owner = Util.requireAddress(args.owner, "owner");
    let key = Util.isEmpty(args.after)
      ? owner
      : Util.concat([owner, this.id(args.after)]);
    const ids: Uint8Array[] = [];
    for (let i = 0; i < 20; i++) {
      const next = this.directory.getNext(key);
      if (next == null || !Arrays.equal(next.key!.slice(0, 25), owner)) break;
      ids.push(next.value.data!);
      key = next.key!;
    }
    return new publications.list_music_result(ids);
  }
}
