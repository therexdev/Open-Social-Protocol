import { Writer, Reader } from "as-proto";

export namespace relationships {
  export class relationship_record {
    static encode(message: relationship_record, writer: Writer): void {
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

      if (message.status != 0) {
        writer.uint32(24);
        writer.int32(message.status);
      }

      const unique_name_requester = message.requester;
      if (unique_name_requester !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_requester);
      }

      if (message.nonce != 0) {
        writer.uint32(40);
        writer.uint64(message.nonce);
      }

      if (message.updated_at != 0) {
        writer.uint32(48);
        writer.uint64(message.updated_at);
      }
    }

    static decode(reader: Reader, length: i32): relationship_record {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new relationship_record();

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
            message.status = reader.int32();
            break;

          case 4:
            message.requester = reader.bytes();
            break;

          case 5:
            message.nonce = reader.uint64();
            break;

          case 6:
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
    status: relationship_status;
    requester: Uint8Array | null;
    nonce: u64;
    updated_at: u64;

    constructor(
      a: Uint8Array | null = null,
      b: Uint8Array | null = null,
      status: relationship_status = 0,
      requester: Uint8Array | null = null,
      nonce: u64 = 0,
      updated_at: u64 = 0
    ) {
      this.a = a;
      this.b = b;
      this.status = status;
      this.requester = requester;
      this.nonce = nonce;
      this.updated_at = updated_at;
    }
  }

  @unmanaged
  export class audience_state {
    static encode(message: audience_state, writer: Writer): void {
      if (message.epoch != 0) {
        writer.uint32(8);
        writer.uint32(message.epoch);
      }

      if (message.updated_at != 0) {
        writer.uint32(16);
        writer.uint64(message.updated_at);
      }
    }

    static decode(reader: Reader, length: i32): audience_state {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new audience_state();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.epoch = reader.uint32();
            break;

          case 2:
            message.updated_at = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    epoch: u32;
    updated_at: u64;

    constructor(epoch: u32 = 0, updated_at: u64 = 0) {
      this.epoch = epoch;
      this.updated_at = updated_at;
    }
  }

  @unmanaged
  export class block_record {
    static encode(message: block_record, writer: Writer): void {
      if (message.blocked != false) {
        writer.uint32(8);
        writer.bool(message.blocked);
      }

      if (message.updated_at != 0) {
        writer.uint32(16);
        writer.uint64(message.updated_at);
      }
    }

    static decode(reader: Reader, length: i32): block_record {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new block_record();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.blocked = reader.bool();
            break;

          case 2:
            message.updated_at = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    blocked: bool;
    updated_at: u64;

    constructor(blocked: bool = false, updated_at: u64 = 0) {
      this.blocked = blocked;
      this.updated_at = updated_at;
    }
  }

  @unmanaged
  export class follow_record {
    static encode(message: follow_record, writer: Writer): void {
      if (message.active != false) {
        writer.uint32(8);
        writer.bool(message.active);
      }

      if (message.updated_at != 0) {
        writer.uint32(16);
        writer.uint64(message.updated_at);
      }
    }

    static decode(reader: Reader, length: i32): follow_record {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new follow_record();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.active = reader.bool();
            break;

          case 2:
            message.updated_at = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    active: bool;
    updated_at: u64;

    constructor(active: bool = false, updated_at: u64 = 0) {
      this.active = active;
      this.updated_at = updated_at;
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

  export class request_friend_arguments {
    static encode(message: request_friend_arguments, writer: Writer): void {
      const unique_name_requester = message.requester;
      if (unique_name_requester !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_requester);
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
    }

    static decode(reader: Reader, length: i32): request_friend_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new request_friend_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.requester = reader.bytes();
            break;

          case 2:
            message.recipient = reader.bytes();
            break;

          case 3:
            message.device = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    requester: Uint8Array | null;
    recipient: Uint8Array | null;
    device: Uint8Array | null;

    constructor(
      requester: Uint8Array | null = null,
      recipient: Uint8Array | null = null,
      device: Uint8Array | null = null
    ) {
      this.requester = requester;
      this.recipient = recipient;
      this.device = device;
    }
  }

  @unmanaged
  export class request_friend_result {
    static encode(message: request_friend_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): request_friend_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new request_friend_result();

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

  export class accept_friend_arguments {
    static encode(message: accept_friend_arguments, writer: Writer): void {
      const unique_name_approver = message.approver;
      if (unique_name_approver !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_approver);
      }

      const unique_name_requester = message.requester;
      if (unique_name_requester !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_requester);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_device);
      }

      const unique_name_key_package_ref = message.key_package_ref;
      if (unique_name_key_package_ref !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_key_package_ref);
      }
    }

