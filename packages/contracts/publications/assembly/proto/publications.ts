import { Writer, Reader } from "as-proto";

export namespace publications {
  export class media_ref {
    static encode(message: media_ref, writer: Writer): void {
      const unique_name_content_hash = message.content_hash;
      if (unique_name_content_hash !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_content_hash);
      }

      const unique_name_mime = message.mime;
      if (unique_name_mime !== null) {
        writer.uint32(18);
        writer.string(unique_name_mime);
      }

      if (message.size != 0) {
        writer.uint32(24);
        writer.uint64(message.size);
      }

      const unique_name_locations = message.locations;
      if (unique_name_locations.length !== 0) {
        for (let i = 0; i < unique_name_locations.length; ++i) {
          writer.uint32(34);
          writer.string(unique_name_locations[i]);
        }
      }

      const unique_name_key_ref = message.key_ref;
      if (unique_name_key_ref !== null) {
        writer.uint32(42);
        writer.bytes(unique_name_key_ref);
      }
    }

    static decode(reader: Reader, length: i32): media_ref {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new media_ref();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.content_hash = reader.bytes();
            break;

          case 2:
            message.mime = reader.string();
            break;

          case 3:
            message.size = reader.uint64();
            break;

          case 4:
            message.locations.push(reader.string());
            break;

          case 5:
            message.key_ref = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    content_hash: Uint8Array | null;
    mime: string | null;
    size: u64;
    locations: Array<string>;
    key_ref: Uint8Array | null;

    constructor(
      content_hash: Uint8Array | null = null,
      mime: string | null = null,
      size: u64 = 0,
      locations: Array<string> = [],
      key_ref: Uint8Array | null = null
    ) {
      this.content_hash = content_hash;
      this.mime = mime;
      this.size = size;
      this.locations = locations;
      this.key_ref = key_ref;
    }
  }

  export class post_record {
    static encode(message: post_record, writer: Writer): void {
      const unique_name_author = message.author;
      if (unique_name_author !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_author);
      }

      if (message.sequence != 0) {
        writer.uint32(16);
        writer.uint64(message.sequence);
      }

      if (message.version_count != 0) {
        writer.uint32(24);
        writer.uint32(message.version_count);
      }

      const unique_name_latest_version = message.latest_version;
      if (unique_name_latest_version !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_latest_version);
      }

      if (message.state != 0) {
        writer.uint32(40);
        writer.int32(message.state);
      }

      const unique_name_reply_to = message.reply_to;
      if (unique_name_reply_to !== null) {
        writer.uint32(50);
        writer.bytes(unique_name_reply_to);
      }

      if (message.audience != 0) {
        writer.uint32(56);
        writer.int32(message.audience);
      }

      if (message.created_at != 0) {
        writer.uint32(64);
        writer.uint64(message.created_at);
      }

