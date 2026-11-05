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

      const unique_name_collection_id = message.collection_id;
      if (unique_name_collection_id !== null) {
        writer.uint32(82);
        writer.bytes(unique_name_collection_id);
      }

      if (message.gallery_only != false) {
        writer.uint32(88);
        writer.bool(message.gallery_only);
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

          case 10:
            message.collection_id = reader.bytes();
            break;

          case 11:
            message.gallery_only = reader.bool();
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
    collection_id: Uint8Array | null;
    gallery_only: bool;

    constructor(
      author: Uint8Array | null = null,
      sequence: u64 = 0,
      version_count: u32 = 0,
      latest_version: Uint8Array | null = null,
      state: lifecycle_state = 0,
      reply_to: Uint8Array | null = null,
      audience: audience_kind = 0,
      created_at: u64 = 0,
      updated_at: u64 = 0,
      collection_id: Uint8Array | null = null,
      gallery_only: bool = false
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
      this.collection_id = collection_id;
      this.gallery_only = gallery_only;
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

      const unique_name_poll = message.poll;
      if (unique_name_poll !== null) {
        writer.uint32(114);
        writer.fork();
        poll_definition.encode(unique_name_poll, writer);
        writer.ldelim();
      }

      const unique_name_collection_id = message.collection_id;
      if (unique_name_collection_id !== null) {
        writer.uint32(122);
        writer.bytes(unique_name_collection_id);
      }

      if (message.gallery_only != false) {
        writer.uint32(128);
        writer.bool(message.gallery_only);
      }

      const unique_name_reply_parent_version = message.reply_parent_version;
      if (unique_name_reply_parent_version !== null) {
        writer.uint32(138);
        writer.bytes(unique_name_reply_parent_version);
      }

      if (message.reply_friends_epoch != 0) {
        writer.uint32(144);
        writer.uint32(message.reply_friends_epoch);
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

          case 14:
            message.poll = poll_definition.decode(reader, reader.uint32());
            break;

          case 15:
            message.collection_id = reader.bytes();
            break;

          case 16:
            message.gallery_only = reader.bool();
            break;

          case 17:
            message.reply_parent_version = reader.bytes();
            break;

          case 18:
            message.reply_friends_epoch = reader.uint32();
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
    poll: poll_definition | null;
    collection_id: Uint8Array | null;
    gallery_only: bool;
    reply_parent_version: Uint8Array | null;
    reply_friends_epoch: u32;

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
      device: Uint8Array | null = null,
      poll: poll_definition | null = null,
      collection_id: Uint8Array | null = null,
      gallery_only: bool = false,
      reply_parent_version: Uint8Array | null = null,
      reply_friends_epoch: u32 = 0
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
      this.poll = poll;
      this.collection_id = collection_id;
      this.gallery_only = gallery_only;
      this.reply_parent_version = reply_parent_version;
      this.reply_friends_epoch = reply_friends_epoch;
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

  export class get_music_vote_target_arguments {
    static encode(
      message: get_music_vote_target_arguments,
      writer: Writer
    ): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }

      const unique_name_viewer = message.viewer;
      if (unique_name_viewer !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_viewer);
      }
    }

    static decode(
      reader: Reader,
      length: i32
    ): get_music_vote_target_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_music_vote_target_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.bytes();
            break;

          case 2:
            message.viewer = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: Uint8Array | null;
    viewer: Uint8Array | null;

    constructor(
      id: Uint8Array | null = null,
      viewer: Uint8Array | null = null
    ) {
      this.id = id;
      this.viewer = viewer;
    }
  }

  export class get_music_vote_target_result {
    static encode(message: get_music_vote_target_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        post_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_music_vote_target_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_music_vote_target_result();

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

      const unique_name_collection_id = message.collection_id;
      if (unique_name_collection_id !== null) {
        writer.uint32(130);
        writer.bytes(unique_name_collection_id);
      }

      if (message.gallery_only != false) {
        writer.uint32(136);
        writer.bool(message.gallery_only);
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

          case 16:
            message.collection_id = reader.bytes();
            break;

          case 17:
            message.gallery_only = reader.bool();
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
    collection_id: Uint8Array | null;
    gallery_only: bool;

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
      timestamp: u64 = 0,
      collection_id: Uint8Array | null = null,
      gallery_only: bool = false
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
      this.collection_id = collection_id;
      this.gallery_only = gallery_only;
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

      if (message.exclusive != false) {
        writer.uint32(56);
        writer.bool(message.exclusive);
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

          case 7:
            message.exclusive = reader.bool();
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
    exclusive: bool;

    constructor(
      actor: Uint8Array | null = null,
      post_id: Uint8Array | null = null,
      post_author: Uint8Array | null = null,
      reaction: u32 = 0,
      removed: bool = false,
      timestamp: u64 = 0,
      exclusive: bool = false
    ) {
      this.actor = actor;
      this.post_id = post_id;
      this.post_author = post_author;
      this.reaction = reaction;
      this.removed = removed;
      this.timestamp = timestamp;
      this.exclusive = exclusive;
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

  export class set_token_contract_arguments {
    static encode(message: set_token_contract_arguments, writer: Writer): void {
      const unique_name_address = message.address;
      if (unique_name_address !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_address);
      }
    }

    static decode(reader: Reader, length: i32): set_token_contract_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_token_contract_arguments();

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
  export class set_token_contract_result {
    static encode(message: set_token_contract_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): set_token_contract_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_token_contract_result();

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
  export class get_token_contract_arguments {
    static encode(
      message: get_token_contract_arguments,
      writer: Writer
    ): void {}

    static decode(reader: Reader, length: i32): get_token_contract_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_token_contract_arguments();

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

  export class get_token_contract_result {
    static encode(message: get_token_contract_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_value);
      }
    }

    static decode(reader: Reader, length: i32): get_token_contract_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_token_contract_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: Uint8Array | null;

    constructor(value: Uint8Array | null = null) {
      this.value = value;
    }
  }

  export class poll_definition {
    static encode(message: poll_definition, writer: Writer): void {
      const unique_name_question = message.question;
      if (unique_name_question !== null) {
        writer.uint32(10);
        writer.string(unique_name_question);
      }

      const unique_name_options = message.options;
      if (unique_name_options.length !== 0) {
        for (let i = 0; i < unique_name_options.length; ++i) {
          writer.uint32(18);
          writer.string(unique_name_options[i]);
        }
      }

      if (message.closes_at != 0) {
        writer.uint32(24);
        writer.uint64(message.closes_at);
      }
    }

    static decode(reader: Reader, length: i32): poll_definition {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new poll_definition();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.question = reader.string();
            break;

          case 2:
            message.options.push(reader.string());
            break;

          case 3:
            message.closes_at = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    question: string | null;
    options: Array<string>;
    closes_at: u64;

    constructor(
      question: string | null = null,
      options: Array<string> = [],
      closes_at: u64 = 0
    ) {
      this.question = question;
      this.options = options;
      this.closes_at = closes_at;
    }
  }

  export class poll_record {
    static encode(message: poll_record, writer: Writer): void {
      const unique_name_definition = message.definition;
      if (unique_name_definition !== null) {
        writer.uint32(10);
        writer.fork();
        poll_definition.encode(unique_name_definition, writer);
        writer.ldelim();
      }

      const unique_name_counts = message.counts;
      if (unique_name_counts.length !== 0) {
        for (let i = 0; i < unique_name_counts.length; ++i) {
          writer.uint32(16);
          writer.uint32(unique_name_counts[i]);
        }
      }

      if (message.participants != 0) {
        writer.uint32(24);
        writer.uint32(message.participants);
      }

      if (message.engagement_participants != 0) {
        writer.uint32(32);
        writer.uint32(message.engagement_participants);
      }

      if (message.engagement_milli != 0) {
        writer.uint32(40);
        writer.uint64(message.engagement_milli);
      }
    }

    static decode(reader: Reader, length: i32): poll_record {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new poll_record();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.definition = poll_definition.decode(
              reader,
              reader.uint32()
            );
            break;

          case 2:
            if ((tag & 7) == 2) {
              const packedLength = reader.uint32();
              assert(reader.ptr <= end && <usize>packedLength <= end - reader.ptr);
              const packedEnd = reader.ptr + packedLength;
              while (reader.ptr < packedEnd) {
                message.counts.push(reader.uint32());
              }
              assert(reader.ptr == packedEnd);
            } else {
              assert((tag & 7) == 0);
              message.counts.push(reader.uint32());
            }
            break;

          case 3:
            message.participants = reader.uint32();
            break;

          case 4:
            message.engagement_participants = reader.uint32();
            break;

          case 5:
            message.engagement_milli = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    definition: poll_definition | null;
    counts: Array<u32>;
    participants: u32;
    engagement_participants: u32;
    engagement_milli: u64;

    constructor(
      definition: poll_definition | null = null,
      counts: Array<u32> = [],
      participants: u32 = 0,
      engagement_participants: u32 = 0,
      engagement_milli: u64 = 0
    ) {
      this.definition = definition;
      this.counts = counts;
      this.participants = participants;
      this.engagement_participants = engagement_participants;
      this.engagement_milli = engagement_milli;
    }
  }

  @unmanaged
  export class poll_ballot {
    static encode(message: poll_ballot, writer: Writer): void {
      if (message.option != 0) {
        writer.uint32(8);
        writer.uint32(message.option);
      }
    }

    static decode(reader: Reader, length: i32): poll_ballot {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new poll_ballot();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.option = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    option: u32;

    constructor(option: u32 = 0) {
      this.option = option;
    }
  }

  export class answer_poll_arguments {
    static encode(message: answer_poll_arguments, writer: Writer): void {
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

      if (message.option != 0) {
        writer.uint32(24);
        writer.uint32(message.option);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): answer_poll_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new answer_poll_arguments();

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
            message.option = reader.uint32();
            break;

          case 4:
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
    option: u32;
    device: Uint8Array | null;

    constructor(
      actor: Uint8Array | null = null,
      post_id: Uint8Array | null = null,
      option: u32 = 0,
      device: Uint8Array | null = null
    ) {
      this.actor = actor;
      this.post_id = post_id;
      this.option = option;
      this.device = device;
    }
  }

  @unmanaged
  export class answer_poll_result {
    static encode(message: answer_poll_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): answer_poll_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new answer_poll_result();

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

  export class get_poll_arguments {
    static encode(message: get_poll_arguments, writer: Writer): void {
      const unique_name_post_id = message.post_id;
      if (unique_name_post_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_post_id);
      }

      const unique_name_viewer = message.viewer;
      if (unique_name_viewer !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_viewer);
      }
    }

    static decode(reader: Reader, length: i32): get_poll_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_poll_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.post_id = reader.bytes();
            break;

          case 2:
            message.viewer = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    post_id: Uint8Array | null;
    viewer: Uint8Array | null;

    constructor(
      post_id: Uint8Array | null = null,
      viewer: Uint8Array | null = null
    ) {
      this.post_id = post_id;
      this.viewer = viewer;
    }
  }

  export class get_poll_result {
    static encode(message: get_poll_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        poll_record.encode(unique_name_value, writer);
        writer.ldelim();
      }

      const unique_name_ballot = message.ballot;
      if (unique_name_ballot !== null) {
        writer.uint32(18);
        writer.fork();
        poll_ballot.encode(unique_name_ballot, writer);
        writer.ldelim();
      }

      if (message.now != 0) {
        writer.uint32(24);
        writer.uint64(message.now);
      }
    }

    static decode(reader: Reader, length: i32): get_poll_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_poll_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = poll_record.decode(reader, reader.uint32());
            break;

          case 2:
            message.ballot = poll_ballot.decode(reader, reader.uint32());
            break;

          case 3:
            message.now = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: poll_record | null;
    ballot: poll_ballot | null;
    now: u64;

    constructor(
      value: poll_record | null = null,
      ballot: poll_ballot | null = null,
      now: u64 = 0
    ) {
      this.value = value;
      this.ballot = ballot;
      this.now = now;
    }
  }

  export class poll_created_event {
    static encode(message: poll_created_event, writer: Writer): void {
      const unique_name_post_id = message.post_id;
      if (unique_name_post_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_post_id);
      }

      const unique_name_poll = message.poll;
      if (unique_name_poll !== null) {
        writer.uint32(18);
        writer.fork();
        poll_record.encode(unique_name_poll, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): poll_created_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new poll_created_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.post_id = reader.bytes();
            break;

          case 2:
            message.poll = poll_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    post_id: Uint8Array | null;
    poll: poll_record | null;

    constructor(
      post_id: Uint8Array | null = null,
      poll: poll_record | null = null
    ) {
      this.post_id = post_id;
      this.poll = poll;
    }
  }

  export class poll_answered_event {
    static encode(message: poll_answered_event, writer: Writer): void {
      const unique_name_post_id = message.post_id;
      if (unique_name_post_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_post_id);
      }

      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_actor);
      }

      const unique_name_ballot = message.ballot;
      if (unique_name_ballot !== null) {
        writer.uint32(26);
        writer.fork();
        poll_ballot.encode(unique_name_ballot, writer);
        writer.ldelim();
      }

      const unique_name_poll = message.poll;
      if (unique_name_poll !== null) {
        writer.uint32(34);
        writer.fork();
        poll_record.encode(unique_name_poll, writer);
        writer.ldelim();
      }

      if (message.timestamp != 0) {
        writer.uint32(40);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): poll_answered_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new poll_answered_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.post_id = reader.bytes();
            break;

          case 2:
            message.actor = reader.bytes();
            break;

          case 3:
            message.ballot = poll_ballot.decode(reader, reader.uint32());
            break;

          case 4:
            message.poll = poll_record.decode(reader, reader.uint32());
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

    post_id: Uint8Array | null;
    actor: Uint8Array | null;
    ballot: poll_ballot | null;
    poll: poll_record | null;
    timestamp: u64;

    constructor(
      post_id: Uint8Array | null = null,
      actor: Uint8Array | null = null,
      ballot: poll_ballot | null = null,
      poll: poll_record | null = null,
      timestamp: u64 = 0
    ) {
      this.post_id = post_id;
      this.actor = actor;
      this.ballot = ballot;
      this.poll = poll;
      this.timestamp = timestamp;
    }
  }

  export class photo_archive_record {
    static encode(message: photo_archive_record, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      const unique_name_digest = message.digest;
      if (unique_name_digest !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_digest);
      }

      if (message.size != 0) {
        writer.uint32(24);
        writer.uint32(message.size);
      }

      const unique_name_chunk_hashes = message.chunk_hashes;
      if (unique_name_chunk_hashes.length !== 0) {
        for (let i = 0; i < unique_name_chunk_hashes.length; ++i) {
          writer.uint32(34);
          writer.bytes(unique_name_chunk_hashes[i]);
        }
      }

      if (message.received != 0) {
        writer.uint32(40);
        writer.uint32(message.received);
      }

      if (message.units != 0) {
        writer.uint32(48);
        writer.uint32(message.units);
      }
    }

    static decode(reader: Reader, length: i32): photo_archive_record {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new photo_archive_record();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.digest = reader.bytes();
            break;

          case 3:
            message.size = reader.uint32();
            break;

          case 4:
            message.chunk_hashes.push(reader.bytes());
            break;

          case 5:
            message.received = reader.uint32();
            break;

          case 6:
            message.units = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    owner: Uint8Array | null;
    digest: Uint8Array | null;
    size: u32;
    chunk_hashes: Array<Uint8Array>;
    received: u32;
    units: u32;

    constructor(
      owner: Uint8Array | null = null,
      digest: Uint8Array | null = null,
      size: u32 = 0,
      chunk_hashes: Array<Uint8Array> = [],
      received: u32 = 0,
      units: u32 = 0
    ) {
      this.owner = owner;
      this.digest = digest;
      this.size = size;
      this.chunk_hashes = chunk_hashes;
      this.received = received;
      this.units = units;
    }
  }

  export class begin_photo_arguments {
    static encode(message: begin_photo_arguments, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_id);
      }

      const unique_name_digest = message.digest;
      if (unique_name_digest !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_digest);
      }

      if (message.size != 0) {
        writer.uint32(32);
        writer.uint32(message.size);
      }

      const unique_name_chunk_hashes = message.chunk_hashes;
      if (unique_name_chunk_hashes.length !== 0) {
        for (let i = 0; i < unique_name_chunk_hashes.length; ++i) {
          writer.uint32(42);
          writer.bytes(unique_name_chunk_hashes[i]);
        }
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(50);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): begin_photo_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new begin_photo_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.id = reader.bytes();
            break;

          case 3:
            message.digest = reader.bytes();
            break;

          case 4:
            message.size = reader.uint32();
            break;

          case 5:
            message.chunk_hashes.push(reader.bytes());
            break;

          case 6:
            message.device = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    owner: Uint8Array | null;
    id: Uint8Array | null;
    digest: Uint8Array | null;
    size: u32;
    chunk_hashes: Array<Uint8Array>;
    device: Uint8Array | null;

    constructor(
      owner: Uint8Array | null = null,
      id: Uint8Array | null = null,
      digest: Uint8Array | null = null,
      size: u32 = 0,
      chunk_hashes: Array<Uint8Array> = [],
      device: Uint8Array | null = null
    ) {
      this.owner = owner;
      this.id = id;
      this.digest = digest;
      this.size = size;
      this.chunk_hashes = chunk_hashes;
      this.device = device;
    }
  }

  @unmanaged
  export class begin_photo_result {
    static encode(message: begin_photo_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): begin_photo_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new begin_photo_result();

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

  export class append_photo_arguments {
    static encode(message: append_photo_arguments, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_id);
      }

      if (message.index != 0) {
        writer.uint32(24);
        writer.uint32(message.index);
      }

      const unique_name_data = message.data;
      if (unique_name_data !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_data);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(42);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): append_photo_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new append_photo_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.id = reader.bytes();
            break;

          case 3:
            message.index = reader.uint32();
            break;

          case 4:
            message.data = reader.bytes();
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

    owner: Uint8Array | null;
    id: Uint8Array | null;
    index: u32;
    data: Uint8Array | null;
    device: Uint8Array | null;

    constructor(
      owner: Uint8Array | null = null,
      id: Uint8Array | null = null,
      index: u32 = 0,
      data: Uint8Array | null = null,
      device: Uint8Array | null = null
    ) {
      this.owner = owner;
      this.id = id;
      this.index = index;
      this.data = data;
      this.device = device;
    }
  }

  @unmanaged
  export class append_photo_result {
    static encode(message: append_photo_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): append_photo_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new append_photo_result();

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

  export class get_photo_arguments {
    static encode(message: get_photo_arguments, writer: Writer): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }
    }

    static decode(reader: Reader, length: i32): get_photo_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_photo_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: Uint8Array | null;

    constructor(id: Uint8Array | null = null) {
      this.id = id;
    }
  }

  export class get_photo_result {
    static encode(message: get_photo_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        photo_archive_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_photo_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_photo_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = photo_archive_record.decode(
              reader,
              reader.uint32()
            );
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: photo_archive_record | null;

    constructor(value: photo_archive_record | null = null) {
      this.value = value;
    }
  }

  @unmanaged
  export class get_library_version_arguments {
    static encode(
      message: get_library_version_arguments,
      writer: Writer
    ): void {}

    static decode(reader: Reader, length: i32): get_library_version_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_library_version_arguments();

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
  export class get_library_version_result {
    static encode(message: get_library_version_result, writer: Writer): void {
      if (message.version != 0) {
        writer.uint32(8);
        writer.uint32(message.version);
      }
    }

    static decode(reader: Reader, length: i32): get_library_version_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_library_version_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.version = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    version: u32;

    constructor(version: u32 = 0) {
      this.version = version;
    }
  }

  export class photo_chunk_event {
    static encode(message: photo_chunk_event, writer: Writer): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }

      if (message.index != 0) {
        writer.uint32(16);
        writer.uint32(message.index);
      }

      const unique_name_data = message.data;
      if (unique_name_data !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_data);
      }
    }

    static decode(reader: Reader, length: i32): photo_chunk_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new photo_chunk_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.bytes();
            break;

          case 2:
            message.index = reader.uint32();
            break;

          case 3:
            message.data = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: Uint8Array | null;
    index: u32;
    data: Uint8Array | null;

    constructor(
      id: Uint8Array | null = null,
      index: u32 = 0,
      data: Uint8Array | null = null
    ) {
      this.id = id;
      this.index = index;
      this.data = data;
    }
  }

  export class photo_started_event {
    static encode(message: photo_started_event, writer: Writer): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }

      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(18);
        writer.fork();
        photo_archive_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): photo_started_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new photo_started_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.bytes();
            break;

          case 2:
            message.value = photo_archive_record.decode(
              reader,
              reader.uint32()
            );
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: Uint8Array | null;
    value: photo_archive_record | null;

    constructor(
      id: Uint8Array | null = null,
      value: photo_archive_record | null = null
    ) {
      this.id = id;
      this.value = value;
    }
  }

  export class collection_record {
    static encode(message: collection_record, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      if (message.kind != 0) {
        writer.uint32(16);
        writer.uint32(message.kind);
      }

      if (message.revision != 0) {
        writer.uint32(24);
        writer.uint32(message.revision);
      }

      if (message.audience != 0) {
        writer.uint32(32);
        writer.int32(message.audience);
      }

      const unique_name_members = message.members;
      if (unique_name_members.length !== 0) {
        for (let i = 0; i < unique_name_members.length; ++i) {
          writer.uint32(42);
          writer.bytes(unique_name_members[i]);
        }
      }

      const unique_name_envelope = message.envelope;
      if (unique_name_envelope !== null) {
        writer.uint32(50);
        writer.bytes(unique_name_envelope);
      }

      if (message.closed != false) {
        writer.uint32(56);
        writer.bool(message.closed);
      }
    }

    static decode(reader: Reader, length: i32): collection_record {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new collection_record();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.kind = reader.uint32();
            break;

          case 3:
            message.revision = reader.uint32();
            break;

          case 4:
            message.audience = reader.int32();
            break;

          case 5:
            message.members.push(reader.bytes());
            break;

          case 6:
            message.envelope = reader.bytes();
            break;

          case 7:
            message.closed = reader.bool();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    owner: Uint8Array | null;
    kind: u32;
    revision: u32;
    audience: audience_kind;
    members: Array<Uint8Array>;
    envelope: Uint8Array | null;
    closed: bool;

    constructor(
      owner: Uint8Array | null = null,
      kind: u32 = 0,
      revision: u32 = 0,
      audience: audience_kind = 0,
      members: Array<Uint8Array> = [],
      envelope: Uint8Array | null = null,
      closed: bool = false
    ) {
      this.owner = owner;
      this.kind = kind;
      this.revision = revision;
      this.audience = audience;
      this.members = members;
      this.envelope = envelope;
      this.closed = closed;
    }
  }

  export class save_collection_arguments {
    static encode(message: save_collection_arguments, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_id);
      }

      if (message.previous_revision != 0) {
        writer.uint32(24);
        writer.uint32(message.previous_revision);
      }

      if (message.kind != 0) {
        writer.uint32(32);
        writer.uint32(message.kind);
      }

      if (message.audience != 0) {
        writer.uint32(40);
        writer.int32(message.audience);
      }

      const unique_name_members = message.members;
      if (unique_name_members.length !== 0) {
        for (let i = 0; i < unique_name_members.length; ++i) {
          writer.uint32(50);
          writer.bytes(unique_name_members[i]);
        }
      }

      const unique_name_envelope = message.envelope;
      if (unique_name_envelope !== null) {
        writer.uint32(58);
        writer.bytes(unique_name_envelope);
      }

      if (message.closed != false) {
        writer.uint32(64);
        writer.bool(message.closed);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(74);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): save_collection_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new save_collection_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.id = reader.bytes();
            break;

          case 3:
            message.previous_revision = reader.uint32();
            break;

          case 4:
            message.kind = reader.uint32();
            break;

          case 5:
            message.audience = reader.int32();
            break;

          case 6:
            message.members.push(reader.bytes());
            break;

          case 7:
            message.envelope = reader.bytes();
            break;

          case 8:
            message.closed = reader.bool();
            break;

          case 9:
            message.device = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    owner: Uint8Array | null;
    id: Uint8Array | null;
    previous_revision: u32;
    kind: u32;
    audience: audience_kind;
    members: Array<Uint8Array>;
    envelope: Uint8Array | null;
    closed: bool;
    device: Uint8Array | null;

    constructor(
      owner: Uint8Array | null = null,
      id: Uint8Array | null = null,
      previous_revision: u32 = 0,
      kind: u32 = 0,
      audience: audience_kind = 0,
      members: Array<Uint8Array> = [],
      envelope: Uint8Array | null = null,
      closed: bool = false,
      device: Uint8Array | null = null
    ) {
      this.owner = owner;
      this.id = id;
      this.previous_revision = previous_revision;
      this.kind = kind;
      this.audience = audience;
      this.members = members;
      this.envelope = envelope;
      this.closed = closed;
      this.device = device;
    }
  }

  @unmanaged
  export class save_collection_result {
    static encode(message: save_collection_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): save_collection_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new save_collection_result();

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

  export class get_collection_arguments {
    static encode(message: get_collection_arguments, writer: Writer): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }
    }

    static decode(reader: Reader, length: i32): get_collection_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_collection_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: Uint8Array | null;

    constructor(id: Uint8Array | null = null) {
      this.id = id;
    }
  }

  export class get_collection_result {
    static encode(message: get_collection_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        collection_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_collection_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_collection_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = collection_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: collection_record | null;

    constructor(value: collection_record | null = null) {
      this.value = value;
    }
  }

  export class collection_changed_event {
    static encode(message: collection_changed_event, writer: Writer): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }

      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(18);
        writer.fork();
        collection_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): collection_changed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new collection_changed_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.bytes();
            break;

          case 2:
            message.value = collection_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: Uint8Array | null;
    value: collection_record | null;

    constructor(
      id: Uint8Array | null = null,
      value: collection_record | null = null
    ) {
      this.id = id;
      this.value = value;
    }
  }

  export class album_item_record {
    static encode(message: album_item_record, writer: Writer): void {
      const unique_name_envelope = message.envelope;
      if (unique_name_envelope !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_envelope);
      }

      if (message.epoch != 0) {
        writer.uint32(16);
        writer.uint32(message.epoch);
      }

      if (message.revision != 0) {
        writer.uint32(24);
        writer.uint32(message.revision);
      }

      if (message.removed != false) {
        writer.uint32(32);
        writer.bool(message.removed);
      }
    }

    static decode(reader: Reader, length: i32): album_item_record {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new album_item_record();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.envelope = reader.bytes();
            break;

          case 2:
            message.epoch = reader.uint32();
            break;

          case 3:
            message.revision = reader.uint32();
            break;

          case 4:
            message.removed = reader.bool();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    envelope: Uint8Array | null;
    epoch: u32;
    revision: u32;
    removed: bool;

    constructor(
      envelope: Uint8Array | null = null,
      epoch: u32 = 0,
      revision: u32 = 0,
      removed: bool = false
    ) {
      this.envelope = envelope;
      this.epoch = epoch;
      this.revision = revision;
      this.removed = removed;
    }
  }

  export class set_album_item_arguments {
    static encode(message: set_album_item_arguments, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      const unique_name_collection_id = message.collection_id;
      if (unique_name_collection_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_collection_id);
      }

      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_id);
      }

      if (message.epoch != 0) {
        writer.uint32(32);
        writer.uint32(message.epoch);
      }

      if (message.previous_revision != 0) {
        writer.uint32(40);
        writer.uint32(message.previous_revision);
      }

      const unique_name_envelope = message.envelope;
      if (unique_name_envelope !== null) {
        writer.uint32(50);
        writer.bytes(unique_name_envelope);
      }

      if (message.removed != false) {
        writer.uint32(56);
        writer.bool(message.removed);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(66);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): set_album_item_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_album_item_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.collection_id = reader.bytes();
            break;

          case 3:
            message.id = reader.bytes();
            break;

          case 4:
            message.epoch = reader.uint32();
            break;

          case 5:
            message.previous_revision = reader.uint32();
            break;

          case 6:
            message.envelope = reader.bytes();
            break;

          case 7:
            message.removed = reader.bool();
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

    owner: Uint8Array | null;
    collection_id: Uint8Array | null;
    id: Uint8Array | null;
    epoch: u32;
    previous_revision: u32;
    envelope: Uint8Array | null;
    removed: bool;
    device: Uint8Array | null;

    constructor(
      owner: Uint8Array | null = null,
      collection_id: Uint8Array | null = null,
      id: Uint8Array | null = null,
      epoch: u32 = 0,
      previous_revision: u32 = 0,
      envelope: Uint8Array | null = null,
      removed: bool = false,
      device: Uint8Array | null = null
    ) {
      this.owner = owner;
      this.collection_id = collection_id;
      this.id = id;
      this.epoch = epoch;
      this.previous_revision = previous_revision;
      this.envelope = envelope;
      this.removed = removed;
      this.device = device;
    }
  }

  @unmanaged
  export class set_album_item_result {
    static encode(message: set_album_item_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): set_album_item_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_album_item_result();

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

  export class get_album_item_arguments {
    static encode(message: get_album_item_arguments, writer: Writer): void {
      const unique_name_collection_id = message.collection_id;
      if (unique_name_collection_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_collection_id);
      }

      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_id);
      }
    }

    static decode(reader: Reader, length: i32): get_album_item_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_album_item_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.collection_id = reader.bytes();
            break;

          case 2:
            message.id = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    collection_id: Uint8Array | null;
    id: Uint8Array | null;

    constructor(
      collection_id: Uint8Array | null = null,
      id: Uint8Array | null = null
    ) {
      this.collection_id = collection_id;
      this.id = id;
    }
  }

  export class get_album_item_result {
    static encode(message: get_album_item_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        album_item_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_album_item_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_album_item_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = album_item_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: album_item_record | null;

    constructor(value: album_item_record | null = null) {
      this.value = value;
    }
  }

  export class album_item_changed_event {
    static encode(message: album_item_changed_event, writer: Writer): void {
      const unique_name_collection_id = message.collection_id;
      if (unique_name_collection_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_collection_id);
      }

      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_id);
      }

      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(26);
        writer.fork();
        album_item_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): album_item_changed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new album_item_changed_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.collection_id = reader.bytes();
            break;

          case 2:
            message.id = reader.bytes();
            break;

          case 3:
            message.value = album_item_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    collection_id: Uint8Array | null;
    id: Uint8Array | null;
    value: album_item_record | null;

    constructor(
      collection_id: Uint8Array | null = null,
      id: Uint8Array | null = null,
      value: album_item_record | null = null
    ) {
      this.collection_id = collection_id;
      this.id = id;
      this.value = value;
    }
  }

  export class music_config {
    static encode(message: music_config, writer: Writer): void {
      if (message.version != 0) {
        writer.uint32(8);
        writer.uint32(message.version);
      }

      if (message.revision != 0) {
        writer.uint32(16);
        writer.uint32(message.revision);
      }

      const unique_name_recipient = message.recipient;
      if (unique_name_recipient !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_recipient);
      }

      if (message.rate_per_mb != 0) {
        writer.uint32(32);
        writer.uint64(message.rate_per_mb);
      }

      if (message.max_bytes != 0) {
        writer.uint32(40);
        writer.uint32(message.max_bytes);
      }

      if (message.enabled != false) {
        writer.uint32(48);
        writer.bool(message.enabled);
      }

      const unique_name_native_token = message.native_token;
      if (unique_name_native_token !== null) {
        writer.uint32(58);
        writer.bytes(unique_name_native_token);
      }

      if (message.flat_fee != 0) {
        writer.uint32(64);
        writer.uint64(message.flat_fee);
      }

      if (message.clip_version != 0) {
        writer.uint32(72);
        writer.uint32(message.clip_version);
      }
    }

    static decode(reader: Reader, length: i32): music_config {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new music_config();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.version = reader.uint32();
            break;

          case 2:
            message.revision = reader.uint32();
            break;

          case 3:
            message.recipient = reader.bytes();
            break;

          case 4:
            message.rate_per_mb = reader.uint64();
            break;

          case 5:
            message.max_bytes = reader.uint32();
            break;

          case 6:
            message.enabled = reader.bool();
            break;

          case 7:
            message.native_token = reader.bytes();
            break;

          case 8:
            message.flat_fee = reader.uint64();
            break;

          case 9:
            message.clip_version = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    version: u32;
    revision: u32;
    recipient: Uint8Array | null;
    rate_per_mb: u64;
    max_bytes: u32;
    enabled: bool;
    native_token: Uint8Array | null;
    flat_fee: u64;
    clip_version: u32;

    constructor(
      version: u32 = 0,
      revision: u32 = 0,
      recipient: Uint8Array | null = null,
      rate_per_mb: u64 = 0,
      max_bytes: u32 = 0,
      enabled: bool = false,
      native_token: Uint8Array | null = null,
      flat_fee: u64 = 0,
      clip_version: u32 = 0
    ) {
      this.version = version;
      this.revision = revision;
      this.recipient = recipient;
      this.rate_per_mb = rate_per_mb;
      this.max_bytes = max_bytes;
      this.enabled = enabled;
      this.native_token = native_token;
      this.flat_fee = flat_fee;
      this.clip_version = clip_version;
    }
  }

  export class music_record {
    static encode(message: music_record, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      const unique_name_digest = message.digest;
      if (unique_name_digest !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_digest);
      }

      if (message.size != 0) {
        writer.uint32(24);
        writer.uint32(message.size);
      }

      const unique_name_chunk_hashes = message.chunk_hashes;
      if (unique_name_chunk_hashes.length !== 0) {
        for (let i = 0; i < unique_name_chunk_hashes.length; ++i) {
          writer.uint32(34);
          writer.bytes(unique_name_chunk_hashes[i]);
        }
      }

      if (message.received != 0) {
        writer.uint32(40);
        writer.uint32(message.received);
      }

      const unique_name_title = message.title;
      if (unique_name_title !== null) {
        writer.uint32(50);
        writer.string(unique_name_title);
      }

      const unique_name_mime = message.mime;
      if (unique_name_mime !== null) {
        writer.uint32(58);
        writer.string(unique_name_mime);
      }

      if (message.duration_ms != 0) {
        writer.uint32(64);
        writer.uint32(message.duration_ms);
      }

      if (message.fee != 0) {
        writer.uint32(72);
        writer.uint64(message.fee);
      }

      const unique_name_recipient = message.recipient;
      if (unique_name_recipient !== null) {
        writer.uint32(82);
        writer.bytes(unique_name_recipient);
      }

      const unique_name_payer = message.payer;
      if (unique_name_payer !== null) {
        writer.uint32(90);
        writer.bytes(unique_name_payer);
      }

      const unique_name_artist = message.artist;
      if (unique_name_artist !== null) {
        writer.uint32(98);
        writer.string(unique_name_artist);
      }

      const unique_name_description = message.description;
      if (unique_name_description !== null) {
        writer.uint32(106);
        writer.string(unique_name_description);
      }

      if (message.audience != 0) {
        writer.uint32(112);
        writer.uint32(message.audience);
      }

      const unique_name_group_id = message.group_id;
      if (unique_name_group_id !== null) {
        writer.uint32(122);
        writer.bytes(unique_name_group_id);
      }

      if (message.encrypted != false) {
        writer.uint32(128);
        writer.bool(message.encrypted);
      }

      const unique_name_nonce = message.nonce;
      if (unique_name_nonce !== null) {
        writer.uint32(138);
        writer.bytes(unique_name_nonce);
      }

      const unique_name_owner_key = message.owner_key;
      if (unique_name_owner_key !== null) {
        writer.uint32(146);
        writer.fork();
        music_key.encode(unique_name_owner_key, writer);
        writer.ldelim();
      }

      if (message.unlock_price != 0) {
        writer.uint32(152);
        writer.uint64(message.unlock_price);
      }

      if (message.version != 0) {
        writer.uint32(160);
        writer.uint32(message.version);
      }

      const unique_name_key_hash = message.key_hash;
      if (unique_name_key_hash !== null) {
        writer.uint32(170);
        writer.bytes(unique_name_key_hash);
      }

      const unique_name_cover = message.cover;
      if (unique_name_cover !== null) {
        writer.uint32(178);
        writer.fork();
        music_cover.encode(unique_name_cover, writer);
        writer.ldelim();
      }

      if (message.cover_revision != 0) {
        writer.uint32(184);
        writer.uint32(message.cover_revision);
      }

      if (message.clip_kind != 0) {
        writer.uint32(192);
        writer.uint32(message.clip_kind);
      }

      if (message.gzip_original_size != 0) {
        writer.uint32(200);
        writer.uint32(message.gzip_original_size);
      }
    }

    static decode(reader: Reader, length: i32): music_record {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new music_record();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.digest = reader.bytes();
            break;

          case 3:
            message.size = reader.uint32();
            break;

          case 4:
            message.chunk_hashes.push(reader.bytes());
            break;

          case 5:
            message.received = reader.uint32();
            break;

          case 6:
            message.title = reader.string();
            break;

          case 7:
            message.mime = reader.string();
            break;

          case 8:
            message.duration_ms = reader.uint32();
            break;

          case 9:
            message.fee = reader.uint64();
            break;

          case 10:
            message.recipient = reader.bytes();
            break;

          case 11:
            message.payer = reader.bytes();
            break;

          case 12:
            message.artist = reader.string();
            break;

          case 13:
            message.description = reader.string();
            break;

          case 14:
            message.audience = reader.uint32();
            break;

          case 15:
            message.group_id = reader.bytes();
            break;

          case 16:
            message.encrypted = reader.bool();
            break;

          case 17:
            message.nonce = reader.bytes();
            break;

          case 18:
            message.owner_key = music_key.decode(reader, reader.uint32());
            break;

          case 19:
            message.unlock_price = reader.uint64();
            break;

          case 20:
            message.version = reader.uint32();
            break;

          case 21:
            message.key_hash = reader.bytes();
            break;

          case 22:
            message.cover = music_cover.decode(reader, reader.uint32());
            break;

          case 23:
            message.cover_revision = reader.uint32();
            break;

          case 24:
            message.clip_kind = reader.uint32();
            break;

          case 25:
            message.gzip_original_size = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    owner: Uint8Array | null;
    digest: Uint8Array | null;
    size: u32;
    chunk_hashes: Array<Uint8Array>;
    received: u32;
    title: string | null;
    mime: string | null;
    duration_ms: u32;
    fee: u64;
    recipient: Uint8Array | null;
    payer: Uint8Array | null;
    artist: string | null;
    description: string | null;
    audience: u32;
    group_id: Uint8Array | null;
    encrypted: bool;
    nonce: Uint8Array | null;
    owner_key: music_key | null;
    unlock_price: u64;
    version: u32;
    key_hash: Uint8Array | null;
    cover: music_cover | null;
    cover_revision: u32;
    clip_kind: u32;
    gzip_original_size: u32;

    constructor(
      owner: Uint8Array | null = null,
      digest: Uint8Array | null = null,
      size: u32 = 0,
      chunk_hashes: Array<Uint8Array> = [],
      received: u32 = 0,
      title: string | null = null,
      mime: string | null = null,
      duration_ms: u32 = 0,
      fee: u64 = 0,
      recipient: Uint8Array | null = null,
      payer: Uint8Array | null = null,
      artist: string | null = null,
      description: string | null = null,
      audience: u32 = 0,
      group_id: Uint8Array | null = null,
      encrypted: bool = false,
      nonce: Uint8Array | null = null,
      owner_key: music_key | null = null,
      unlock_price: u64 = 0,
      version: u32 = 0,
      key_hash: Uint8Array | null = null,
      cover: music_cover | null = null,
      cover_revision: u32 = 0,
      clip_kind: u32 = 0,
      gzip_original_size: u32 = 0
    ) {
      this.owner = owner;
      this.digest = digest;
      this.size = size;
      this.chunk_hashes = chunk_hashes;
      this.received = received;
      this.title = title;
      this.mime = mime;
      this.duration_ms = duration_ms;
      this.fee = fee;
      this.recipient = recipient;
      this.payer = payer;
      this.artist = artist;
      this.description = description;
      this.audience = audience;
      this.group_id = group_id;
      this.encrypted = encrypted;
      this.nonce = nonce;
      this.owner_key = owner_key;
      this.unlock_price = unlock_price;
      this.version = version;
      this.key_hash = key_hash;
      this.cover = cover;
      this.cover_revision = cover_revision;
      this.clip_kind = clip_kind;
      this.gzip_original_size = gzip_original_size;
    }
  }

  export class music_cover {
    static encode(message: music_cover, writer: Writer): void {
      const unique_name_photo_id = message.photo_id;
      if (unique_name_photo_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_photo_id);
      }

      const unique_name_digest = message.digest;
      if (unique_name_digest !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_digest);
      }

      if (message.size != 0) {
        writer.uint32(24);
        writer.uint32(message.size);
      }

      const unique_name_mime = message.mime;
      if (unique_name_mime !== null) {
        writer.uint32(34);
        writer.string(unique_name_mime);
      }

      if (message.encrypted != false) {
        writer.uint32(40);
        writer.bool(message.encrypted);
      }

      const unique_name_nonce = message.nonce;
      if (unique_name_nonce !== null) {
        writer.uint32(50);
        writer.bytes(unique_name_nonce);
      }
    }

    static decode(reader: Reader, length: i32): music_cover {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new music_cover();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.photo_id = reader.bytes();
            break;

          case 2:
            message.digest = reader.bytes();
            break;

          case 3:
            message.size = reader.uint32();
            break;

          case 4:
            message.mime = reader.string();
            break;

          case 5:
            message.encrypted = reader.bool();
            break;

          case 6:
            message.nonce = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    photo_id: Uint8Array | null;
    digest: Uint8Array | null;
    size: u32;
    mime: string | null;
    encrypted: bool;
    nonce: Uint8Array | null;

    constructor(
      photo_id: Uint8Array | null = null,
      digest: Uint8Array | null = null,
      size: u32 = 0,
      mime: string | null = null,
      encrypted: bool = false,
      nonce: Uint8Array | null = null
    ) {
      this.photo_id = photo_id;
      this.digest = digest;
      this.size = size;
      this.mime = mime;
      this.encrypted = encrypted;
      this.nonce = nonce;
    }
  }

  @unmanaged
  export class get_music_art_version_arguments {
    static encode(
      message: get_music_art_version_arguments,
      writer: Writer
    ): void {}

    static decode(
      reader: Reader,
      length: i32
    ): get_music_art_version_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_music_art_version_arguments();

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
  export class get_music_art_version_result {
    static encode(message: get_music_art_version_result, writer: Writer): void {
      if (message.version != 0) {
        writer.uint32(8);
        writer.uint32(message.version);
      }
    }

    static decode(reader: Reader, length: i32): get_music_art_version_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_music_art_version_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.version = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    version: u32;

    constructor(version: u32 = 0) {
      this.version = version;
    }
  }

  export class set_music_cover_arguments {
    static encode(message: set_music_cover_arguments, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_id);
      }

      const unique_name_cover = message.cover;
      if (unique_name_cover !== null) {
        writer.uint32(26);
        writer.fork();
        music_cover.encode(unique_name_cover, writer);
        writer.ldelim();
      }

      if (message.expected_revision != 0) {
        writer.uint32(32);
        writer.uint32(message.expected_revision);
      }
    }

    static decode(reader: Reader, length: i32): set_music_cover_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_music_cover_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.id = reader.bytes();
            break;

          case 3:
            message.cover = music_cover.decode(reader, reader.uint32());
            break;

          case 4:
            message.expected_revision = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    owner: Uint8Array | null;
    id: Uint8Array | null;
    cover: music_cover | null;
    expected_revision: u32;

    constructor(
      owner: Uint8Array | null = null,
      id: Uint8Array | null = null,
      cover: music_cover | null = null,
      expected_revision: u32 = 0
    ) {
      this.owner = owner;
      this.id = id;
      this.cover = cover;
      this.expected_revision = expected_revision;
    }
  }

  @unmanaged
  export class set_music_cover_result {
    static encode(message: set_music_cover_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): set_music_cover_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_music_cover_result();

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

  export class music_cover_updated_event {
    static encode(message: music_cover_updated_event, writer: Writer): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }

      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_owner);
      }

      const unique_name_cover = message.cover;
      if (unique_name_cover !== null) {
        writer.uint32(26);
        writer.fork();
        music_cover.encode(unique_name_cover, writer);
        writer.ldelim();
      }

      if (message.revision != 0) {
        writer.uint32(32);
        writer.uint32(message.revision);
      }
    }

    static decode(reader: Reader, length: i32): music_cover_updated_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new music_cover_updated_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.bytes();
            break;

          case 2:
            message.owner = reader.bytes();
            break;

          case 3:
            message.cover = music_cover.decode(reader, reader.uint32());
            break;

          case 4:
            message.revision = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: Uint8Array | null;
    owner: Uint8Array | null;
    cover: music_cover | null;
    revision: u32;

    constructor(
      id: Uint8Array | null = null,
      owner: Uint8Array | null = null,
      cover: music_cover | null = null,
      revision: u32 = 0
    ) {
      this.id = id;
      this.owner = owner;
      this.cover = cover;
      this.revision = revision;
    }
  }

  export class set_music_config_arguments {
    static encode(message: set_music_config_arguments, writer: Writer): void {
      const unique_name_recipient = message.recipient;
      if (unique_name_recipient !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_recipient);
      }

      if (message.rate_per_mb != 0) {
        writer.uint32(16);
        writer.uint64(message.rate_per_mb);
      }

      if (message.max_bytes != 0) {
        writer.uint32(24);
        writer.uint32(message.max_bytes);
      }

      if (message.enabled != false) {
        writer.uint32(32);
        writer.bool(message.enabled);
      }

      if (message.flat_fee != 0) {
        writer.uint32(40);
        writer.uint64(message.flat_fee);
      }
    }

    static decode(reader: Reader, length: i32): set_music_config_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_music_config_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.recipient = reader.bytes();
            break;

          case 2:
            message.rate_per_mb = reader.uint64();
            break;

          case 3:
            message.max_bytes = reader.uint32();
            break;

          case 4:
            message.enabled = reader.bool();
            break;

          case 5:
            message.flat_fee = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    recipient: Uint8Array | null;
    rate_per_mb: u64;
    max_bytes: u32;
    enabled: bool;
    flat_fee: u64;

    constructor(
      recipient: Uint8Array | null = null,
      rate_per_mb: u64 = 0,
      max_bytes: u32 = 0,
      enabled: bool = false,
      flat_fee: u64 = 0
    ) {
      this.recipient = recipient;
      this.rate_per_mb = rate_per_mb;
      this.max_bytes = max_bytes;
      this.enabled = enabled;
      this.flat_fee = flat_fee;
    }
  }

  @unmanaged
  export class set_music_config_result {
    static encode(message: set_music_config_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): set_music_config_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_music_config_result();

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
  export class get_music_config_arguments {
    static encode(message: get_music_config_arguments, writer: Writer): void {}

    static decode(reader: Reader, length: i32): get_music_config_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_music_config_arguments();

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

  export class get_music_config_result {
    static encode(message: get_music_config_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        music_config.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_music_config_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_music_config_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = music_config.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: music_config | null;

    constructor(value: music_config | null = null) {
      this.value = value;
    }
  }

  export class begin_music_arguments {
    static encode(message: begin_music_arguments, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_id);
      }

      const unique_name_digest = message.digest;
      if (unique_name_digest !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_digest);
      }

      if (message.size != 0) {
        writer.uint32(32);
        writer.uint32(message.size);
      }

      const unique_name_chunk_hashes = message.chunk_hashes;
      if (unique_name_chunk_hashes.length !== 0) {
        for (let i = 0; i < unique_name_chunk_hashes.length; ++i) {
          writer.uint32(42);
          writer.bytes(unique_name_chunk_hashes[i]);
        }
      }

      const unique_name_title = message.title;
      if (unique_name_title !== null) {
        writer.uint32(50);
        writer.string(unique_name_title);
      }

      const unique_name_mime = message.mime;
      if (unique_name_mime !== null) {
        writer.uint32(58);
        writer.string(unique_name_mime);
      }

      if (message.duration_ms != 0) {
        writer.uint32(64);
        writer.uint32(message.duration_ms);
      }

      if (message.config_revision != 0) {
        writer.uint32(72);
        writer.uint32(message.config_revision);
      }

      if (message.max_fee != 0) {
        writer.uint32(80);
        writer.uint64(message.max_fee);
      }

      const unique_name_payer = message.payer;
      if (unique_name_payer !== null) {
        writer.uint32(90);
        writer.bytes(unique_name_payer);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(98);
        writer.bytes(unique_name_device);
      }

      const unique_name_artist = message.artist;
      if (unique_name_artist !== null) {
        writer.uint32(106);
        writer.string(unique_name_artist);
      }

      const unique_name_description = message.description;
      if (unique_name_description !== null) {
        writer.uint32(114);
        writer.string(unique_name_description);
      }

      if (message.audience != 0) {
        writer.uint32(120);
        writer.uint32(message.audience);
      }

      const unique_name_group_id = message.group_id;
      if (unique_name_group_id !== null) {
        writer.uint32(130);
        writer.bytes(unique_name_group_id);
      }

      if (message.encrypted != false) {
        writer.uint32(136);
        writer.bool(message.encrypted);
      }

      const unique_name_nonce = message.nonce;
      if (unique_name_nonce !== null) {
        writer.uint32(146);
        writer.bytes(unique_name_nonce);
      }

      const unique_name_owner_key = message.owner_key;
      if (unique_name_owner_key !== null) {
        writer.uint32(154);
        writer.fork();
        music_key.encode(unique_name_owner_key, writer);
        writer.ldelim();
      }

      if (message.unlock_price != 0) {
        writer.uint32(160);
        writer.uint64(message.unlock_price);
      }

      const unique_name_key_hash = message.key_hash;
      if (unique_name_key_hash !== null) {
        writer.uint32(170);
        writer.bytes(unique_name_key_hash);
      }

      const unique_name_cover = message.cover;
      if (unique_name_cover !== null) {
        writer.uint32(178);
        writer.fork();
        music_cover.encode(unique_name_cover, writer);
        writer.ldelim();
      }

      if (message.clip_kind != 0) {
        writer.uint32(184);
        writer.uint32(message.clip_kind);
      }

      if (message.gzip_original_size != 0) {
        writer.uint32(192);
        writer.uint32(message.gzip_original_size);
      }
    }

    static decode(reader: Reader, length: i32): begin_music_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new begin_music_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.id = reader.bytes();
            break;

          case 3:
            message.digest = reader.bytes();
            break;

          case 4:
            message.size = reader.uint32();
            break;

          case 5:
            message.chunk_hashes.push(reader.bytes());
            break;

          case 6:
            message.title = reader.string();
            break;

          case 7:
            message.mime = reader.string();
            break;

          case 8:
            message.duration_ms = reader.uint32();
            break;

          case 9:
            message.config_revision = reader.uint32();
            break;

          case 10:
            message.max_fee = reader.uint64();
            break;

          case 11:
            message.payer = reader.bytes();
            break;

          case 12:
            message.device = reader.bytes();
            break;

          case 13:
            message.artist = reader.string();
            break;

          case 14:
            message.description = reader.string();
            break;

          case 15:
            message.audience = reader.uint32();
            break;

          case 16:
            message.group_id = reader.bytes();
            break;

          case 17:
            message.encrypted = reader.bool();
            break;

          case 18:
            message.nonce = reader.bytes();
            break;

          case 19:
            message.owner_key = music_key.decode(reader, reader.uint32());
            break;

          case 20:
            message.unlock_price = reader.uint64();
            break;

          case 21:
            message.key_hash = reader.bytes();
            break;

          case 22:
            message.cover = music_cover.decode(reader, reader.uint32());
            break;

          case 23:
            message.clip_kind = reader.uint32();
            break;

          case 24:
            message.gzip_original_size = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    owner: Uint8Array | null;
    id: Uint8Array | null;
    digest: Uint8Array | null;
    size: u32;
    chunk_hashes: Array<Uint8Array>;
    title: string | null;
    mime: string | null;
    duration_ms: u32;
    config_revision: u32;
    max_fee: u64;
    payer: Uint8Array | null;
    device: Uint8Array | null;
    artist: string | null;
    description: string | null;
    audience: u32;
    group_id: Uint8Array | null;
    encrypted: bool;
    nonce: Uint8Array | null;
    owner_key: music_key | null;
    unlock_price: u64;
    key_hash: Uint8Array | null;
    cover: music_cover | null;
    clip_kind: u32;
    gzip_original_size: u32;

    constructor(
      owner: Uint8Array | null = null,
      id: Uint8Array | null = null,
      digest: Uint8Array | null = null,
      size: u32 = 0,
      chunk_hashes: Array<Uint8Array> = [],
      title: string | null = null,
      mime: string | null = null,
      duration_ms: u32 = 0,
      config_revision: u32 = 0,
      max_fee: u64 = 0,
      payer: Uint8Array | null = null,
      device: Uint8Array | null = null,
      artist: string | null = null,
      description: string | null = null,
      audience: u32 = 0,
      group_id: Uint8Array | null = null,
      encrypted: bool = false,
      nonce: Uint8Array | null = null,
      owner_key: music_key | null = null,
      unlock_price: u64 = 0,
      key_hash: Uint8Array | null = null,
      cover: music_cover | null = null,
      clip_kind: u32 = 0,
      gzip_original_size: u32 = 0
    ) {
      this.owner = owner;
      this.id = id;
      this.digest = digest;
      this.size = size;
      this.chunk_hashes = chunk_hashes;
      this.title = title;
      this.mime = mime;
      this.duration_ms = duration_ms;
      this.config_revision = config_revision;
      this.max_fee = max_fee;
      this.payer = payer;
      this.device = device;
      this.artist = artist;
      this.description = description;
      this.audience = audience;
      this.group_id = group_id;
      this.encrypted = encrypted;
      this.nonce = nonce;
      this.owner_key = owner_key;
      this.unlock_price = unlock_price;
      this.key_hash = key_hash;
      this.cover = cover;
      this.clip_kind = clip_kind;
      this.gzip_original_size = gzip_original_size;
    }
  }

  @unmanaged
  export class begin_music_result {
    static encode(message: begin_music_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): begin_music_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new begin_music_result();

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

  export class append_music_arguments {
    static encode(message: append_music_arguments, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_id);
      }

      if (message.index != 0) {
        writer.uint32(24);
        writer.uint32(message.index);
      }

      const unique_name_data = message.data;
      if (unique_name_data !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_data);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(42);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): append_music_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new append_music_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.id = reader.bytes();
            break;

          case 3:
            message.index = reader.uint32();
            break;

          case 4:
            message.data = reader.bytes();
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

    owner: Uint8Array | null;
    id: Uint8Array | null;
    index: u32;
    data: Uint8Array | null;
    device: Uint8Array | null;

    constructor(
      owner: Uint8Array | null = null,
      id: Uint8Array | null = null,
      index: u32 = 0,
      data: Uint8Array | null = null,
      device: Uint8Array | null = null
    ) {
      this.owner = owner;
      this.id = id;
      this.index = index;
      this.data = data;
      this.device = device;
    }
  }

  @unmanaged
  export class append_music_result {
    static encode(message: append_music_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): append_music_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new append_music_result();

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

  export class get_music_arguments {
    static encode(message: get_music_arguments, writer: Writer): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }
    }

    static decode(reader: Reader, length: i32): get_music_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_music_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: Uint8Array | null;

    constructor(id: Uint8Array | null = null) {
      this.id = id;
    }
  }

  export class get_music_result {
    static encode(message: get_music_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        music_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_music_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_music_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = music_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: music_record | null;

    constructor(value: music_record | null = null) {
      this.value = value;
    }
  }

  export class get_music_chunk_arguments {
    static encode(message: get_music_chunk_arguments, writer: Writer): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }

      if (message.index != 0) {
        writer.uint32(16);
        writer.uint32(message.index);
      }
    }

    static decode(reader: Reader, length: i32): get_music_chunk_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_music_chunk_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.bytes();
            break;

          case 2:
            message.index = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: Uint8Array | null;
    index: u32;

    constructor(id: Uint8Array | null = null, index: u32 = 0) {
      this.id = id;
      this.index = index;
    }
  }

  export class get_music_chunk_result {
    static encode(message: get_music_chunk_result, writer: Writer): void {
      const unique_name_data = message.data;
      if (unique_name_data !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_data);
      }
    }

    static decode(reader: Reader, length: i32): get_music_chunk_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_music_chunk_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.data = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    data: Uint8Array | null;

    constructor(data: Uint8Array | null = null) {
      this.data = data;
    }
  }

  export class get_music_chunks_arguments {
    static encode(message: get_music_chunks_arguments, writer: Writer): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }

      if (message.index != 0) {
        writer.uint32(16);
        writer.uint32(message.index);
      }

      if (message.count != 0) {
        writer.uint32(24);
        writer.uint32(message.count);
      }
    }

    static decode(reader: Reader, length: i32): get_music_chunks_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_music_chunks_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.bytes();
            break;

          case 2:
            message.index = reader.uint32();
            break;

          case 3:
            message.count = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: Uint8Array | null;
    index: u32;
    count: u32;

    constructor(id: Uint8Array | null = null, index: u32 = 0, count: u32 = 0) {
      this.id = id;
      this.index = index;
      this.count = count;
    }
  }

  export class get_music_chunks_result {
    static encode(message: get_music_chunks_result, writer: Writer): void {
      const unique_name_chunks = message.chunks;
      if (unique_name_chunks.length !== 0) {
        for (let i = 0; i < unique_name_chunks.length; ++i) {
          writer.uint32(10);
          writer.bytes(unique_name_chunks[i]);
        }
      }
    }

    static decode(reader: Reader, length: i32): get_music_chunks_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_music_chunks_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.chunks.push(reader.bytes());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    chunks: Array<Uint8Array>;

    constructor(chunks: Array<Uint8Array> = []) {
      this.chunks = chunks;
    }
  }

  export class list_music_arguments {
    static encode(message: list_music_arguments, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      const unique_name_after = message.after;
      if (unique_name_after !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_after);
      }

      const unique_name_group_id = message.group_id;
      if (unique_name_group_id !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_group_id);
      }
    }

    static decode(reader: Reader, length: i32): list_music_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new list_music_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.after = reader.bytes();
            break;

          case 3:
            message.group_id = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    owner: Uint8Array | null;
    after: Uint8Array | null;
    group_id: Uint8Array | null;

    constructor(
      owner: Uint8Array | null = null,
      after: Uint8Array | null = null,
      group_id: Uint8Array | null = null
    ) {
      this.owner = owner;
      this.after = after;
      this.group_id = group_id;
    }
  }

  export class list_music_result {
    static encode(message: list_music_result, writer: Writer): void {
      const unique_name_ids = message.ids;
      if (unique_name_ids.length !== 0) {
        for (let i = 0; i < unique_name_ids.length; ++i) {
          writer.uint32(10);
          writer.bytes(unique_name_ids[i]);
        }
      }
    }

    static decode(reader: Reader, length: i32): list_music_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new list_music_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.ids.push(reader.bytes());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    ids: Array<Uint8Array>;

    constructor(ids: Array<Uint8Array> = []) {
      this.ids = ids;
    }
  }

  export class clip_reserved_event {
    static encode(message: clip_reserved_event, writer: Writer): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }

      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(18);
        writer.fork();
        music_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): clip_reserved_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new clip_reserved_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.bytes();
            break;

          case 2:
            message.value = music_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: Uint8Array | null;
    value: music_record | null;

    constructor(
      id: Uint8Array | null = null,
      value: music_record | null = null
    ) {
      this.id = id;
      this.value = value;
    }
  }

  export class clip_completed_event {
    static encode(message: clip_completed_event, writer: Writer): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }

      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_owner);
      }
    }

    static decode(reader: Reader, length: i32): clip_completed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new clip_completed_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.bytes();
            break;

          case 2:
            message.owner = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: Uint8Array | null;
    owner: Uint8Array | null;

    constructor(id: Uint8Array | null = null, owner: Uint8Array | null = null) {
      this.id = id;
      this.owner = owner;
    }
  }

  export class music_paid_event {
    static encode(message: music_paid_event, writer: Writer): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }

      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(18);
        writer.fork();
        music_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): music_paid_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new music_paid_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.bytes();
            break;

          case 2:
            message.value = music_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: Uint8Array | null;
    value: music_record | null;

    constructor(
      id: Uint8Array | null = null,
      value: music_record | null = null
    ) {
      this.id = id;
      this.value = value;
    }
  }

  export class music_completed_event {
    static encode(message: music_completed_event, writer: Writer): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }

      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_owner);
      }
    }

    static decode(reader: Reader, length: i32): music_completed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new music_completed_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.bytes();
            break;

          case 2:
            message.owner = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: Uint8Array | null;
    owner: Uint8Array | null;

    constructor(id: Uint8Array | null = null, owner: Uint8Array | null = null) {
      this.id = id;
      this.owner = owner;
    }
  }

  export class music_native_approval {
    static encode(message: music_native_approval, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      const unique_name_spender = message.spender;
      if (unique_name_spender !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_spender);
      }

      if (message.value != 0) {
        writer.uint32(24);
        writer.uint64(message.value);
      }
    }

    static decode(reader: Reader, length: i32): music_native_approval {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new music_native_approval();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.spender = reader.bytes();
            break;

          case 3:
            message.value = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    owner: Uint8Array | null;
    spender: Uint8Array | null;
    value: u64;

    constructor(
      owner: Uint8Array | null = null,
      spender: Uint8Array | null = null,
      value: u64 = 0
    ) {
      this.owner = owner;
      this.spender = spender;
      this.value = value;
    }
  }

  export class music_key {
    static encode(message: music_key, writer: Writer): void {
      if (message.key_version != 0) {
        writer.uint32(8);
        writer.uint32(message.key_version);
      }

      const unique_name_ephemeral_public_key = message.ephemeral_public_key;
      if (unique_name_ephemeral_public_key !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_ephemeral_public_key);
      }

      const unique_name_nonce = message.nonce;
      if (unique_name_nonce !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_nonce);
      }

      const unique_name_ciphertext = message.ciphertext;
      if (unique_name_ciphertext !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_ciphertext);
      }
    }

    static decode(reader: Reader, length: i32): music_key {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new music_key();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.key_version = reader.uint32();
            break;

          case 2:
            message.ephemeral_public_key = reader.bytes();
            break;

          case 3:
            message.nonce = reader.bytes();
            break;

          case 4:
            message.ciphertext = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    key_version: u32;
    ephemeral_public_key: Uint8Array | null;
    nonce: Uint8Array | null;
    ciphertext: Uint8Array | null;

    constructor(
      key_version: u32 = 0,
      ephemeral_public_key: Uint8Array | null = null,
      nonce: Uint8Array | null = null,
      ciphertext: Uint8Array | null = null
    ) {
      this.key_version = key_version;
      this.ephemeral_public_key = ephemeral_public_key;
      this.nonce = nonce;
      this.ciphertext = ciphertext;
    }
  }

  @unmanaged
  export class music_progress {
    static encode(message: music_progress, writer: Writer): void {
      if (message.received != 0) {
        writer.uint32(8);
        writer.uint32(message.received);
      }
    }

    static decode(reader: Reader, length: i32): music_progress {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new music_progress();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.received = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    received: u32;

    constructor(received: u32 = 0) {
      this.received = received;
    }
  }

  export class append_music_batch_arguments {
    static encode(message: append_music_batch_arguments, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_id);
      }

      if (message.index != 0) {
        writer.uint32(24);
        writer.uint32(message.index);
      }

      const unique_name_chunks = message.chunks;
      if (unique_name_chunks.length !== 0) {
        for (let i = 0; i < unique_name_chunks.length; ++i) {
          writer.uint32(34);
          writer.bytes(unique_name_chunks[i]);
        }
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(42);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): append_music_batch_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new append_music_batch_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.id = reader.bytes();
            break;

          case 3:
            message.index = reader.uint32();
            break;

          case 4:
            message.chunks.push(reader.bytes());
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

    owner: Uint8Array | null;
    id: Uint8Array | null;
    index: u32;
    chunks: Array<Uint8Array>;
    device: Uint8Array | null;

    constructor(
      owner: Uint8Array | null = null,
      id: Uint8Array | null = null,
      index: u32 = 0,
      chunks: Array<Uint8Array> = [],
      device: Uint8Array | null = null
    ) {
      this.owner = owner;
      this.id = id;
      this.index = index;
      this.chunks = chunks;
      this.device = device;
    }
  }

  @unmanaged
  export class append_music_batch_result {
    static encode(message: append_music_batch_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): append_music_batch_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new append_music_batch_result();

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

  export class music_access {
    static encode(message: music_access, writer: Writer): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }

      const unique_name_buyer = message.buyer;
      if (unique_name_buyer !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_buyer);
      }

      if (message.amount != 0) {
        writer.uint32(24);
        writer.uint64(message.amount);
      }

      if (message.expires_at != 0) {
        writer.uint32(32);
        writer.uint64(message.expires_at);
      }

      if (message.status != 0) {
        writer.uint32(40);
        writer.uint32(message.status);
      }

      const unique_name_key = message.key;
      if (unique_name_key !== null) {
        writer.uint32(50);
        writer.fork();
        music_key.encode(unique_name_key, writer);
        writer.ldelim();
      }

      const unique_name_public_key = message.public_key;
      if (unique_name_public_key !== null) {
        writer.uint32(58);
        writer.bytes(unique_name_public_key);
      }

      if (message.key_version != 0) {
        writer.uint32(64);
        writer.uint32(message.key_version);
      }

      const unique_name_payment_id = message.payment_id;
      if (unique_name_payment_id !== null) {
        writer.uint32(74);
        writer.bytes(unique_name_payment_id);
      }
    }

    static decode(reader: Reader, length: i32): music_access {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new music_access();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.bytes();
            break;

          case 2:
            message.buyer = reader.bytes();
            break;

          case 3:
            message.amount = reader.uint64();
            break;

          case 4:
            message.expires_at = reader.uint64();
            break;

          case 5:
            message.status = reader.uint32();
            break;

          case 6:
            message.key = music_key.decode(reader, reader.uint32());
            break;

          case 7:
            message.public_key = reader.bytes();
            break;

          case 8:
            message.key_version = reader.uint32();
            break;

          case 9:
            message.payment_id = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: Uint8Array | null;
    buyer: Uint8Array | null;
    amount: u64;
    expires_at: u64;
    status: u32;
    key: music_key | null;
    public_key: Uint8Array | null;
    key_version: u32;
    payment_id: Uint8Array | null;

    constructor(
      id: Uint8Array | null = null,
      buyer: Uint8Array | null = null,
      amount: u64 = 0,
      expires_at: u64 = 0,
      status: u32 = 0,
      key: music_key | null = null,
      public_key: Uint8Array | null = null,
      key_version: u32 = 0,
      payment_id: Uint8Array | null = null
    ) {
      this.id = id;
      this.buyer = buyer;
      this.amount = amount;
      this.expires_at = expires_at;
      this.status = status;
      this.key = key;
      this.public_key = public_key;
      this.key_version = key_version;
      this.payment_id = payment_id;
    }
  }

  export class request_music_access_arguments {
    static encode(
      message: request_music_access_arguments,
      writer: Writer
    ): void {
      const unique_name_buyer = message.buyer;
      if (unique_name_buyer !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_buyer);
      }

      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_id);
      }

      if (message.max_price != 0) {
        writer.uint32(24);
        writer.uint64(message.max_price);
      }
    }

    static decode(reader: Reader, length: i32): request_music_access_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new request_music_access_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.buyer = reader.bytes();
            break;

          case 2:
            message.id = reader.bytes();
            break;

          case 3:
            message.max_price = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    buyer: Uint8Array | null;
    id: Uint8Array | null;
    max_price: u64;

    constructor(
      buyer: Uint8Array | null = null,
      id: Uint8Array | null = null,
      max_price: u64 = 0
    ) {
      this.buyer = buyer;
      this.id = id;
      this.max_price = max_price;
    }
  }

  @unmanaged
  export class request_music_access_result {
    static encode(message: request_music_access_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): request_music_access_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new request_music_access_result();

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

  export class grant_music_access_arguments {
    static encode(message: grant_music_access_arguments, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_id);
      }

      const unique_name_buyer = message.buyer;
      if (unique_name_buyer !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_buyer);
      }

      const unique_name_key = message.key;
      if (unique_name_key !== null) {
        writer.uint32(34);
        writer.fork();
        music_key.encode(unique_name_key, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): grant_music_access_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new grant_music_access_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.id = reader.bytes();
            break;

          case 3:
            message.buyer = reader.bytes();
            break;

          case 4:
            message.key = music_key.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    owner: Uint8Array | null;
    id: Uint8Array | null;
    buyer: Uint8Array | null;
    key: music_key | null;

    constructor(
      owner: Uint8Array | null = null,
      id: Uint8Array | null = null,
      buyer: Uint8Array | null = null,
      key: music_key | null = null
    ) {
      this.owner = owner;
      this.id = id;
      this.buyer = buyer;
      this.key = key;
    }
  }

  @unmanaged
  export class grant_music_access_result {
    static encode(message: grant_music_access_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): grant_music_access_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new grant_music_access_result();

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

  export class refund_music_access_arguments {
    static encode(
      message: refund_music_access_arguments,
      writer: Writer
    ): void {
      const unique_name_buyer = message.buyer;
      if (unique_name_buyer !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_buyer);
      }

      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_id);
      }
    }

    static decode(reader: Reader, length: i32): refund_music_access_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new refund_music_access_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.buyer = reader.bytes();
            break;

          case 2:
            message.id = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    buyer: Uint8Array | null;
    id: Uint8Array | null;

    constructor(buyer: Uint8Array | null = null, id: Uint8Array | null = null) {
      this.buyer = buyer;
      this.id = id;
    }
  }

  @unmanaged
  export class refund_music_access_result {
    static encode(message: refund_music_access_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): refund_music_access_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new refund_music_access_result();

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

  export class get_music_access_arguments {
    static encode(message: get_music_access_arguments, writer: Writer): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }

      const unique_name_buyer = message.buyer;
      if (unique_name_buyer !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_buyer);
      }
    }

    static decode(reader: Reader, length: i32): get_music_access_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_music_access_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.bytes();
            break;

          case 2:
            message.buyer = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: Uint8Array | null;
    buyer: Uint8Array | null;

    constructor(id: Uint8Array | null = null, buyer: Uint8Array | null = null) {
      this.id = id;
      this.buyer = buyer;
    }
  }

  export class get_music_access_result {
    static encode(message: get_music_access_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        music_access.encode(unique_name_value, writer);
        writer.ldelim();
      }

      if (message.eligible != false) {
        writer.uint32(16);
        writer.bool(message.eligible);
      }

      if (message.now != 0) {
        writer.uint32(24);
        writer.uint64(message.now);
      }
    }

    static decode(reader: Reader, length: i32): get_music_access_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_music_access_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = music_access.decode(reader, reader.uint32());
            break;

          case 2:
            message.eligible = reader.bool();
            break;

          case 3:
            message.now = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: music_access | null;
    eligible: bool;
    now: u64;

    constructor(
      value: music_access | null = null,
      eligible: bool = false,
      now: u64 = 0
    ) {
      this.value = value;
      this.eligible = eligible;
      this.now = now;
    }
  }

  export class list_music_requests_arguments {
    static encode(
      message: list_music_requests_arguments,
      writer: Writer
    ): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      const unique_name_after = message.after;
      if (unique_name_after !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_after);
      }
    }

    static decode(reader: Reader, length: i32): list_music_requests_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new list_music_requests_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.after = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    owner: Uint8Array | null;
    after: Uint8Array | null;

    constructor(
      owner: Uint8Array | null = null,
      after: Uint8Array | null = null
    ) {
      this.owner = owner;
      this.after = after;
    }
  }

  export class list_music_requests_result {
    static encode(message: list_music_requests_result, writer: Writer): void {
      const unique_name_items = message.items;
      for (let i = 0; i < unique_name_items.length; ++i) {
        writer.uint32(10);
        writer.fork();
        music_access.encode(unique_name_items[i], writer);
        writer.ldelim();
      }

      const unique_name_next = message.next;
      if (unique_name_next !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_next);
      }
    }

    static decode(reader: Reader, length: i32): list_music_requests_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new list_music_requests_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.items.push(music_access.decode(reader, reader.uint32()));
            break;

          case 2:
            message.next = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    items: Array<music_access>;
    next: Uint8Array | null;

    constructor(
      items: Array<music_access> = [],
      next: Uint8Array | null = null
    ) {
      this.items = items;
      this.next = next;
    }
  }

  export class music_access_event {
    static encode(message: music_access_event, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }

      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(18);
        writer.fork();
        music_access.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): music_access_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new music_access_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          case 2:
            message.value = music_access.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    owner: Uint8Array | null;
    value: music_access | null;

    constructor(
      owner: Uint8Array | null = null,
      value: music_access | null = null
    ) {
      this.owner = owner;
      this.value = value;
    }
  }

  export class music_comment {
    static encode(message: music_comment, writer: Writer): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }

      const unique_name_author = message.author;
      if (unique_name_author !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_author);
      }

      const unique_name_body = message.body;
      if (unique_name_body !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_body);
      }

      const unique_name_nonce = message.nonce;
      if (unique_name_nonce !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_nonce);
      }

      const unique_name_reply_to = message.reply_to;
      if (unique_name_reply_to !== null) {
        writer.uint32(42);
        writer.bytes(unique_name_reply_to);
      }

      if (message.created_at != 0) {
        writer.uint32(48);
        writer.uint64(message.created_at);
      }

      if (message.deleted != false) {
        writer.uint32(56);
        writer.bool(message.deleted);
      }
    }

    static decode(reader: Reader, length: i32): music_comment {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new music_comment();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.bytes();
            break;

          case 2:
            message.author = reader.bytes();
            break;

          case 3:
            message.body = reader.bytes();
            break;

          case 4:
            message.nonce = reader.bytes();
            break;

          case 5:
            message.reply_to = reader.bytes();
            break;

          case 6:
            message.created_at = reader.uint64();
            break;

          case 7:
            message.deleted = reader.bool();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: Uint8Array | null;
    author: Uint8Array | null;
    body: Uint8Array | null;
    nonce: Uint8Array | null;
    reply_to: Uint8Array | null;
    created_at: u64;
    deleted: bool;

    constructor(
      id: Uint8Array | null = null,
      author: Uint8Array | null = null,
      body: Uint8Array | null = null,
      nonce: Uint8Array | null = null,
      reply_to: Uint8Array | null = null,
      created_at: u64 = 0,
      deleted: bool = false
    ) {
      this.id = id;
      this.author = author;
      this.body = body;
      this.nonce = nonce;
      this.reply_to = reply_to;
      this.created_at = created_at;
      this.deleted = deleted;
    }
  }

  export class comment_music_arguments {
    static encode(message: comment_music_arguments, writer: Writer): void {
      const unique_name_author = message.author;
      if (unique_name_author !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_author);
      }

      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_id);
      }

      const unique_name_comment_id = message.comment_id;
      if (unique_name_comment_id !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_comment_id);
      }

      const unique_name_body = message.body;
      if (unique_name_body !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_body);
      }

      const unique_name_nonce = message.nonce;
      if (unique_name_nonce !== null) {
        writer.uint32(42);
        writer.bytes(unique_name_nonce);
      }

      const unique_name_reply_to = message.reply_to;
      if (unique_name_reply_to !== null) {
        writer.uint32(50);
        writer.bytes(unique_name_reply_to);
      }
    }

    static decode(reader: Reader, length: i32): comment_music_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new comment_music_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.author = reader.bytes();
            break;

          case 2:
            message.id = reader.bytes();
            break;

          case 3:
            message.comment_id = reader.bytes();
            break;

          case 4:
            message.body = reader.bytes();
            break;

          case 5:
            message.nonce = reader.bytes();
            break;

          case 6:
            message.reply_to = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    author: Uint8Array | null;
    id: Uint8Array | null;
    comment_id: Uint8Array | null;
    body: Uint8Array | null;
    nonce: Uint8Array | null;
    reply_to: Uint8Array | null;

    constructor(
      author: Uint8Array | null = null,
      id: Uint8Array | null = null,
      comment_id: Uint8Array | null = null,
      body: Uint8Array | null = null,
      nonce: Uint8Array | null = null,
      reply_to: Uint8Array | null = null
    ) {
      this.author = author;
      this.id = id;
      this.comment_id = comment_id;
      this.body = body;
      this.nonce = nonce;
      this.reply_to = reply_to;
    }
  }

  @unmanaged
  export class comment_music_result {
    static encode(message: comment_music_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): comment_music_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new comment_music_result();

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

  export class delete_music_comment_arguments {
    static encode(
      message: delete_music_comment_arguments,
      writer: Writer
    ): void {
      const unique_name_author = message.author;
      if (unique_name_author !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_author);
      }

      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_id);
      }

      const unique_name_comment_id = message.comment_id;
      if (unique_name_comment_id !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_comment_id);
      }
    }

    static decode(reader: Reader, length: i32): delete_music_comment_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new delete_music_comment_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.author = reader.bytes();
            break;

          case 2:
            message.id = reader.bytes();
            break;

          case 3:
            message.comment_id = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    author: Uint8Array | null;
    id: Uint8Array | null;
    comment_id: Uint8Array | null;

    constructor(
      author: Uint8Array | null = null,
      id: Uint8Array | null = null,
      comment_id: Uint8Array | null = null
    ) {
      this.author = author;
      this.id = id;
      this.comment_id = comment_id;
    }
  }

  @unmanaged
  export class delete_music_comment_result {
    static encode(message: delete_music_comment_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): delete_music_comment_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new delete_music_comment_result();

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

  export class list_music_comments_arguments {
    static encode(
      message: list_music_comments_arguments,
      writer: Writer
    ): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }

      const unique_name_after = message.after;
      if (unique_name_after !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_after);
      }
    }

    static decode(reader: Reader, length: i32): list_music_comments_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new list_music_comments_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.bytes();
            break;

          case 2:
            message.after = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: Uint8Array | null;
    after: Uint8Array | null;

    constructor(id: Uint8Array | null = null, after: Uint8Array | null = null) {
      this.id = id;
      this.after = after;
    }
  }

  export class list_music_comments_result {
    static encode(message: list_music_comments_result, writer: Writer): void {
      const unique_name_items = message.items;
      for (let i = 0; i < unique_name_items.length; ++i) {
        writer.uint32(10);
        writer.fork();
        music_comment.encode(unique_name_items[i], writer);
        writer.ldelim();
      }

      const unique_name_next = message.next;
      if (unique_name_next !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_next);
      }
    }

    static decode(reader: Reader, length: i32): list_music_comments_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new list_music_comments_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.items.push(music_comment.decode(reader, reader.uint32()));
            break;

          case 2:
            message.next = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    items: Array<music_comment>;
    next: Uint8Array | null;

    constructor(
      items: Array<music_comment> = [],
      next: Uint8Array | null = null
    ) {
      this.items = items;
      this.next = next;
    }
  }

  export class music_comment_event {
    static encode(message: music_comment_event, writer: Writer): void {
      const unique_name_track_id = message.track_id;
      if (unique_name_track_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_track_id);
      }

      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(18);
        writer.fork();
        music_comment.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): music_comment_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new music_comment_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.track_id = reader.bytes();
            break;

          case 2:
            message.value = music_comment.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    track_id: Uint8Array | null;
    value: music_comment | null;

    constructor(
      track_id: Uint8Array | null = null,
      value: music_comment | null = null
    ) {
      this.track_id = track_id;
      this.value = value;
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