    static decode(reader: Reader, length: i32): accept_friend_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new accept_friend_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.approver = reader.bytes();
            break;

          case 2:
            message.requester = reader.bytes();
            break;

          case 3:
            message.device = reader.bytes();
            break;

          case 4:
            message.key_package_ref = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    approver: Uint8Array | null;
    requester: Uint8Array | null;
    device: Uint8Array | null;
    key_package_ref: Uint8Array | null;

    constructor(
      approver: Uint8Array | null = null,
      requester: Uint8Array | null = null,
      device: Uint8Array | null = null,
      key_package_ref: Uint8Array | null = null
    ) {
      this.approver = approver;
      this.requester = requester;
      this.device = device;
      this.key_package_ref = key_package_ref;
    }
  }

  @unmanaged
  export class accept_friend_result {
    static encode(message: accept_friend_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): accept_friend_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new accept_friend_result();

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

  export class remove_friend_arguments {
    static encode(message: remove_friend_arguments, writer: Writer): void {
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
    }

    static decode(reader: Reader, length: i32): remove_friend_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new remove_friend_arguments();

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

    constructor(
      actor: Uint8Array | null = null,
      peer: Uint8Array | null = null,
      device: Uint8Array | null = null
    ) {
      this.actor = actor;
      this.peer = peer;
      this.device = device;
    }
  }

  @unmanaged
  export class remove_friend_result {
    static encode(message: remove_friend_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): remove_friend_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new remove_friend_result();

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

  export class block_arguments {
    static encode(message: block_arguments, writer: Writer): void {
      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_target = message.target;
      if (unique_name_target !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_target);
      }
    }

    static decode(reader: Reader, length: i32): block_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new block_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
            message.target = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    actor: Uint8Array | null;
    target: Uint8Array | null;

    constructor(
      actor: Uint8Array | null = null,
      target: Uint8Array | null = null
    ) {
      this.actor = actor;
      this.target = target;
    }
  }

  @unmanaged
  export class block_result {
    static encode(message: block_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): block_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new block_result();

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

  export class unblock_arguments {
    static encode(message: unblock_arguments, writer: Writer): void {
      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_target = message.target;
      if (unique_name_target !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_target);
      }
    }

    static decode(reader: Reader, length: i32): unblock_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new unblock_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
            message.target = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    actor: Uint8Array | null;
    target: Uint8Array | null;

    constructor(
      actor: Uint8Array | null = null,
      target: Uint8Array | null = null
    ) {
      this.actor = actor;
      this.target = target;
    }
  }

  @unmanaged
  export class unblock_result {
    static encode(message: unblock_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): unblock_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new unblock_result();

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

  export class follow_arguments {
    static encode(message: follow_arguments, writer: Writer): void {
      const unique_name_follower = message.follower;
      if (unique_name_follower !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_follower);
      }

      const unique_name_target = message.target;
      if (unique_name_target !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_target);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): follow_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new follow_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.follower = reader.bytes();
            break;

          case 2:
            message.target = reader.bytes();
            break;

          case 3:
            message.device = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    follower: Uint8Array | null;
    target: Uint8Array | null;
    device: Uint8Array | null;

    constructor(
      follower: Uint8Array | null = null,
      target: Uint8Array | null = null,
      device: Uint8Array | null = null
    ) {
      this.follower = follower;
      this.target = target;
      this.device = device;
    }
  }

  @unmanaged
  export class follow_result {
    static encode(message: follow_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): follow_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new follow_result();

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