      if (message.updated_at != 0) {
        writer.uint32(72);
        writer.uint64(message.updated_at);
      }
    }

    static decode(reader: Reader, length: i32): post_record {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new post_record();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.author = reader.bytes();
            break;

          case 2:
            message.sequence = reader.uint64();
            break;

          case 3:
            message.version_count = reader.uint32();
            break;

          case 4:
            message.latest_version = reader.bytes();
            break;

          case 5:
            message.state = reader.int32();
            break;

          case 6:
            message.reply_to = reader.bytes();
            break;

          case 7:
            message.audience = reader.int32();
            break;

          case 8:
            message.created_at = reader.uint64();
            break;

          case 9:
            message.updated_at = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    author: Uint8Array | null;
    sequence: u64;
    version_count: u32;
    latest_version: Uint8Array | null;
    state: lifecycle_state;
    reply_to: Uint8Array | null;
    audience: audience_kind;
    created_at: u64;
    updated_at: u64;

    constructor(
      author: Uint8Array | null = null,
      sequence: u64 = 0,
      version_count: u32 = 0,
      latest_version: Uint8Array | null = null,
      state: lifecycle_state = 0,
      reply_to: Uint8Array | null = null,
      audience: audience_kind = 0,
      created_at: u64 = 0,
      updated_at: u64 = 0
    ) {
      this.author = author;
      this.sequence = sequence;
      this.version_count = version_count;
      this.latest_version = latest_version;
      this.state = state;
      this.reply_to = reply_to;
      this.audience = audience;
      this.created_at = created_at;
      this.updated_at = updated_at;
    }
  }

  @unmanaged
  export class author_state {
    static encode(message: author_state, writer: Writer): void {
      if (message.next_sequence != 0) {
        writer.uint32(8);
        writer.uint64(message.next_sequence);
      }

      if (message.last_publish_at != 0) {
        writer.uint32(16);
        writer.uint64(message.last_publish_at);
      }

      if (message.post_count != 0) {
        writer.uint32(24);
        writer.uint64(message.post_count);
      }
    }

    static decode(reader: Reader, length: i32): author_state {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new author_state();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.next_sequence = reader.uint64();
            break;

          case 2:
            message.last_publish_at = reader.uint64();
            break;

          case 3:
            message.post_count = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    next_sequence: u64;
    last_publish_at: u64;
    post_count: u64;

    constructor(
      next_sequence: u64 = 0,
      last_publish_at: u64 = 0,
      post_count: u64 = 0
    ) {
      this.next_sequence = next_sequence;
      this.last_publish_at = last_publish_at;
      this.post_count = post_count;
    }
  }

  @unmanaged
  export class limits {
    static encode(message: limits, writer: Writer): void {
      if (message.max_envelope_bytes != 0) {
        writer.uint32(8);
        writer.uint32(message.max_envelope_bytes);
      }

      if (message.max_media_refs != 0) {
        writer.uint32(16);
        writer.uint32(message.max_media_refs);
      }

      if (message.max_key_package_bytes != 0) {
        writer.uint32(24);
        writer.uint32(message.max_key_package_bytes);
      }

      if (message.max_idempotency_key_bytes != 0) {
        writer.uint32(32);
        writer.uint32(message.max_idempotency_key_bytes);
      }

      if (message.max_location_chars != 0) {
        writer.uint32(40);
        writer.uint32(message.max_location_chars);
      }

      if (message.protocol_version != 0) {
        writer.uint32(48);
        writer.uint32(message.protocol_version);
      }
    }

    static decode(reader: Reader, length: i32): limits {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new limits();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.max_envelope_bytes = reader.uint32();
            break;

          case 2:
            message.max_media_refs = reader.uint32();
            break;

          case 3:
            message.max_key_package_bytes = reader.uint32();
            break;

          case 4:
            message.max_idempotency_key_bytes = reader.uint32();
            break;

          case 5:
            message.max_location_chars = reader.uint32();
            break;

          case 6:
            message.protocol_version = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    max_envelope_bytes: u32;
    max_media_refs: u32;
    max_key_package_bytes: u32;
    max_idempotency_key_bytes: u32;
    max_location_chars: u32;
    protocol_version: u32;

    constructor(
      max_envelope_bytes: u32 = 0,
      max_media_refs: u32 = 0,
      max_key_package_bytes: u32 = 0,
      max_idempotency_key_bytes: u32 = 0,
      max_location_chars: u32 = 0,
      protocol_version: u32 = 0
    ) {
      this.max_envelope_bytes = max_envelope_bytes;
      this.max_media_refs = max_media_refs;
      this.max_key_package_bytes = max_key_package_bytes;
      this.max_idempotency_key_bytes = max_idempotency_key_bytes;
      this.max_location_chars = max_location_chars;
      this.protocol_version = protocol_version;
    }
  }

  export class post_ref {
    static encode(message: post_ref, writer: Writer): void {
      const unique_name_post_id = message.post_id;
      if (unique_name_post_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_post_id);
      }
    }

    static decode(reader: Reader, length: i32): post_ref {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new post_ref();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.post_id = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    post_id: Uint8Array | null;

    constructor(post_id: Uint8Array | null = null) {
      this.post_id = post_id;
    }
  }

  export class set_identity_contract_arguments {
    static encode(
      message: set_identity_contract_arguments,
      writer: Writer
    ): void {
      const unique_name_address = message.address;
      if (unique_name_address !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_address);
      }
    }

    static decode(
      reader: Reader,
      length: i32
    ): set_identity_contract_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_identity_contract_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.address = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    address: Uint8Array | null;

    constructor(address: Uint8Array | null = null) {
      this.address = address;
    }
  }

  @unmanaged
  export class set_identity_contract_result {
    static encode(
      message: set_identity_contract_result,
      writer: Writer
    ): void {}

    static decode(reader: Reader, length: i32): set_identity_contract_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_identity_contract_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    constructor() {}
  }

  export class set_relationships_contract_arguments {
    static encode(
      message: set_relationships_contract_arguments,
      writer: Writer
    ): void {
      const unique_name_address = message.address;
      if (unique_name_address !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_address);
      }
    }

    static decode(
      reader: Reader,
      length: i32
    ): set_relationships_contract_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_relationships_contract_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.address = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    address: Uint8Array | null;

    constructor(address: Uint8Array | null = null) {
      this.address = address;
    }
  }

  @unmanaged
  export class set_relationships_contract_result {
    static encode(
      message: set_relationships_contract_result,
      writer: Writer
    ): void {}

    static decode(
      reader: Reader,
      length: i32
    ): set_relationships_contract_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_relationships_contract_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    constructor() {}
  }

  export class publish_arguments {
    static encode(message: publish_arguments, writer: Writer): void {
      const unique_name_author = message.author;
      if (unique_name_author !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_author);
      }

      const unique_name_post_id = message.post_id;
      if (unique_name_post_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_post_id);
      }

      const unique_name_previous_version = message.previous_version;
      if (unique_name_previous_version !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_previous_version);
      }

      if (message.sequence != 0) {
        writer.uint32(32);
        writer.uint64(message.sequence);
      }

      if (message.audience != 0) {
        writer.uint32(40);
        writer.int32(message.audience);
      }

      const unique_name_audience_id = message.audience_id;
      if (unique_name_audience_id !== null) {
        writer.uint32(50);
        writer.bytes(unique_name_audience_id);
      }

      if (message.epoch != 0) {
        writer.uint32(56);
        writer.uint32(message.epoch);
      }

      const unique_name_envelope = message.envelope;
      if (unique_name_envelope !== null) {
        writer.uint32(66);
        writer.bytes(unique_name_envelope);
      }

      const unique_name_content_hash = message.content_hash;
      if (unique_name_content_hash !== null) {
        writer.uint32(74);
        writer.bytes(unique_name_content_hash);
      }

      const unique_name_media = message.media;
      for (let i = 0; i < unique_name_media.length; ++i) {
        writer.uint32(82);
        writer.fork();
        media_ref.encode(unique_name_media[i], writer);
        writer.ldelim();
      }

      const unique_name_reply_to = message.reply_to;
      if (unique_name_reply_to !== null) {
        writer.uint32(90);
        writer.bytes(unique_name_reply_to);
      }

      const unique_name_idempotency_key = message.idempotency_key;
      if (unique_name_idempotency_key !== null) {
        writer.uint32(98);
        writer.bytes(unique_name_idempotency_key);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(106);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): publish_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new publish_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.author = reader.bytes();
            break;

          case 2:
            message.post_id = reader.bytes();
            break;

          case 3:
            message.previous_version = reader.bytes();
            break;

          case 4:
            message.sequence = reader.uint64();
            break;

          case 5:
            message.audience = reader.int32();
            break;

          case 6:
            message.audience_id = reader.bytes();
            break;

          case 7:
            message.epoch = reader.uint32();
            break;

          case 8:
            message.envelope = reader.bytes();
            break;

          case 9:
            message.content_hash = reader.bytes();
            break;

          case 10:
            message.media.push(media_ref.decode(reader, reader.uint32()));
            break;

          case 11:
            message.reply_to = reader.bytes();
            break;

          case 12:
            message.idempotency_key = reader.bytes();
            break;

          case 13:
            message.device = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    author: Uint8Array | null;
    post_id: Uint8Array | null;
    previous_version: Uint8Array | null;
    sequence: u64;
    audience: audience_kind;
    audience_id: Uint8Array | null;
    epoch: u32;
    envelope: Uint8Array | null;
    content_hash: Uint8Array | null;
    media: Array<media_ref>;
    reply_to: Uint8Array | null;
    idempotency_key: Uint8Array | null;
    device: Uint8Array | null;

    constructor(
      author: Uint8Array | null = null,
      post_id: Uint8Array | null = null,
      previous_version: Uint8Array | null = null,
      sequence: u64 = 0,
      audience: audience_kind = 0,
      audience_id: Uint8Array | null = null,
      epoch: u32 = 0,
      envelope: Uint8Array | null = null,
      content_hash: Uint8Array | null = null,
      media: Array<media_ref> = [],
      reply_to: Uint8Array | null = null,
      idempotency_key: Uint8Array | null = null,
      device: Uint8Array | null = null
    ) {
      this.author = author;
      this.post_id = post_id;
      this.previous_version = previous_version;
      this.sequence = sequence;
      this.audience = audience;
      this.audience_id = audience_id;
      this.epoch = epoch;
      this.envelope = envelope;
      this.content_hash = content_hash;
      this.media = media;
      this.reply_to = reply_to;
      this.idempotency_key = idempotency_key;
      this.device = device;
    }
  }

  @unmanaged
  export class publish_result {
    static encode(message: publish_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): publish_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new publish_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    constructor() {}
  }

  export class set_lifecycle_arguments {
    static encode(message: set_lifecycle_arguments, writer: Writer): void {
      const unique_name_author = message.author;
      if (unique_name_author !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_author);
      }

      const unique_name_post_id = message.post_id;
      if (unique_name_post_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_post_id);
      }

      const unique_name_version = message.version;
      if (unique_name_version !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_version);
      }

      if (message.state != 0) {
        writer.uint32(32);
        writer.int32(message.state);
      }

      const unique_name_reason = message.reason;
      if (unique_name_reason !== null) {
        writer.uint32(42);
        writer.string(unique_name_reason);
      }

      const unique_name_replacement_id = message.replacement_id;
      if (unique_name_replacement_id !== null) {
        writer.uint32(50);
        writer.bytes(unique_name_replacement_id);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(58);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): set_lifecycle_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_lifecycle_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.author = reader.bytes();
            break;

          case 2:
            message.post_id = reader.bytes();
            break;

          case 3:
            message.version = reader.bytes();
            break;

          case 4:
            message.state = reader.int32();
            break;

          case 5:
            message.reason = reader.string();
            break;

          case 6:
            message.replacement_id = reader.bytes();
            break;

          case 7:
            message.device = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    author: Uint8Array | null;
    post_id: Uint8Array | null;
    version: Uint8Array | null;
    state: lifecycle_state;
    reason: string | null;
    replacement_id: Uint8Array | null;
    device: Uint8Array | null;

    constructor(
      author: Uint8Array | null = null,
      post_id: Uint8Array | null = null,
      version: Uint8Array | null = null,
      state: lifecycle_state = 0,
      reason: string | null = null,
      replacement_id: Uint8Array | null = null,
      device: Uint8Array | null = null
    ) {
      this.author = author;
      this.post_id = post_id;
      this.version = version;
      this.state = state;
      this.reason = reason;
      this.replacement_id = replacement_id;
      this.device = device;
    }
  }

  @unmanaged
  export class set_lifecycle_result {
    static encode(message: set_lifecycle_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): set_lifecycle_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_lifecycle_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    constructor() {}
  }

  export class react_arguments {
    static encode(message: react_arguments, writer: Writer): void {
      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_post_id = message.post_id;
      if (unique_name_post_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_post_id);
      }

      if (message.reaction != 0) {
        writer.uint32(24);
        writer.uint32(message.reaction);
      }

      if (message.remove != false) {
        writer.uint32(32);
        writer.bool(message.remove);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(42);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): react_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new react_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
            message.post_id = reader.bytes();
            break;

          case 3:
            message.reaction = reader.uint32();
            break;

          case 4:
            message.remove = reader.bool();
            break;

          case 5:
            message.device = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    actor: Uint8Array | null;
    post_id: Uint8Array | null;
    reaction: u32;
    remove: bool;
    device: Uint8Array | null;

    constructor(
      actor: Uint8Array | null = null,
      post_id: Uint8Array | null = null,
      reaction: u32 = 0,
      remove: bool = false,
      device: Uint8Array | null = null
    ) {
      this.actor = actor;
      this.post_id = post_id;
      this.reaction = reaction;
      this.remove = remove;
      this.device = device;
    }
  }

  @unmanaged
  export class react_result {
    static encode(message: react_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): react_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new react_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    constructor() {}
  }

  export class distribute_keys_arguments {
    static encode(message: distribute_keys_arguments, writer: Writer): void {
      const unique_name_author = message.author;
      if (unique_name_author !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_author);
      }

      const unique_name_audience_id = message.audience_id;
      if (unique_name_audience_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_audience_id);
      }

      if (message.epoch != 0) {
        writer.uint32(24);
        writer.uint32(message.epoch);
      }

      const unique_name_packages = message.packages;
      if (unique_name_packages !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_packages);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(42);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): distribute_keys_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new distribute_keys_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.author = reader.bytes();
            break;

          case 2:
            message.audience_id = reader.bytes();
            break;

          case 3:
            message.epoch = reader.uint32();
            break;

          case 4:
            message.packages = reader.bytes();
            break;

          case 5:
            message.device = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    author: Uint8Array | null;
    audience_id: Uint8Array | null;
    epoch: u32;
    packages: Uint8Array | null;
    device: Uint8Array | null;

    constructor(
      author: Uint8Array | null = null,
      audience_id: Uint8Array | null = null,
      epoch: u32 = 0,
      packages: Uint8Array | null = null,
      device: Uint8Array | null = null
    ) {
      this.author = author;
      this.audience_id = audience_id;
      this.epoch = epoch;
      this.packages = packages;
      this.device = device;
    }
  }

  @unmanaged
  export class distribute_keys_result {
    static encode(message: distribute_keys_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): distribute_keys_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new distribute_keys_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    constructor() {}
  }

  export class record_cross_post_arguments {
    static encode(message: record_cross_post_arguments, writer: Writer): void {
      const unique_name_author = message.author;
      if (unique_name_author !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_author);
      }

      const unique_name_idempotency_key = message.idempotency_key;
      if (unique_name_idempotency_key !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_idempotency_key);
      }

      const unique_name_adapter = message.adapter;
      if (unique_name_adapter !== null) {
        writer.uint32(26);
        writer.string(unique_name_adapter);
      }

      if (message.state != 0) {
        writer.uint32(32);
        writer.int32(message.state);
      }

      const unique_name_external_ref = message.external_ref;
      if (unique_name_external_ref !== null) {
        writer.uint32(42);
        writer.string(unique_name_external_ref);
      }

      const unique_name_post_id = message.post_id;
      if (unique_name_post_id !== null) {
        writer.uint32(50);
        writer.bytes(unique_name_post_id);
      }

      const unique_name_manifest_hash = message.manifest_hash;
      if (unique_name_manifest_hash !== null) {
        writer.uint32(58);
        writer.bytes(unique_name_manifest_hash);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(66);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): record_cross_post_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new record_cross_post_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.author = reader.bytes();
            break;

          case 2:
            message.idempotency_key = reader.bytes();
            break;

          case 3:
            message.adapter = reader.string();
            break;

          case 4:
            message.state = reader.int32();
            break;

          case 5:
            message.external_ref = reader.string();
            break;

          case 6:
            message.post_id = reader.bytes();
            break;

          case 7:
            message.manifest_hash = reader.bytes();
            break;

          case 8:
            message.device = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    author: Uint8Array | null;
    idempotency_key: Uint8Array | null;
    adapter: string | null;
    state: outcome_state;
    external_ref: string | null;
    post_id: Uint8Array | null;
    manifest_hash: Uint8Array | null;
    device: Uint8Array | null;

    constructor(
      author: Uint8Array | null = null,
      idempotency_key: Uint8Array | null = null,
      adapter: string | null = null,
      state: outcome_state = 0,
      external_ref: string | null = null,
      post_id: Uint8Array | null = null,
      manifest_hash: Uint8Array | null = null,
      device: Uint8Array | null = null
    ) {
      this.author = author;
      this.idempotency_key = idempotency_key;
      this.adapter = adapter;
      this.state = state;
      this.external_ref = external_ref;
      this.post_id = post_id;
      this.manifest_hash = manifest_hash;
      this.device = device;
    }
  }

  @unmanaged
  export class record_cross_post_result {
    static encode(message: record_cross_post_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): record_cross_post_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new record_cross_post_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    constructor() {}
  }

  export class get_post_arguments {
    static encode(message: get_post_arguments, writer: Writer): void {
      const unique_name_post_id = message.post_id;
      if (unique_name_post_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_post_id);
      }
    }

    static decode(reader: Reader, length: i32): get_post_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_post_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.post_id = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    post_id: Uint8Array | null;

    constructor(post_id: Uint8Array | null = null) {
      this.post_id = post_id;
    }
  }

  export class get_post_result {
    static encode(message: get_post_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        post_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_post_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_post_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = post_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: post_record | null;

    constructor(value: post_record | null = null) {
      this.value = value;
    }
  }

  export class get_author_state_arguments {
    static encode(message: get_author_state_arguments, writer: Writer): void {
      const unique_name_author = message.author;
      if (unique_name_author !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_author);
      }
    }

    static decode(reader: Reader, length: i32): get_author_state_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_author_state_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.author = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    author: Uint8Array | null;

    constructor(author: Uint8Array | null = null) {
      this.author = author;
    }
  }

  @unmanaged
  export class get_author_state_result {
    static encode(message: get_author_state_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        author_state.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_author_state_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_author_state_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = author_state.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: author_state | null;

    constructor(value: author_state | null = null) {
      this.value = value;
    }
  }

  export class get_post_by_idempotency_key_arguments {
    static encode(
      message: get_post_by_idempotency_key_arguments,
      writer: Writer
    ): void {
      const unique_name_author = message.author;
      if (unique_name_author !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_author);
      }

      const unique_name_idempotency_key = message.idempotency_key;
      if (unique_name_idempotency_key !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_idempotency_key);
      }
    }

    static decode(
      reader: Reader,
      length: i32
    ): get_post_by_idempotency_key_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_post_by_idempotency_key_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.author = reader.bytes();
            break;

          case 2:
            message.idempotency_key = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    author: Uint8Array | null;
    idempotency_key: Uint8Array | null;

    constructor(
      author: Uint8Array | null = null,
      idempotency_key: Uint8Array | null = null
    ) {
      this.author = author;
      this.idempotency_key = idempotency_key;
    }
  }

  export class get_post_by_idempotency_key_result {
    static encode(
      message: get_post_by_idempotency_key_result,
      writer: Writer
    ): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        post_ref.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(
      reader: Reader,
      length: i32
    ): get_post_by_idempotency_key_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_post_by_idempotency_key_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = post_ref.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: post_ref | null;

    constructor(value: post_ref | null = null) {
      this.value = value;
    }
  }

  @unmanaged
  export class get_limits_arguments {
    static encode(message: get_limits_arguments, writer: Writer): void {}

    static decode(reader: Reader, length: i32): get_limits_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_limits_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    constructor() {}
  }

  @unmanaged
  export class get_limits_result {
    static encode(message: get_limits_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        limits.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_limits_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_limits_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = limits.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: limits | null;

    constructor(value: limits | null = null) {
      this.value = value;
    }
  }

  @unmanaged
  export class get_dependencies_arguments {
    static encode(message: get_dependencies_arguments, writer: Writer): void {}

    static decode(reader: Reader, length: i32): get_dependencies_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_dependencies_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    constructor() {}
  }

  export class get_dependencies_result {
    static encode(message: get_dependencies_result, writer: Writer): void {
      const unique_name_identity = message.identity;
      if (unique_name_identity !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_identity);
      }

      const unique_name_relationships = message.relationships;
      if (unique_name_relationships !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_relationships);
      }
    }

    static decode(reader: Reader, length: i32): get_dependencies_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_dependencies_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.identity = reader.bytes();
            break;

          case 2:
            message.relationships = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    identity: Uint8Array | null;
    relationships: Uint8Array | null;

    constructor(
      identity: Uint8Array | null = null,
      relationships: Uint8Array | null = null
    ) {
      this.identity = identity;
      this.relationships = relationships;
    }
  }

  export class published_event {
    static encode(message: published_event, writer: Writer): void {
      const unique_name_author = message.author;
      if (unique_name_author !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_author);
      }

      const unique_name_post_id = message.post_id;
      if (unique_name_post_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_post_id);
      }

      const unique_name_content_hash = message.content_hash;
      if (unique_name_content_hash !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_content_hash);
      }

      const unique_name_previous_version = message.previous_version;
      if (unique_name_previous_version !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_previous_version);
      }

      if (message.version_number != 0) {
        writer.uint32(40);
        writer.uint32(message.version_number);
      }

      if (message.sequence != 0) {
        writer.uint32(48);
        writer.uint64(message.sequence);
      }

      if (message.audience != 0) {
        writer.uint32(56);
        writer.int32(message.audience);
      }

      const unique_name_audience_id = message.audience_id;
      if (unique_name_audience_id !== null) {
        writer.uint32(66);
        writer.bytes(unique_name_audience_id);
      }

      if (message.epoch != 0) {
        writer.uint32(72);
        writer.uint32(message.epoch);
      }

      const unique_name_envelope = message.envelope;
      if (unique_name_envelope !== null) {
        writer.uint32(82);
        writer.bytes(unique_name_envelope);
      }

      const unique_name_media = message.media;
      for (let i = 0; i < unique_name_media.length; ++i) {
        writer.uint32(90);
        writer.fork();
        media_ref.encode(unique_name_media[i], writer);
        writer.ldelim();
      }

      const unique_name_reply_to = message.reply_to;
      if (unique_name_reply_to !== null) {
        writer.uint32(98);
        writer.bytes(unique_name_reply_to);
      }

      const unique_name_idempotency_key = message.idempotency_key;
      if (unique_name_idempotency_key !== null) {
        writer.uint32(106);
        writer.bytes(unique_name_idempotency_key);
      }

      if (message.protocol_version != 0) {
        writer.uint32(112);
        writer.uint32(message.protocol_version);
      }

      if (message.timestamp != 0) {
        writer.uint32(120);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): published_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new published_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.author = reader.bytes();
            break;

          case 2:
            message.post_id = reader.bytes();
            break;

          case 3:
            message.content_hash = reader.bytes();
            break;

          case 4:
            message.previous_version = reader.bytes();
            break;

          case 5:
            message.version_number = reader.uint32();
            break;

          case 6:
            message.sequence = reader.uint64();
            break;

          case 7:
            message.audience = reader.int32();
            break;

          case 8:
            message.audience_id = reader.bytes();
            break;

          case 9:
            message.epoch = reader.uint32();
            break;

          case 10:
            message.envelope = reader.bytes();
            break;

          case 11:
            message.media.push(media_ref.decode(reader, reader.uint32()));
            break;

          case 12:
            message.reply_to = reader.bytes();
            break;

          case 13:
            message.idempotency_key = reader.bytes();
            break;

          case 14:
            message.protocol_version = reader.uint32();
            break;

          case 15:
            message.timestamp = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    author: Uint8Array | null;
    post_id: Uint8Array | null;
    content_hash: Uint8Array | null;
    previous_version: Uint8Array | null;
    version_number: u32;
    sequence: u64;
    audience: audience_kind;
    audience_id: Uint8Array | null;
    epoch: u32;
    envelope: Uint8Array | null;
    media: Array<media_ref>;
    reply_to: Uint8Array | null;
    idempotency_key: Uint8Array | null;
    protocol_version: u32;
    timestamp: u64;

    constructor(
      author: Uint8Array | null = null,
      post_id: Uint8Array | null = null,
      content_hash: Uint8Array | null = null,
      previous_version: Uint8Array | null = null,
      version_number: u32 = 0,
      sequence: u64 = 0,
      audience: audience_kind = 0,
      audience_id: Uint8Array | null = null,
      epoch: u32 = 0,
      envelope: Uint8Array | null = null,
      media: Array<media_ref> = [],
      reply_to: Uint8Array | null = null,
      idempotency_key: Uint8Array | null = null,
      protocol_version: u32 = 0,
      timestamp: u64 = 0
    ) {
      this.author = author;
      this.post_id = post_id;
      this.content_hash = content_hash;
      this.previous_version = previous_version;
      this.version_number = version_number;
      this.sequence = sequence;
      this.audience = audience;
      this.audience_id = audience_id;
      this.epoch = epoch;
      this.envelope = envelope;
      this.media = media;
      this.reply_to = reply_to;
      this.idempotency_key = idempotency_key;
      this.protocol_version = protocol_version;
      this.timestamp = timestamp;
    }
  }

  export class lifecycle_event {
    static encode(message: lifecycle_event, writer: Writer): void {
      const unique_name_author = message.author;
      if (unique_name_author !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_author);
      }

      const unique_name_post_id = message.post_id;
      if (unique_name_post_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_post_id);
      }

      const unique_name_version = message.version;
      if (unique_name_version !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_version);
      }

      if (message.state != 0) {
        writer.uint32(32);
        writer.int32(message.state);
      }

      const unique_name_reason = message.reason;
      if (unique_name_reason !== null) {
        writer.uint32(42);
        writer.string(unique_name_reason);
      }

      const unique_name_replacement_id = message.replacement_id;
      if (unique_name_replacement_id !== null) {
        writer.uint32(50);
        writer.bytes(unique_name_replacement_id);
      }

      if (message.timestamp != 0) {
        writer.uint32(56);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): lifecycle_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new lifecycle_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.author = reader.bytes();
            break;

          case 2:
            message.post_id = reader.bytes();
            break;

          case 3:
            message.version = reader.bytes();
            break;

          case 4:
            message.state = reader.int32();
            break;

          case 5:
            message.reason = reader.string();
            break;

          case 6:
            message.replacement_id = reader.bytes();
            break;

          case 7:
            message.timestamp = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    author: Uint8Array | null;
    post_id: Uint8Array | null;
    version: Uint8Array | null;
    state: lifecycle_state;
    reason: string | null;
    replacement_id: Uint8Array | null;
    timestamp: u64;

    constructor(
      author: Uint8Array | null = null,
      post_id: Uint8Array | null = null,
      version: Uint8Array | null = null,
      state: lifecycle_state = 0,
      reason: string | null = null,
      replacement_id: Uint8Array | null = null,
      timestamp: u64 = 0
    ) {
      this.author = author;
      this.post_id = post_id;
      this.version = version;
      this.state = state;
      this.reason = reason;
      this.replacement_id = replacement_id;
      this.timestamp = timestamp;
    }
  }

  export class reaction_event {
    static encode(message: reaction_event, writer: Writer): void {
      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_post_id = message.post_id;
      if (unique_name_post_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_post_id);
      }

      const unique_name_post_author = message.post_author;
      if (unique_name_post_author !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_post_author);
      }

      if (message.reaction != 0) {
        writer.uint32(32);
        writer.uint32(message.reaction);
      }

      if (message.removed != false) {
        writer.uint32(40);
        writer.bool(message.removed);
      }

      if (message.timestamp != 0) {
        writer.uint32(48);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): reaction_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new reaction_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
            message.post_id = reader.bytes();
            break;

          case 3:
            message.post_author = reader.bytes();
            break;

          case 4:
            message.reaction = reader.uint32();
            break;

          case 5:
            message.removed = reader.bool();
            break;

          case 6:
            message.timestamp = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    actor: Uint8Array | null;
    post_id: Uint8Array | null;
    post_author: Uint8Array | null;
    reaction: u32;
    removed: bool;
    timestamp: u64;

    constructor(
      actor: Uint8Array | null = null,
      post_id: Uint8Array | null = null,
      post_author: Uint8Array | null = null,
      reaction: u32 = 0,
      removed: bool = false,
      timestamp: u64 = 0
    ) {
      this.actor = actor;
      this.post_id = post_id;
      this.post_author = post_author;
      this.reaction = reaction;
      this.removed = removed;
      this.timestamp = timestamp;
    }
  }

  export class keys_distributed_event {
    static encode(message: keys_distributed_event, writer: Writer): void {
      const unique_name_author = message.author;
      if (unique_name_author !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_author);
      }

      const unique_name_audience_id = message.audience_id;
      if (unique_name_audience_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_audience_id);
      }

      if (message.epoch != 0) {
        writer.uint32(24);
        writer.uint32(message.epoch);
      }

      const unique_name_packages = message.packages;
      if (unique_name_packages !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_packages);
      }

      if (message.timestamp != 0) {
        writer.uint32(40);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): keys_distributed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new keys_distributed_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.author = reader.bytes();
            break;

          case 2:
            message.audience_id = reader.bytes();
            break;

          case 3:
            message.epoch = reader.uint32();
            break;

          case 4:
            message.packages = reader.bytes();
            break;

          case 5:
            message.timestamp = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    author: Uint8Array | null;
    audience_id: Uint8Array | null;
    epoch: u32;
    packages: Uint8Array | null;
    timestamp: u64;

    constructor(
      author: Uint8Array | null = null,
      audience_id: Uint8Array | null = null,
      epoch: u32 = 0,
      packages: Uint8Array | null = null,
      timestamp: u64 = 0
    ) {
      this.author = author;
      this.audience_id = audience_id;
      this.epoch = epoch;
      this.packages = packages;
      this.timestamp = timestamp;
    }
  }

  export class cross_post_outcome_event {
    static encode(message: cross_post_outcome_event, writer: Writer): void {
      const unique_name_author = message.author;
      if (unique_name_author !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_author);
      }

      const unique_name_idempotency_key = message.idempotency_key;
      if (unique_name_idempotency_key !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_idempotency_key);
      }

      const unique_name_adapter = message.adapter;
      if (unique_name_adapter !== null) {
        writer.uint32(26);
        writer.string(unique_name_adapter);
      }

      if (message.state != 0) {
        writer.uint32(32);
        writer.int32(message.state);
      }

      const unique_name_external_ref = message.external_ref;
      if (unique_name_external_ref !== null) {
        writer.uint32(42);
        writer.string(unique_name_external_ref);
      }

      const unique_name_post_id = message.post_id;
      if (unique_name_post_id !== null) {
        writer.uint32(50);
        writer.bytes(unique_name_post_id);
      }

      const unique_name_manifest_hash = message.manifest_hash;
      if (unique_name_manifest_hash !== null) {
        writer.uint32(58);
        writer.bytes(unique_name_manifest_hash);
      }

      if (message.timestamp != 0) {
        writer.uint32(64);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): cross_post_outcome_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new cross_post_outcome_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.author = reader.bytes();
            break;

          case 2:
            message.idempotency_key = reader.bytes();
            break;

          case 3:
            message.adapter = reader.string();
            break;

          case 4:
            message.state = reader.int32();
            break;

          case 5:
            message.external_ref = reader.string();
            break;

          case 6:
            message.post_id = reader.bytes();
            break;

          case 7:
            message.manifest_hash = reader.bytes();
            break;

          case 8:
            message.timestamp = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    author: Uint8Array | null;
    idempotency_key: Uint8Array | null;
    adapter: string | null;
    state: outcome_state;
    external_ref: string | null;
    post_id: Uint8Array | null;
    manifest_hash: Uint8Array | null;
    timestamp: u64;

    constructor(
      author: Uint8Array | null = null,
      idempotency_key: Uint8Array | null = null,
      adapter: string | null = null,
      state: outcome_state = 0,
      external_ref: string | null = null,
      post_id: Uint8Array | null = null,
      manifest_hash: Uint8Array | null = null,
      timestamp: u64 = 0
    ) {
      this.author = author;
      this.idempotency_key = idempotency_key;
      this.adapter = adapter;
      this.state = state;
      this.external_ref = external_ref;
      this.post_id = post_id;
      this.manifest_hash = manifest_hash;
      this.timestamp = timestamp;
    }
  }

  export enum audience_kind {
    everyone = 0,
    friends = 1,
    custom = 2,
  }

  export enum lifecycle_state {
    active = 0,
    author_hidden = 1,
    deleted = 2,
    unavailable = 3,
    migrated = 4,
    superseded = 5,
  }

  export enum outcome_state {
    succeeded = 0,
    partial = 1,
    unknown = 2,
    failed = 3,
    reconcile_required = 4,
  }
}
