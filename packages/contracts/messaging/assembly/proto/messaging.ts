import { Writer, Reader } from "as-proto";

export namespace messaging {
  export class conversation_record {
    static encode(message: conversation_record, writer: Writer): void {
      const unique_name_a = message.a;
      if (unique_name_a !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_a);
      }

      const unique_name_b = message.b;
      if (unique_name_b !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_b);
      }

      const unique_name_requester = message.requester;
      if (unique_name_requester !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_requester);
      }

      if (message.status != 0) {
        writer.uint32(32);
        writer.uint32(message.status);
      }

      if (message.generation != 0) {
        writer.uint32(40);
        writer.uint64(message.generation);
      }

      if (message.sequence != 0) {
        writer.uint32(48);
        writer.uint64(message.sequence);
      }

      if (message.updated_at != 0) {
        writer.uint32(56);
        writer.uint64(message.updated_at);
      }

      if (message.block != 0) {
        writer.uint32(64);
        writer.uint64(message.block);
      }
    }

    static decode(reader: Reader, length: i32): conversation_record {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new conversation_record();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.a = reader.bytes();
            break;

          case 2:
            message.b = reader.bytes();
            break;

          case 3:
            message.requester = reader.bytes();
            break;

          case 4:
            message.status = reader.uint32();
            break;

          case 5:
            message.generation = reader.uint64();
            break;

          case 6:
            message.sequence = reader.uint64();
            break;

          case 7:
            message.updated_at = reader.uint64();
            break;

          case 8:
            message.block = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    a: Uint8Array | null;
    b: Uint8Array | null;
    requester: Uint8Array | null;
    status: u32;
    generation: u64;
    sequence: u64;
    updated_at: u64;
    block: u64;

    constructor(
      a: Uint8Array | null = null,
      b: Uint8Array | null = null,
      requester: Uint8Array | null = null,
      status: u32 = 0,
      generation: u64 = 0,
      sequence: u64 = 0,
      updated_at: u64 = 0,
      block: u64 = 0
    ) {
      this.a = a;
      this.b = b;
      this.requester = requester;
      this.status = status;
      this.generation = generation;
      this.sequence = sequence;
      this.updated_at = updated_at;
      this.block = block;
    }
  }

  export class message_record {
    static encode(message: message_record, writer: Writer): void {
      const unique_name_sender = message.sender;
      if (unique_name_sender !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_sender);
      }

      const unique_name_recipient = message.recipient;
      if (unique_name_recipient !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_recipient);
      }

      const unique_name_message_id = message.message_id;
      if (unique_name_message_id !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_message_id);
      }

      const unique_name_content_hash = message.content_hash;
      if (unique_name_content_hash !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_content_hash);
      }

      if (message.generation != 0) {
        writer.uint32(40);
        writer.uint64(message.generation);
      }

      if (message.sequence != 0) {
        writer.uint32(48);
        writer.uint64(message.sequence);
      }

      if (message.timestamp != 0) {
        writer.uint32(56);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): message_record {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new message_record();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.sender = reader.bytes();
            break;

          case 2:
            message.recipient = reader.bytes();
            break;

          case 3:
            message.message_id = reader.bytes();
            break;

          case 4:
            message.content_hash = reader.bytes();
            break;

          case 5:
            message.generation = reader.uint64();
            break;

          case 6:
            message.sequence = reader.uint64();
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

    sender: Uint8Array | null;
    recipient: Uint8Array | null;
    message_id: Uint8Array | null;
    content_hash: Uint8Array | null;
    generation: u64;
    sequence: u64;
    timestamp: u64;

    constructor(
      sender: Uint8Array | null = null,
      recipient: Uint8Array | null = null,
      message_id: Uint8Array | null = null,
      content_hash: Uint8Array | null = null,
      generation: u64 = 0,
      sequence: u64 = 0,
      timestamp: u64 = 0
    ) {
      this.sender = sender;
      this.recipient = recipient;
      this.message_id = message_id;
      this.content_hash = content_hash;
      this.generation = generation;
      this.sequence = sequence;
      this.timestamp = timestamp;
    }
  }

  export class set_dependencies_arguments {
    static encode(message: set_dependencies_arguments, writer: Writer): void {
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

      const unique_name_token = message.token;
      if (unique_name_token !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_token);
      }
    }

    static decode(reader: Reader, length: i32): set_dependencies_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_dependencies_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.identity = reader.bytes();
            break;

          case 2:
            message.relationships = reader.bytes();
            break;

          case 3:
            message.token = reader.bytes();
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
    token: Uint8Array | null;

    constructor(
      identity: Uint8Array | null = null,
      relationships: Uint8Array | null = null,
      token: Uint8Array | null = null
    ) {
      this.identity = identity;
      this.relationships = relationships;
      this.token = token;
    }
  }

  @unmanaged
  export class set_dependencies_result {
    static encode(message: set_dependencies_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): set_dependencies_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_dependencies_result();

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

      const unique_name_token = message.token;
      if (unique_name_token !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_token);
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

          case 3:
            message.token = reader.bytes();
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
    token: Uint8Array | null;

    constructor(
      identity: Uint8Array | null = null,
      relationships: Uint8Array | null = null,
      token: Uint8Array | null = null
    ) {
      this.identity = identity;
      this.relationships = relationships;
      this.token = token;
    }
  }

  export class request_conversation_arguments {
    static encode(
      message: request_conversation_arguments,
      writer: Writer
    ): void {
      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_peer = message.peer;
      if (unique_name_peer !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_peer);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_device);
      }

      if (message.generation != 0) {
        writer.uint32(32);
        writer.uint64(message.generation);
      }
    }

    static decode(reader: Reader, length: i32): request_conversation_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new request_conversation_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
            message.peer = reader.bytes();
            break;

          case 3:
            message.device = reader.bytes();
            break;

          case 4:
            message.generation = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    actor: Uint8Array | null;
    peer: Uint8Array | null;
    device: Uint8Array | null;
    generation: u64;

    constructor(
      actor: Uint8Array | null = null,
      peer: Uint8Array | null = null,
      device: Uint8Array | null = null,
      generation: u64 = 0
    ) {
      this.actor = actor;
      this.peer = peer;
      this.device = device;
      this.generation = generation;
    }
  }

  @unmanaged
  export class request_conversation_result {
    static encode(message: request_conversation_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): request_conversation_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new request_conversation_result();

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

  export class accept_conversation_arguments {
    static encode(
      message: accept_conversation_arguments,
      writer: Writer
    ): void {
      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_peer = message.peer;
      if (unique_name_peer !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_peer);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_device);
      }

      if (message.generation != 0) {
        writer.uint32(32);
        writer.uint64(message.generation);
      }
    }

    static decode(reader: Reader, length: i32): accept_conversation_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new accept_conversation_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
            message.peer = reader.bytes();
            break;

          case 3:
            message.device = reader.bytes();
            break;

          case 4:
            message.generation = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    actor: Uint8Array | null;
    peer: Uint8Array | null;
    device: Uint8Array | null;
    generation: u64;

    constructor(
      actor: Uint8Array | null = null,
      peer: Uint8Array | null = null,
      device: Uint8Array | null = null,
      generation: u64 = 0
    ) {
      this.actor = actor;
      this.peer = peer;
      this.device = device;
      this.generation = generation;
    }
  }

  @unmanaged
  export class accept_conversation_result {
    static encode(message: accept_conversation_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): accept_conversation_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new accept_conversation_result();

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

  export class close_conversation_arguments {
    static encode(message: close_conversation_arguments, writer: Writer): void {
      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_peer = message.peer;
      if (unique_name_peer !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_peer);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_device);
      }

      if (message.generation != 0) {
        writer.uint32(32);
        writer.uint64(message.generation);
      }
    }

    static decode(reader: Reader, length: i32): close_conversation_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new close_conversation_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
            message.peer = reader.bytes();
            break;

          case 3:
            message.device = reader.bytes();
            break;

          case 4:
            message.generation = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    actor: Uint8Array | null;
    peer: Uint8Array | null;
    device: Uint8Array | null;
    generation: u64;

    constructor(
      actor: Uint8Array | null = null,
      peer: Uint8Array | null = null,
      device: Uint8Array | null = null,
      generation: u64 = 0
    ) {
      this.actor = actor;
      this.peer = peer;
      this.device = device;
      this.generation = generation;
    }
  }

  @unmanaged
  export class close_conversation_result {
    static encode(message: close_conversation_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): close_conversation_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new close_conversation_result();

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

  export class send_message_arguments {
    static encode(message: send_message_arguments, writer: Writer): void {
      const unique_name_sender = message.sender;
      if (unique_name_sender !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_sender);
      }

      const unique_name_recipient = message.recipient;
      if (unique_name_recipient !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_recipient);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_device);
      }

      const unique_name_message_id = message.message_id;
      if (unique_name_message_id !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_message_id);
      }

      if (message.generation != 0) {
        writer.uint32(40);
        writer.uint64(message.generation);
      }

      const unique_name_envelope = message.envelope;
      if (unique_name_envelope !== null) {
        writer.uint32(50);
        writer.bytes(unique_name_envelope);
      }
    }

    static decode(reader: Reader, length: i32): send_message_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new send_message_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.sender = reader.bytes();
            break;

          case 2:
            message.recipient = reader.bytes();
            break;

          case 3:
            message.device = reader.bytes();
            break;

          case 4:
            message.message_id = reader.bytes();
            break;

          case 5:
            message.generation = reader.uint64();
            break;

          case 6:
            message.envelope = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    sender: Uint8Array | null;
    recipient: Uint8Array | null;
    device: Uint8Array | null;
    message_id: Uint8Array | null;
    generation: u64;
    envelope: Uint8Array | null;

    constructor(
      sender: Uint8Array | null = null,
      recipient: Uint8Array | null = null,
      device: Uint8Array | null = null,
      message_id: Uint8Array | null = null,
      generation: u64 = 0,
      envelope: Uint8Array | null = null
    ) {
      this.sender = sender;
      this.recipient = recipient;
      this.device = device;
      this.message_id = message_id;
      this.generation = generation;
      this.envelope = envelope;
    }
  }

  export class send_message_result {
    static encode(message: send_message_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        message_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): send_message_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new send_message_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = message_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: message_record | null;

    constructor(value: message_record | null = null) {
      this.value = value;
    }
  }

  export class get_conversation_arguments {
    static encode(message: get_conversation_arguments, writer: Writer): void {
      const unique_name_a = message.a;
      if (unique_name_a !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_a);
      }

      const unique_name_b = message.b;
      if (unique_name_b !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_b);
      }
    }

    static decode(reader: Reader, length: i32): get_conversation_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_conversation_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.a = reader.bytes();
            break;

          case 2:
            message.b = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    a: Uint8Array | null;
    b: Uint8Array | null;

    constructor(a: Uint8Array | null = null, b: Uint8Array | null = null) {
      this.a = a;
      this.b = b;
    }
  }

  export class get_conversation_result {
    static encode(message: get_conversation_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        conversation_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_conversation_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_conversation_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = conversation_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: conversation_record | null;

    constructor(value: conversation_record | null = null) {
      this.value = value;
    }
  }

  export class get_message_arguments {
    static encode(message: get_message_arguments, writer: Writer): void {
      const unique_name_sender = message.sender;
      if (unique_name_sender !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_sender);
      }

      const unique_name_message_id = message.message_id;
      if (unique_name_message_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_message_id);
      }
    }

    static decode(reader: Reader, length: i32): get_message_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_message_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.sender = reader.bytes();
            break;

          case 2:
            message.message_id = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    sender: Uint8Array | null;
    message_id: Uint8Array | null;

    constructor(
      sender: Uint8Array | null = null,
      message_id: Uint8Array | null = null
    ) {
      this.sender = sender;
      this.message_id = message_id;
    }
  }

  export class get_message_result {
    static encode(message: get_message_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        message_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_message_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_message_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = message_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: message_record | null;

    constructor(value: message_record | null = null) {
      this.value = value;
    }
  }

  export class conversation_changed_event {
    static encode(message: conversation_changed_event, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        conversation_record.encode(unique_name_value, writer);
        writer.ldelim();
      }

      if (message.timestamp != 0) {
        writer.uint32(16);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): conversation_changed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new conversation_changed_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = conversation_record.decode(reader, reader.uint32());
            break;

          case 2:
            message.timestamp = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: conversation_record | null;
    timestamp: u64;

    constructor(value: conversation_record | null = null, timestamp: u64 = 0) {
      this.value = value;
      this.timestamp = timestamp;
    }
  }

  export class message_sent_event {
    static encode(message: message_sent_event, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        message_record.encode(unique_name_value, writer);
        writer.ldelim();
      }

      const unique_name_envelope = message.envelope;
      if (unique_name_envelope !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_envelope);
      }

      if (message.timestamp != 0) {
        writer.uint32(24);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): message_sent_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new message_sent_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = message_record.decode(reader, reader.uint32());
            break;

          case 2:
            message.envelope = reader.bytes();
            break;

          case 3:
            message.timestamp = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: message_record | null;
    envelope: Uint8Array | null;
    timestamp: u64;

    constructor(
      value: message_record | null = null,
      envelope: Uint8Array | null = null,
      timestamp: u64 = 0
    ) {
      this.value = value;
      this.envelope = envelope;
      this.timestamp = timestamp;
    }
  }

  export class private_device {
    static encode(message: private_device, writer: Writer): void {
      const unique_name_device_id = message.device_id;
      if (unique_name_device_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_device_id);
      }

      const unique_name_delivery_key = message.delivery_key;
      if (unique_name_delivery_key !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_delivery_key);
      }

      const unique_name_label = message.label;
      if (unique_name_label !== null) {
        writer.uint32(26);
        writer.string(unique_name_label);
      }

      if (message.updated_at != 0) {
        writer.uint32(32);
        writer.uint64(message.updated_at);
      }
    }

    static decode(reader: Reader, length: i32): private_device {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new private_device();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.device_id = reader.bytes();
            break;

          case 2:
            message.delivery_key = reader.bytes();
            break;

          case 3:
            message.label = reader.string();
            break;

          case 4:
            message.updated_at = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    device_id: Uint8Array | null;
    delivery_key: Uint8Array | null;
    label: string | null;
    updated_at: u64;

    constructor(
      device_id: Uint8Array | null = null,
      delivery_key: Uint8Array | null = null,
      label: string | null = null,
      updated_at: u64 = 0
    ) {
      this.device_id = device_id;
      this.delivery_key = delivery_key;
      this.label = label;
      this.updated_at = updated_at;
    }
  }

  export class set_private_device_arguments {
    static encode(message: set_private_device_arguments, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_device_id = message.device_id;
      if (unique_name_device_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_device_id);
      }

      const unique_name_delivery_key = message.delivery_key;
      if (unique_name_delivery_key !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_delivery_key);
      }

      const unique_name_label = message.label;
      if (unique_name_label !== null) {
        writer.uint32(34);
        writer.string(unique_name_label);
      }
    }

    static decode(reader: Reader, length: i32): set_private_device_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_private_device_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.device_id = reader.bytes();
            break;

          case 3:
            message.delivery_key = reader.bytes();
            break;

          case 4:
            message.label = reader.string();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    account: Uint8Array | null;
    device_id: Uint8Array | null;
    delivery_key: Uint8Array | null;
    label: string | null;

    constructor(
      account: Uint8Array | null = null,
      device_id: Uint8Array | null = null,
      delivery_key: Uint8Array | null = null,
      label: string | null = null
    ) {
      this.account = account;
      this.device_id = device_id;
      this.delivery_key = delivery_key;
      this.label = label;
    }
  }

  @unmanaged
  export class set_private_device_result {
    static encode(message: set_private_device_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): set_private_device_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_private_device_result();

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

  export class get_private_devices_arguments {
    static encode(
      message: get_private_devices_arguments,
      writer: Writer
    ): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }
    }

    static decode(reader: Reader, length: i32): get_private_devices_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_private_devices_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    account: Uint8Array | null;

    constructor(account: Uint8Array | null = null) {
      this.account = account;
    }
  }

  export class get_private_devices_result {
    static encode(message: get_private_devices_result, writer: Writer): void {
      const unique_name_values = message.values;
      for (let i = 0; i < unique_name_values.length; ++i) {
        writer.uint32(10);
        writer.fork();
        private_device.encode(unique_name_values[i], writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_private_devices_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_private_devices_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.values.push(private_device.decode(reader, reader.uint32()));
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    values: Array<private_device>;

    constructor(values: Array<private_device> = []) {
      this.values = values;
    }
  }

  export class private_reservation {
    static encode(message: private_reservation, writer: Writer): void {
      if (message.block != 0) {
        writer.uint32(40);
        writer.uint64(message.block);
      }

      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_sponsor = message.sponsor;
      if (unique_name_sponsor !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_sponsor);
      }

      const unique_name_reservation_id = message.reservation_id;
      if (unique_name_reservation_id !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_reservation_id);
      }

      if (message.units != 0) {
        writer.uint32(32);
        writer.uint32(message.units);
      }
    }

    static decode(reader: Reader, length: i32): private_reservation {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new private_reservation();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 5:
            message.block = reader.uint64();
            break;

          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.sponsor = reader.bytes();
            break;

          case 3:
            message.reservation_id = reader.bytes();
            break;

          case 4:
            message.units = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    block: u64;
    account: Uint8Array | null;
    sponsor: Uint8Array | null;
    reservation_id: Uint8Array | null;
    units: u32;

    constructor(
      block: u64 = 0,
      account: Uint8Array | null = null,
      sponsor: Uint8Array | null = null,
      reservation_id: Uint8Array | null = null,
      units: u32 = 0
    ) {
      this.block = block;
      this.account = account;
      this.sponsor = sponsor;
      this.reservation_id = reservation_id;
      this.units = units;
    }
  }

  export class reserve_private_usage_arguments {
    static encode(
      message: reserve_private_usage_arguments,
      writer: Writer
    ): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_sponsor = message.sponsor;
      if (unique_name_sponsor !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_sponsor);
      }

      const unique_name_reservation_id = message.reservation_id;
      if (unique_name_reservation_id !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_reservation_id);
      }

      if (message.units != 0) {
        writer.uint32(32);
        writer.uint32(message.units);
      }
    }

    static decode(
      reader: Reader,
      length: i32
    ): reserve_private_usage_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new reserve_private_usage_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.sponsor = reader.bytes();
            break;

          case 3:
            message.reservation_id = reader.bytes();
            break;

          case 4:
            message.units = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    account: Uint8Array | null;
    sponsor: Uint8Array | null;
    reservation_id: Uint8Array | null;
    units: u32;

    constructor(
      account: Uint8Array | null = null,
      sponsor: Uint8Array | null = null,
      reservation_id: Uint8Array | null = null,
      units: u32 = 0
    ) {
      this.account = account;
      this.sponsor = sponsor;
      this.reservation_id = reservation_id;
      this.units = units;
    }
  }

  @unmanaged
  export class reserve_private_usage_result {
    static encode(
      message: reserve_private_usage_result,
      writer: Writer
    ): void {}

    static decode(reader: Reader, length: i32): reserve_private_usage_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new reserve_private_usage_result();

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

  export class get_private_reservation_arguments {
    static encode(
      message: get_private_reservation_arguments,
      writer: Writer
    ): void {
      const unique_name_reservation_id = message.reservation_id;
      if (unique_name_reservation_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_reservation_id);
      }
    }

    static decode(
      reader: Reader,
      length: i32
    ): get_private_reservation_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_private_reservation_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.reservation_id = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    reservation_id: Uint8Array | null;

    constructor(reservation_id: Uint8Array | null = null) {
      this.reservation_id = reservation_id;
    }
  }

  export class get_private_reservation_result {
    static encode(
      message: get_private_reservation_result,
      writer: Writer
    ): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        private_reservation.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_private_reservation_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_private_reservation_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = private_reservation.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: private_reservation | null;

    constructor(value: private_reservation | null = null) {
      this.value = value;
    }
  }

  @unmanaged
  export class private_units {
    static encode(message: private_units, writer: Writer): void {
      if (message.units != 0) {
        writer.uint32(8);
        writer.uint64(message.units);
      }
    }

    static decode(reader: Reader, length: i32): private_units {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new private_units();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.units = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    units: u64;

    constructor(units: u64 = 0) {
      this.units = units;
    }
  }

  export class private_grant {
    static encode(message: private_grant, writer: Writer): void {
      const unique_name_sponsor = message.sponsor;
      if (unique_name_sponsor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_sponsor);
      }

      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_actor);
      }

      const unique_name_grant_id = message.grant_id;
      if (unique_name_grant_id !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_grant_id);
      }

      if (message.units != 0) {
        writer.uint32(32);
        writer.uint32(message.units);
      }
    }

    static decode(reader: Reader, length: i32): private_grant {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new private_grant();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.sponsor = reader.bytes();
            break;

          case 2:
            message.actor = reader.bytes();
            break;

          case 3:
            message.grant_id = reader.bytes();
            break;

          case 4:
            message.units = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    sponsor: Uint8Array | null;
    actor: Uint8Array | null;
    grant_id: Uint8Array | null;
    units: u32;

    constructor(
      sponsor: Uint8Array | null = null,
      actor: Uint8Array | null = null,
      grant_id: Uint8Array | null = null,
      units: u32 = 0
    ) {
      this.sponsor = sponsor;
      this.actor = actor;
      this.grant_id = grant_id;
      this.units = units;
    }
  }

  export class allocate_private_usage_arguments {
    static encode(
      message: allocate_private_usage_arguments,
      writer: Writer
    ): void {
      const unique_name_sponsor = message.sponsor;
      if (unique_name_sponsor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_sponsor);
      }

      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_actor);
      }

      const unique_name_grant_id = message.grant_id;
      if (unique_name_grant_id !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_grant_id);
      }

      if (message.units != 0) {
        writer.uint32(32);
        writer.uint32(message.units);
      }
    }

    static decode(
      reader: Reader,
      length: i32
    ): allocate_private_usage_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new allocate_private_usage_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.sponsor = reader.bytes();
            break;

          case 2:
            message.actor = reader.bytes();
            break;

          case 3:
            message.grant_id = reader.bytes();
            break;

          case 4:
            message.units = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    sponsor: Uint8Array | null;
    actor: Uint8Array | null;
    grant_id: Uint8Array | null;
    units: u32;

    constructor(
      sponsor: Uint8Array | null = null,
      actor: Uint8Array | null = null,
      grant_id: Uint8Array | null = null,
      units: u32 = 0
    ) {
      this.sponsor = sponsor;
      this.actor = actor;
      this.grant_id = grant_id;
      this.units = units;
    }
  }

  @unmanaged
  export class allocate_private_usage_result {
    static encode(
      message: allocate_private_usage_result,
      writer: Writer
    ): void {}

    static decode(reader: Reader, length: i32): allocate_private_usage_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new allocate_private_usage_result();

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

  export class get_private_grant_arguments {
    static encode(message: get_private_grant_arguments, writer: Writer): void {
      const unique_name_grant_id = message.grant_id;
      if (unique_name_grant_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_grant_id);
      }
    }

    static decode(reader: Reader, length: i32): get_private_grant_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_private_grant_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.grant_id = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    grant_id: Uint8Array | null;

    constructor(grant_id: Uint8Array | null = null) {
      this.grant_id = grant_id;
    }
  }

  export class get_private_grant_result {
    static encode(message: get_private_grant_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        private_grant.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_private_grant_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_private_grant_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = private_grant.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: private_grant | null;

    constructor(value: private_grant | null = null) {
      this.value = value;
    }
  }

  export class get_private_units_arguments {
    static encode(message: get_private_units_arguments, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      if (message.pool != false) {
        writer.uint32(16);
        writer.bool(message.pool);
      }
    }

    static decode(reader: Reader, length: i32): get_private_units_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_private_units_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.pool = reader.bool();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    account: Uint8Array | null;
    pool: bool;

    constructor(account: Uint8Array | null = null, pool: bool = false) {
      this.account = account;
      this.pool = pool;
    }
  }

  @unmanaged
  export class get_private_units_result {
    static encode(message: get_private_units_result, writer: Writer): void {
      if (message.units != 0) {
        writer.uint32(8);
        writer.uint64(message.units);
      }
    }

    static decode(reader: Reader, length: i32): get_private_units_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_private_units_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.units = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    units: u64;

    constructor(units: u64 = 0) {
      this.units = units;
    }
  }

  export class open_private_channel_arguments {
    static encode(
      message: open_private_channel_arguments,
      writer: Writer
    ): void {
      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_peer = message.peer;
      if (unique_name_peer !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_peer);
      }
    }

    static decode(reader: Reader, length: i32): open_private_channel_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new open_private_channel_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
            message.peer = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    actor: Uint8Array | null;
    peer: Uint8Array | null;

    constructor(
      actor: Uint8Array | null = null,
      peer: Uint8Array | null = null
    ) {
      this.actor = actor;
      this.peer = peer;
    }
  }

  @unmanaged
  export class open_private_channel_result {
    static encode(message: open_private_channel_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): open_private_channel_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new open_private_channel_result();

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

  export class close_private_channel_arguments {
    static encode(
      message: close_private_channel_arguments,
      writer: Writer
    ): void {
      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_peer = message.peer;
      if (unique_name_peer !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_peer);
      }
    }

    static decode(
      reader: Reader,
      length: i32
    ): close_private_channel_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new close_private_channel_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
            message.peer = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    actor: Uint8Array | null;
    peer: Uint8Array | null;

    constructor(
      actor: Uint8Array | null = null,
      peer: Uint8Array | null = null
    ) {
      this.actor = actor;
      this.peer = peer;
    }
  }

  @unmanaged
  export class close_private_channel_result {
    static encode(
      message: close_private_channel_result,
      writer: Writer
    ): void {}

    static decode(reader: Reader, length: i32): close_private_channel_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new close_private_channel_result();

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

  export class get_private_channel_arguments {
    static encode(
      message: get_private_channel_arguments,
      writer: Writer
    ): void {
      const unique_name_a = message.a;
      if (unique_name_a !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_a);
      }

      const unique_name_b = message.b;
      if (unique_name_b !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_b);
      }
    }

    static decode(reader: Reader, length: i32): get_private_channel_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_private_channel_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.a = reader.bytes();
            break;

          case 2:
            message.b = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    a: Uint8Array | null;
    b: Uint8Array | null;

    constructor(a: Uint8Array | null = null, b: Uint8Array | null = null) {
      this.a = a;
      this.b = b;
    }
  }

  export class get_private_channel_result {
    static encode(message: get_private_channel_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        conversation_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_private_channel_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_private_channel_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = conversation_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: conversation_record | null;

    constructor(value: conversation_record | null = null) {
      this.value = value;
    }
  }

  export class private_packet {
    static encode(message: private_packet, writer: Writer): void {
      if (message.block != 0) {
        writer.uint32(56);
        writer.uint64(message.block);
      }

      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_peer = message.peer;
      if (unique_name_peer !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_peer);
      }

      const unique_name_packet_id = message.packet_id;
      if (unique_name_packet_id !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_packet_id);
      }

      const unique_name_content_hash = message.content_hash;
      if (unique_name_content_hash !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_content_hash);
      }

      if (message.sequence != 0) {
        writer.uint32(40);
        writer.uint64(message.sequence);
      }

      if (message.timestamp != 0) {
        writer.uint32(48);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): private_packet {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new private_packet();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 7:
            message.block = reader.uint64();
            break;

          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
            message.peer = reader.bytes();
            break;

          case 3:
            message.packet_id = reader.bytes();
            break;

          case 4:
            message.content_hash = reader.bytes();
            break;

          case 5:
            message.sequence = reader.uint64();
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

    block: u64;
    actor: Uint8Array | null;
    peer: Uint8Array | null;
    packet_id: Uint8Array | null;
    content_hash: Uint8Array | null;
    sequence: u64;
    timestamp: u64;

    constructor(
      block: u64 = 0,
      actor: Uint8Array | null = null,
      peer: Uint8Array | null = null,
      packet_id: Uint8Array | null = null,
      content_hash: Uint8Array | null = null,
      sequence: u64 = 0,
      timestamp: u64 = 0
    ) {
      this.block = block;
      this.actor = actor;
      this.peer = peer;
      this.packet_id = packet_id;
      this.content_hash = content_hash;
      this.sequence = sequence;
      this.timestamp = timestamp;
    }
  }

  export class post_private_packet_arguments {
    static encode(
      message: post_private_packet_arguments,
      writer: Writer
    ): void {
      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_peer = message.peer;
      if (unique_name_peer !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_peer);
      }

      const unique_name_packet_id = message.packet_id;
      if (unique_name_packet_id !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_packet_id);
      }

      const unique_name_envelope = message.envelope;
      if (unique_name_envelope !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_envelope);
      }
    }

    static decode(reader: Reader, length: i32): post_private_packet_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new post_private_packet_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
            message.peer = reader.bytes();
            break;

          case 3:
            message.packet_id = reader.bytes();
            break;

          case 4:
            message.envelope = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    actor: Uint8Array | null;
    peer: Uint8Array | null;
    packet_id: Uint8Array | null;
    envelope: Uint8Array | null;

    constructor(
      actor: Uint8Array | null = null,
      peer: Uint8Array | null = null,
      packet_id: Uint8Array | null = null,
      envelope: Uint8Array | null = null
    ) {
      this.actor = actor;
      this.peer = peer;
      this.packet_id = packet_id;
      this.envelope = envelope;
    }
  }

  export class post_private_packet_result {
    static encode(message: post_private_packet_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        private_packet.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): post_private_packet_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new post_private_packet_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = private_packet.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: private_packet | null;

    constructor(value: private_packet | null = null) {
      this.value = value;
    }
  }

  export class get_private_packet_arguments {
    static encode(message: get_private_packet_arguments, writer: Writer): void {
      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_packet_id = message.packet_id;
      if (unique_name_packet_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_packet_id);
      }
    }

    static decode(reader: Reader, length: i32): get_private_packet_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_private_packet_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
            message.packet_id = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    actor: Uint8Array | null;
    packet_id: Uint8Array | null;

    constructor(
      actor: Uint8Array | null = null,
      packet_id: Uint8Array | null = null
    ) {
      this.actor = actor;
      this.packet_id = packet_id;
    }
  }

  export class get_private_packet_result {
    static encode(message: get_private_packet_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        private_packet.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_private_packet_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_private_packet_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = private_packet.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: private_packet | null;

    constructor(value: private_packet | null = null) {
      this.value = value;
    }
  }

  @unmanaged
  export class get_private_status_arguments {
    static encode(
      message: get_private_status_arguments,
      writer: Writer
    ): void {}

    static decode(reader: Reader, length: i32): get_private_status_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_private_status_arguments();

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
  export class get_private_status_result {
    static encode(message: get_private_status_result, writer: Writer): void {
      if (message.version != 0) {
        writer.uint32(8);
        writer.uint32(message.version);
      }

      if (message.sequence != 0) {
        writer.uint32(16);
        writer.uint64(message.sequence);
      }
    }

    static decode(reader: Reader, length: i32): get_private_status_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_private_status_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.version = reader.uint32();
            break;

          case 2:
            message.sequence = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    version: u32;
    sequence: u64;

    constructor(version: u32 = 0, sequence: u64 = 0) {
      this.version = version;
      this.sequence = sequence;
    }
  }

  export class private_packet_event {
    static encode(message: private_packet_event, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        private_packet.encode(unique_name_value, writer);
        writer.ldelim();
      }

      const unique_name_envelope = message.envelope;
      if (unique_name_envelope !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_envelope);
      }
    }

    static decode(reader: Reader, length: i32): private_packet_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new private_packet_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = private_packet.decode(reader, reader.uint32());
            break;

          case 2:
            message.envelope = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: private_packet | null;
    envelope: Uint8Array | null;

    constructor(
      value: private_packet | null = null,
      envelope: Uint8Array | null = null
    ) {
      this.value = value;
      this.envelope = envelope;
    }
  }

  export class private_channel_event {
    static encode(message: private_channel_event, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        conversation_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): private_channel_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new private_channel_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = conversation_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: conversation_record | null;

    constructor(value: conversation_record | null = null) {
      this.value = value;
    }
  }
}