  export class unfollow_arguments {
    static encode(message: unfollow_arguments, writer: Writer): void {
      const unique_name_follower = message.follower;
      if (unique_name_follower !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_follower);
      }

      const unique_name_target = message.target;
      if (unique_name_target !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_target);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): unfollow_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new unfollow_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.follower = reader.bytes();
            break;

          case 2:
            message.target = reader.bytes();
            break;

          case 3:
            message.device = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    follower: Uint8Array | null;
    target: Uint8Array | null;
    device: Uint8Array | null;

    constructor(
      follower: Uint8Array | null = null,
      target: Uint8Array | null = null,
      device: Uint8Array | null = null
    ) {
      this.follower = follower;
      this.target = target;
      this.device = device;
    }
  }

  @unmanaged
  export class unfollow_result {
    static encode(message: unfollow_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): unfollow_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new unfollow_result();

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

  export class rotate_audience_arguments {
    static encode(message: rotate_audience_arguments, writer: Writer): void {
      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): rotate_audience_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new rotate_audience_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
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
    device: Uint8Array | null;

    constructor(
      actor: Uint8Array | null = null,
      device: Uint8Array | null = null
    ) {
      this.actor = actor;
      this.device = device;
    }
  }

  @unmanaged
  export class rotate_audience_result {
    static encode(message: rotate_audience_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): rotate_audience_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new rotate_audience_result();

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

  export class get_relationship_arguments {
    static encode(message: get_relationship_arguments, writer: Writer): void {
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

    static decode(reader: Reader, length: i32): get_relationship_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_relationship_arguments();

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

  export class get_relationship_result {
    static encode(message: get_relationship_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        relationship_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_relationship_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_relationship_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = relationship_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: relationship_record | null;

    constructor(value: relationship_record | null = null) {
      this.value = value;
    }
  }

  export class get_audience_arguments {
    static encode(message: get_audience_arguments, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }
    }

    static decode(reader: Reader, length: i32): get_audience_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_audience_arguments();

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

  @unmanaged
  export class get_audience_result {
    static encode(message: get_audience_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        audience_state.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_audience_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_audience_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = audience_state.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: audience_state | null;

    constructor(value: audience_state | null = null) {
      this.value = value;
    }
  }

  export class is_blocked_arguments {
    static encode(message: is_blocked_arguments, writer: Writer): void {
      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_target = message.target;
      if (unique_name_target !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_target);
      }
    }

    static decode(reader: Reader, length: i32): is_blocked_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new is_blocked_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
            message.target = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    actor: Uint8Array | null;
    target: Uint8Array | null;

    constructor(
      actor: Uint8Array | null = null,
      target: Uint8Array | null = null
    ) {
      this.actor = actor;
      this.target = target;
    }
  }

  @unmanaged
  export class is_blocked_result {
    static encode(message: is_blocked_result, writer: Writer): void {
      if (message.value != false) {
        writer.uint32(8);
        writer.bool(message.value);
      }
    }

    static decode(reader: Reader, length: i32): is_blocked_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new is_blocked_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = reader.bool();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: bool;

    constructor(value: bool = false) {
      this.value = value;
    }
  }

  export class get_follow_arguments {
    static encode(message: get_follow_arguments, writer: Writer): void {
      const unique_name_follower = message.follower;
      if (unique_name_follower !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_follower);
      }

      const unique_name_target = message.target;
      if (unique_name_target !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_target);
      }
    }

    static decode(reader: Reader, length: i32): get_follow_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_follow_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.follower = reader.bytes();
            break;

          case 2:
            message.target = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    follower: Uint8Array | null;
    target: Uint8Array | null;

    constructor(
      follower: Uint8Array | null = null,
      target: Uint8Array | null = null
    ) {
      this.follower = follower;
      this.target = target;
    }
  }

  @unmanaged
  export class get_follow_result {
    static encode(message: get_follow_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        follow_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_follow_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_follow_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = follow_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: follow_record | null;

    constructor(value: follow_record | null = null) {
      this.value = value;
    }
  }

  @unmanaged
  export class get_identity_contract_arguments {
    static encode(
      message: get_identity_contract_arguments,
      writer: Writer
    ): void {}

