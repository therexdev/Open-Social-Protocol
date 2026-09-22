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

    constructor(
      a: Uint8Array | null = null,
      b: Uint8Array | null = null,
      requester: Uint8Array | null = null,
      status: u32 = 0,
      generation: u64 = 0,
      sequence: u64 = 0,
      updated_at: u64 = 0
    ) {
      this.a = a;
      this.b = b;
      this.requester = requester;
      this.status = status;
      this.generation = generation;
      this.sequence = sequence;
      this.updated_at = updated_at;
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
}