    static decode(
      reader: Reader,
      length: i32
    ): get_identity_contract_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_identity_contract_arguments();

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

  export class get_identity_contract_result {
    static encode(message: get_identity_contract_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_value);
      }
    }

    static decode(reader: Reader, length: i32): get_identity_contract_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_identity_contract_result();

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

  export class friend_requested_event {
    static encode(message: friend_requested_event, writer: Writer): void {
      const unique_name_requester = message.requester;
      if (unique_name_requester !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_requester);
      }

      const unique_name_recipient = message.recipient;
      if (unique_name_recipient !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_recipient);
      }

      if (message.nonce != 0) {
        writer.uint32(24);
        writer.uint64(message.nonce);
      }

      if (message.timestamp != 0) {
        writer.uint32(32);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): friend_requested_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new friend_requested_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.requester = reader.bytes();
            break;

          case 2:
            message.recipient = reader.bytes();
            break;

          case 3:
            message.nonce = reader.uint64();
            break;

          case 4:
            message.timestamp = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    requester: Uint8Array | null;
    recipient: Uint8Array | null;
    nonce: u64;
    timestamp: u64;

    constructor(
      requester: Uint8Array | null = null,
      recipient: Uint8Array | null = null,
      nonce: u64 = 0,
      timestamp: u64 = 0
    ) {
      this.requester = requester;
      this.recipient = recipient;
      this.nonce = nonce;
      this.timestamp = timestamp;
    }
  }

  export class friend_accepted_event {
    static encode(message: friend_accepted_event, writer: Writer): void {
      const unique_name_approver = message.approver;
      if (unique_name_approver !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_approver);
      }

      const unique_name_requester = message.requester;
      if (unique_name_requester !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_requester);
      }

      if (message.nonce != 0) {
        writer.uint32(24);
        writer.uint64(message.nonce);
      }

      const unique_name_key_package_ref = message.key_package_ref;
      if (unique_name_key_package_ref !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_key_package_ref);
      }

      if (message.timestamp != 0) {
        writer.uint32(40);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): friend_accepted_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new friend_accepted_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.approver = reader.bytes();
            break;

          case 2:
            message.requester = reader.bytes();
            break;

          case 3:
            message.nonce = reader.uint64();
            break;

          case 4:
            message.key_package_ref = reader.bytes();
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

    approver: Uint8Array | null;
    requester: Uint8Array | null;
    nonce: u64;
    key_package_ref: Uint8Array | null;
    timestamp: u64;

    constructor(
      approver: Uint8Array | null = null,
      requester: Uint8Array | null = null,
      nonce: u64 = 0,
      key_package_ref: Uint8Array | null = null,
      timestamp: u64 = 0
    ) {
      this.approver = approver;
      this.requester = requester;
      this.nonce = nonce;
      this.key_package_ref = key_package_ref;
      this.timestamp = timestamp;
    }
  }

  export class friend_removed_event {
    static encode(message: friend_removed_event, writer: Writer): void {
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

      if (message.nonce != 0) {
        writer.uint32(24);
        writer.uint64(message.nonce);
      }

      if (message.new_epoch != 0) {
        writer.uint32(32);
        writer.uint32(message.new_epoch);
      }

      if (message.timestamp != 0) {
        writer.uint32(40);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): friend_removed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new friend_removed_event();

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
            message.nonce = reader.uint64();
            break;

          case 4:
            message.new_epoch = reader.uint32();
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

    actor: Uint8Array | null;
    peer: Uint8Array | null;
    nonce: u64;
    new_epoch: u32;
    timestamp: u64;

    constructor(
      actor: Uint8Array | null = null,
      peer: Uint8Array | null = null,
      nonce: u64 = 0,
      new_epoch: u32 = 0,
      timestamp: u64 = 0
    ) {
      this.actor = actor;
      this.peer = peer;
      this.nonce = nonce;
      this.new_epoch = new_epoch;
      this.timestamp = timestamp;
    }
  }

  export class blocked_event {
    static encode(message: blocked_event, writer: Writer): void {
      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_target = message.target;
      if (unique_name_target !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_target);
      }

      if (message.new_epoch != 0) {
        writer.uint32(24);
        writer.uint32(message.new_epoch);
      }

      if (message.timestamp != 0) {
        writer.uint32(32);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): blocked_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new blocked_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
            message.target = reader.bytes();
            break;

          case 3:
            message.new_epoch = reader.uint32();
            break;

          case 4:
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
    target: Uint8Array | null;
    new_epoch: u32;
    timestamp: u64;

    constructor(
      actor: Uint8Array | null = null,
      target: Uint8Array | null = null,
      new_epoch: u32 = 0,
      timestamp: u64 = 0
    ) {
      this.actor = actor;
      this.target = target;
      this.new_epoch = new_epoch;
      this.timestamp = timestamp;
    }
  }

  export class unblocked_event {
    static encode(message: unblocked_event, writer: Writer): void {
      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_target = message.target;
      if (unique_name_target !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_target);
      }

      if (message.timestamp != 0) {
        writer.uint32(24);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): unblocked_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new unblocked_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
            message.target = reader.bytes();
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

    actor: Uint8Array | null;
    target: Uint8Array | null;
    timestamp: u64;

    constructor(
      actor: Uint8Array | null = null,
      target: Uint8Array | null = null,
      timestamp: u64 = 0
    ) {
      this.actor = actor;
      this.target = target;
      this.timestamp = timestamp;
    }
  }

  export class followed_event {
    static encode(message: followed_event, writer: Writer): void {
      const unique_name_follower = message.follower;
      if (unique_name_follower !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_follower);
      }

      const unique_name_target = message.target;
      if (unique_name_target !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_target);
      }

      if (message.timestamp != 0) {
        writer.uint32(24);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): followed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new followed_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.follower = reader.bytes();
            break;

          case 2:
            message.target = reader.bytes();
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

    follower: Uint8Array | null;
    target: Uint8Array | null;
    timestamp: u64;

    constructor(
      follower: Uint8Array | null = null,
      target: Uint8Array | null = null,
      timestamp: u64 = 0
    ) {
      this.follower = follower;
      this.target = target;
      this.timestamp = timestamp;
    }
  }

  export class unfollowed_event {
    static encode(message: unfollowed_event, writer: Writer): void {
      const unique_name_follower = message.follower;
      if (unique_name_follower !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_follower);
      }

      const unique_name_target = message.target;
      if (unique_name_target !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_target);
      }

      if (message.timestamp != 0) {
        writer.uint32(24);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): unfollowed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new unfollowed_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.follower = reader.bytes();
            break;

          case 2:
            message.target = reader.bytes();
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

    follower: Uint8Array | null;
    target: Uint8Array | null;
    timestamp: u64;

    constructor(
      follower: Uint8Array | null = null,
      target: Uint8Array | null = null,
      timestamp: u64 = 0
    ) {
      this.follower = follower;
      this.target = target;
      this.timestamp = timestamp;
    }
  }

  export class audience_rotated_event {
    static encode(message: audience_rotated_event, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      if (message.new_epoch != 0) {
        writer.uint32(16);
        writer.uint32(message.new_epoch);
      }

      const unique_name_reason = message.reason;
      if (unique_name_reason !== null) {
        writer.uint32(26);
        writer.string(unique_name_reason);
      }

      if (message.timestamp != 0) {
        writer.uint32(32);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): audience_rotated_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new audience_rotated_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.new_epoch = reader.uint32();
            break;

          case 3:
            message.reason = reader.string();
            break;

          case 4:
            message.timestamp = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    account: Uint8Array | null;
    new_epoch: u32;
    reason: string | null;
    timestamp: u64;

    constructor(
      account: Uint8Array | null = null,
      new_epoch: u32 = 0,
      reason: string | null = null,
      timestamp: u64 = 0
    ) {
      this.account = account;
      this.new_epoch = new_epoch;
      this.reason = reason;
      this.timestamp = timestamp;
    }
  }

  export enum relationship_status {
    none = 0,
    pending = 1,
    active = 2,
    inactive = 3,
  }
}
