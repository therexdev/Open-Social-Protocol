import { Writer, Reader } from "as-proto";

export namespace communities {
  export class community_record {
    static encode(message: community_record, writer: Writer): void {
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

      const unique_name_name = message.name;
      if (unique_name_name !== null) {
        writer.uint32(26);
        writer.string(unique_name_name);
      }

      const unique_name_policy_hash = message.policy_hash;
      if (unique_name_policy_hash !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_policy_hash);
      }

      const unique_name_policy_uri = message.policy_uri;
      if (unique_name_policy_uri !== null) {
        writer.uint32(42);
        writer.string(unique_name_policy_uri);
      }

      if (message.transfer_delay_ms != 0) {
        writer.uint32(48);
        writer.uint64(message.transfer_delay_ms);
      }

      const unique_name_pending_owner = message.pending_owner;
      if (unique_name_pending_owner !== null) {
        writer.uint32(58);
        writer.bytes(unique_name_pending_owner);
      }

      if (message.transfer_effective_at != 0) {
        writer.uint32(64);
        writer.uint64(message.transfer_effective_at);
      }

      if (message.created_at != 0) {
        writer.uint32(72);
        writer.uint64(message.created_at);
      }

      if (message.updated_at != 0) {
        writer.uint32(80);
        writer.uint64(message.updated_at);
      }
    }

    static decode(reader: Reader, length: i32): community_record {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new community_record();

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
            message.name = reader.string();
            break;

          case 4:
            message.policy_hash = reader.bytes();
            break;

          case 5:
            message.policy_uri = reader.string();
            break;

          case 6:
            message.transfer_delay_ms = reader.uint64();
            break;

          case 7:
            message.pending_owner = reader.bytes();
            break;

          case 8:
            message.transfer_effective_at = reader.uint64();
            break;

          case 9:
            message.created_at = reader.uint64();
            break;

          case 10:
            message.updated_at = reader.uint64();
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
    name: string | null;
    policy_hash: Uint8Array | null;
    policy_uri: string | null;
    transfer_delay_ms: u64;
    pending_owner: Uint8Array | null;
    transfer_effective_at: u64;
    created_at: u64;
    updated_at: u64;

    constructor(
      id: Uint8Array | null = null,
      owner: Uint8Array | null = null,
      name: string | null = null,
      policy_hash: Uint8Array | null = null,
      policy_uri: string | null = null,
      transfer_delay_ms: u64 = 0,
      pending_owner: Uint8Array | null = null,
      transfer_effective_at: u64 = 0,
      created_at: u64 = 0,
      updated_at: u64 = 0
    ) {
      this.id = id;
      this.owner = owner;
      this.name = name;
      this.policy_hash = policy_hash;
      this.policy_uri = policy_uri;
      this.transfer_delay_ms = transfer_delay_ms;
      this.pending_owner = pending_owner;
      this.transfer_effective_at = transfer_effective_at;
      this.created_at = created_at;
      this.updated_at = updated_at;
    }
  }

  export class role_record {
    static encode(message: role_record, writer: Writer): void {
      if (message.role != 0) {
        writer.uint32(8);
        writer.int32(message.role);
      }

      const unique_name_scope = message.scope;
      if (unique_name_scope !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_scope);
      }

      if (message.expires_at != 0) {
        writer.uint32(24);
        writer.uint64(message.expires_at);
      }

      const unique_name_granted_by = message.granted_by;
      if (unique_name_granted_by !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_granted_by);
      }

      if (message.granted_at != 0) {
        writer.uint32(40);
        writer.uint64(message.granted_at);
      }
    }

    static decode(reader: Reader, length: i32): role_record {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new role_record();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.role = reader.int32();
            break;

          case 2:
            message.scope = reader.bytes();
            break;

          case 3:
            message.expires_at = reader.uint64();
            break;

          case 4:
            message.granted_by = reader.bytes();
            break;

          case 5:
            message.granted_at = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    role: community_role;
    scope: Uint8Array | null;
    expires_at: u64;
    granted_by: Uint8Array | null;
    granted_at: u64;

    constructor(
      role: community_role = 0,
      scope: Uint8Array | null = null,
      expires_at: u64 = 0,
      granted_by: Uint8Array | null = null,
      granted_at: u64 = 0
    ) {
      this.role = role;
      this.scope = scope;
      this.expires_at = expires_at;
      this.granted_by = granted_by;
      this.granted_at = granted_at;
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

  export class create_community_arguments {
    static encode(message: create_community_arguments, writer: Writer): void {
      const unique_name_creator = message.creator;
      if (unique_name_creator !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_creator);
      }

      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_id);
      }

      const unique_name_name = message.name;
      if (unique_name_name !== null) {
        writer.uint32(26);
        writer.string(unique_name_name);
      }

      const unique_name_policy_hash = message.policy_hash;
      if (unique_name_policy_hash !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_policy_hash);
      }

      const unique_name_policy_uri = message.policy_uri;
      if (unique_name_policy_uri !== null) {
        writer.uint32(42);
        writer.string(unique_name_policy_uri);
      }

      if (message.transfer_delay_ms != 0) {
        writer.uint32(48);
        writer.uint64(message.transfer_delay_ms);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(58);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): create_community_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new create_community_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.creator = reader.bytes();
            break;

          case 2:
            message.id = reader.bytes();
            break;

          case 3:
            message.name = reader.string();
            break;

          case 4:
            message.policy_hash = reader.bytes();
            break;

          case 5:
            message.policy_uri = reader.string();
            break;

          case 6:
            message.transfer_delay_ms = reader.uint64();
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

    creator: Uint8Array | null;
    id: Uint8Array | null;
    name: string | null;
    policy_hash: Uint8Array | null;
    policy_uri: string | null;
    transfer_delay_ms: u64;
    device: Uint8Array | null;

    constructor(
      creator: Uint8Array | null = null,
      id: Uint8Array | null = null,
      name: string | null = null,
      policy_hash: Uint8Array | null = null,
      policy_uri: string | null = null,
      transfer_delay_ms: u64 = 0,
      device: Uint8Array | null = null
    ) {
      this.creator = creator;
      this.id = id;
      this.name = name;
      this.policy_hash = policy_hash;
      this.policy_uri = policy_uri;
      this.transfer_delay_ms = transfer_delay_ms;
      this.device = device;
    }
  }

  @unmanaged
  export class create_community_result {
    static encode(message: create_community_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): create_community_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new create_community_result();

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

  export class set_role_arguments {
    static encode(message: set_role_arguments, writer: Writer): void {
      const unique_name_community_id = message.community_id;
      if (unique_name_community_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_community_id);
      }

      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_actor);
      }

      const unique_name_subject = message.subject;
      if (unique_name_subject !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_subject);
      }

      if (message.role != 0) {
        writer.uint32(32);
        writer.int32(message.role);
      }

      const unique_name_scope = message.scope;
      if (unique_name_scope !== null) {
        writer.uint32(42);
        writer.bytes(unique_name_scope);
      }

      if (message.expires_at != 0) {
        writer.uint32(48);
        writer.uint64(message.expires_at);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(58);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): set_role_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_role_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.community_id = reader.bytes();
            break;

          case 2:
            message.actor = reader.bytes();
            break;

          case 3:
            message.subject = reader.bytes();
            break;

          case 4:
            message.role = reader.int32();
            break;

          case 5:
            message.scope = reader.bytes();
            break;

          case 6:
            message.expires_at = reader.uint64();
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

    community_id: Uint8Array | null;
    actor: Uint8Array | null;
    subject: Uint8Array | null;
    role: community_role;
    scope: Uint8Array | null;
    expires_at: u64;
    device: Uint8Array | null;

    constructor(
      community_id: Uint8Array | null = null,
      actor: Uint8Array | null = null,
      subject: Uint8Array | null = null,
      role: community_role = 0,
      scope: Uint8Array | null = null,
      expires_at: u64 = 0,
      device: Uint8Array | null = null
    ) {
      this.community_id = community_id;
      this.actor = actor;
      this.subject = subject;
      this.role = role;
      this.scope = scope;
      this.expires_at = expires_at;
      this.device = device;
    }
  }

  @unmanaged
  export class set_role_result {
    static encode(message: set_role_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): set_role_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_role_result();

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

  export class set_policy_arguments {
    static encode(message: set_policy_arguments, writer: Writer): void {
      const unique_name_community_id = message.community_id;
      if (unique_name_community_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_community_id);
      }

      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_actor);
      }

      const unique_name_policy_hash = message.policy_hash;
      if (unique_name_policy_hash !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_policy_hash);
      }

      const unique_name_policy_uri = message.policy_uri;
      if (unique_name_policy_uri !== null) {
        writer.uint32(34);
        writer.string(unique_name_policy_uri);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(42);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): set_policy_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_policy_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.community_id = reader.bytes();
            break;

          case 2:
            message.actor = reader.bytes();
            break;

          case 3:
            message.policy_hash = reader.bytes();
            break;

          case 4:
            message.policy_uri = reader.string();
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

    community_id: Uint8Array | null;
    actor: Uint8Array | null;
    policy_hash: Uint8Array | null;
    policy_uri: string | null;
    device: Uint8Array | null;

    constructor(
      community_id: Uint8Array | null = null,
      actor: Uint8Array | null = null,
      policy_hash: Uint8Array | null = null,
      policy_uri: string | null = null,
      device: Uint8Array | null = null
    ) {
      this.community_id = community_id;
      this.actor = actor;
      this.policy_hash = policy_hash;
      this.policy_uri = policy_uri;
      this.device = device;
    }
  }

  @unmanaged
  export class set_policy_result {
    static encode(message: set_policy_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): set_policy_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_policy_result();

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

  export class propose_owner_transfer_arguments {
    static encode(
      message: propose_owner_transfer_arguments,
      writer: Writer
    ): void {
      const unique_name_community_id = message.community_id;
      if (unique_name_community_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_community_id);
      }

      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_owner);
      }

      const unique_name_new_owner = message.new_owner;
      if (unique_name_new_owner !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_new_owner);
      }
    }

    static decode(
      reader: Reader,
      length: i32
    ): propose_owner_transfer_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new propose_owner_transfer_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.community_id = reader.bytes();
            break;

          case 2:
            message.owner = reader.bytes();
            break;

          case 3:
            message.new_owner = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    community_id: Uint8Array | null;
    owner: Uint8Array | null;
    new_owner: Uint8Array | null;

    constructor(
      community_id: Uint8Array | null = null,
      owner: Uint8Array | null = null,
      new_owner: Uint8Array | null = null
    ) {
      this.community_id = community_id;
      this.owner = owner;
      this.new_owner = new_owner;
    }
  }

  @unmanaged
  export class propose_owner_transfer_result {
    static encode(
      message: propose_owner_transfer_result,
      writer: Writer
    ): void {}

    static decode(reader: Reader, length: i32): propose_owner_transfer_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new propose_owner_transfer_result();

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

  export class cancel_owner_transfer_arguments {
    static encode(
      message: cancel_owner_transfer_arguments,
      writer: Writer
    ): void {
      const unique_name_community_id = message.community_id;
      if (unique_name_community_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_community_id);
      }

      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_owner);
      }
    }

    static decode(
      reader: Reader,
      length: i32
    ): cancel_owner_transfer_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new cancel_owner_transfer_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.community_id = reader.bytes();
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

    community_id: Uint8Array | null;
    owner: Uint8Array | null;

    constructor(
      community_id: Uint8Array | null = null,
      owner: Uint8Array | null = null
    ) {
      this.community_id = community_id;
      this.owner = owner;
    }
  }

  @unmanaged
  export class cancel_owner_transfer_result {
    static encode(
      message: cancel_owner_transfer_result,
      writer: Writer
    ): void {}

    static decode(reader: Reader, length: i32): cancel_owner_transfer_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new cancel_owner_transfer_result();

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

  export class execute_owner_transfer_arguments {
    static encode(
      message: execute_owner_transfer_arguments,
      writer: Writer
    ): void {
      const unique_name_community_id = message.community_id;
      if (unique_name_community_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_community_id);
      }
    }

    static decode(
      reader: Reader,
      length: i32
    ): execute_owner_transfer_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new execute_owner_transfer_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.community_id = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    community_id: Uint8Array | null;

    constructor(community_id: Uint8Array | null = null) {
      this.community_id = community_id;
    }
  }

  @unmanaged
  export class execute_owner_transfer_result {
    static encode(
      message: execute_owner_transfer_result,
      writer: Writer
    ): void {}

    static decode(reader: Reader, length: i32): execute_owner_transfer_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new execute_owner_transfer_result();

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

  export class set_label_arguments {
    static encode(message: set_label_arguments, writer: Writer): void {
      const unique_name_community_id = message.community_id;
      if (unique_name_community_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_community_id);
      }

      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_actor);
      }

      const unique_name_post_id = message.post_id;
      if (unique_name_post_id !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_post_id);
      }

      const unique_name_label = message.label;
      if (unique_name_label !== null) {
        writer.uint32(34);
        writer.string(unique_name_label);
      }

      const unique_name_reason = message.reason;
      if (unique_name_reason !== null) {
        writer.uint32(42);
        writer.string(unique_name_reason);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(50);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): set_label_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_label_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.community_id = reader.bytes();
            break;

          case 2:
            message.actor = reader.bytes();
            break;

          case 3:
            message.post_id = reader.bytes();
            break;

          case 4:
            message.label = reader.string();
            break;

          case 5:
            message.reason = reader.string();
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

    community_id: Uint8Array | null;
    actor: Uint8Array | null;
    post_id: Uint8Array | null;
    label: string | null;
    reason: string | null;
    device: Uint8Array | null;

    constructor(
      community_id: Uint8Array | null = null,
      actor: Uint8Array | null = null,
      post_id: Uint8Array | null = null,
      label: string | null = null,
      reason: string | null = null,
      device: Uint8Array | null = null
    ) {
      this.community_id = community_id;
      this.actor = actor;
      this.post_id = post_id;
      this.label = label;
      this.reason = reason;
      this.device = device;
    }
  }

  @unmanaged
  export class set_label_result {
    static encode(message: set_label_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): set_label_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_label_result();

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

  export class get_community_arguments {
    static encode(message: get_community_arguments, writer: Writer): void {
      const unique_name_id = message.id;
      if (unique_name_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_id);
      }
    }

    static decode(reader: Reader, length: i32): get_community_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_community_arguments();

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

  export class get_community_result {
    static encode(message: get_community_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        community_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_community_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_community_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = community_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: community_record | null;

    constructor(value: community_record | null = null) {
      this.value = value;
    }
  }

  export class get_role_arguments {
    static encode(message: get_role_arguments, writer: Writer): void {
      const unique_name_community_id = message.community_id;
      if (unique_name_community_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_community_id);
      }

      const unique_name_subject = message.subject;
      if (unique_name_subject !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_subject);
      }
    }

    static decode(reader: Reader, length: i32): get_role_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_role_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.community_id = reader.bytes();
            break;

          case 2:
            message.subject = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    community_id: Uint8Array | null;
    subject: Uint8Array | null;

    constructor(
      community_id: Uint8Array | null = null,
      subject: Uint8Array | null = null
    ) {
      this.community_id = community_id;
      this.subject = subject;
    }
  }

  export class get_role_result {
    static encode(message: get_role_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        role_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_role_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_role_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = role_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: role_record | null;

    constructor(value: role_record | null = null) {
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

  export class community_created_event {
    static encode(message: community_created_event, writer: Writer): void {
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

      const unique_name_name = message.name;
      if (unique_name_name !== null) {
        writer.uint32(26);
        writer.string(unique_name_name);
      }

      const unique_name_policy_hash = message.policy_hash;
      if (unique_name_policy_hash !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_policy_hash);
      }

      const unique_name_policy_uri = message.policy_uri;
      if (unique_name_policy_uri !== null) {
        writer.uint32(42);
        writer.string(unique_name_policy_uri);
      }

      if (message.transfer_delay_ms != 0) {
        writer.uint32(48);
        writer.uint64(message.transfer_delay_ms);
      }

      if (message.timestamp != 0) {
        writer.uint32(56);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): community_created_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new community_created_event();

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
            message.name = reader.string();
            break;

          case 4:
            message.policy_hash = reader.bytes();
            break;

          case 5:
            message.policy_uri = reader.string();
            break;

          case 6:
            message.transfer_delay_ms = reader.uint64();
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

    id: Uint8Array | null;
    owner: Uint8Array | null;
    name: string | null;
    policy_hash: Uint8Array | null;
    policy_uri: string | null;
    transfer_delay_ms: u64;
    timestamp: u64;

    constructor(
      id: Uint8Array | null = null,
      owner: Uint8Array | null = null,
      name: string | null = null,
      policy_hash: Uint8Array | null = null,
      policy_uri: string | null = null,
      transfer_delay_ms: u64 = 0,
      timestamp: u64 = 0
    ) {
      this.id = id;
      this.owner = owner;
      this.name = name;
      this.policy_hash = policy_hash;
      this.policy_uri = policy_uri;
      this.transfer_delay_ms = transfer_delay_ms;
      this.timestamp = timestamp;
    }
  }

  export class role_set_event {
    static encode(message: role_set_event, writer: Writer): void {
      const unique_name_community_id = message.community_id;
      if (unique_name_community_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_community_id);
      }

      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_actor);
      }

      const unique_name_subject = message.subject;
      if (unique_name_subject !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_subject);
      }

      if (message.role != 0) {
        writer.uint32(32);
        writer.int32(message.role);
      }

      const unique_name_scope = message.scope;
      if (unique_name_scope !== null) {
        writer.uint32(42);
        writer.bytes(unique_name_scope);
      }

      if (message.expires_at != 0) {
        writer.uint32(48);
        writer.uint64(message.expires_at);
      }

      if (message.timestamp != 0) {
        writer.uint32(56);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): role_set_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new role_set_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.community_id = reader.bytes();
            break;

          case 2:
            message.actor = reader.bytes();
            break;

          case 3:
            message.subject = reader.bytes();
            break;

          case 4:
            message.role = reader.int32();
            break;

          case 5:
            message.scope = reader.bytes();
            break;

          case 6:
            message.expires_at = reader.uint64();
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

    community_id: Uint8Array | null;
    actor: Uint8Array | null;
    subject: Uint8Array | null;
    role: community_role;
    scope: Uint8Array | null;
    expires_at: u64;
    timestamp: u64;

    constructor(
      community_id: Uint8Array | null = null,
      actor: Uint8Array | null = null,
      subject: Uint8Array | null = null,
      role: community_role = 0,
      scope: Uint8Array | null = null,
      expires_at: u64 = 0,
      timestamp: u64 = 0
    ) {
      this.community_id = community_id;
      this.actor = actor;
      this.subject = subject;
      this.role = role;
      this.scope = scope;
      this.expires_at = expires_at;
      this.timestamp = timestamp;
    }
  }

  export class policy_set_event {
    static encode(message: policy_set_event, writer: Writer): void {
      const unique_name_community_id = message.community_id;
      if (unique_name_community_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_community_id);
      }

      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_actor);
      }

      const unique_name_policy_hash = message.policy_hash;
      if (unique_name_policy_hash !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_policy_hash);
      }

      const unique_name_policy_uri = message.policy_uri;
      if (unique_name_policy_uri !== null) {
        writer.uint32(34);
        writer.string(unique_name_policy_uri);
      }

      if (message.timestamp != 0) {
        writer.uint32(40);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): policy_set_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new policy_set_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.community_id = reader.bytes();
            break;

          case 2:
            message.actor = reader.bytes();
            break;

          case 3:
            message.policy_hash = reader.bytes();
            break;

          case 4:
            message.policy_uri = reader.string();
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

    community_id: Uint8Array | null;
    actor: Uint8Array | null;
    policy_hash: Uint8Array | null;
    policy_uri: string | null;
    timestamp: u64;

    constructor(
      community_id: Uint8Array | null = null,
      actor: Uint8Array | null = null,
      policy_hash: Uint8Array | null = null,
      policy_uri: string | null = null,
      timestamp: u64 = 0
    ) {
      this.community_id = community_id;
      this.actor = actor;
      this.policy_hash = policy_hash;
      this.policy_uri = policy_uri;
      this.timestamp = timestamp;
    }
  }

  export class owner_transfer_proposed_event {
    static encode(
      message: owner_transfer_proposed_event,
      writer: Writer
    ): void {
      const unique_name_community_id = message.community_id;
      if (unique_name_community_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_community_id);
      }

      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_owner);
      }

      const unique_name_new_owner = message.new_owner;
      if (unique_name_new_owner !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_new_owner);
      }

      if (message.effective_at != 0) {
        writer.uint32(32);
        writer.uint64(message.effective_at);
      }
    }

    static decode(reader: Reader, length: i32): owner_transfer_proposed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new owner_transfer_proposed_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.community_id = reader.bytes();
            break;

          case 2:
            message.owner = reader.bytes();
            break;

          case 3:
            message.new_owner = reader.bytes();
            break;

          case 4:
            message.effective_at = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    community_id: Uint8Array | null;
    owner: Uint8Array | null;
    new_owner: Uint8Array | null;
    effective_at: u64;

    constructor(
      community_id: Uint8Array | null = null,
      owner: Uint8Array | null = null,
      new_owner: Uint8Array | null = null,
      effective_at: u64 = 0
    ) {
      this.community_id = community_id;
      this.owner = owner;
      this.new_owner = new_owner;
      this.effective_at = effective_at;
    }
  }

  export class owner_transfer_cancelled_event {
    static encode(
      message: owner_transfer_cancelled_event,
      writer: Writer
    ): void {
      const unique_name_community_id = message.community_id;
      if (unique_name_community_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_community_id);
      }

      if (message.timestamp != 0) {
        writer.uint32(16);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): owner_transfer_cancelled_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new owner_transfer_cancelled_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.community_id = reader.bytes();
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

    community_id: Uint8Array | null;
    timestamp: u64;

    constructor(community_id: Uint8Array | null = null, timestamp: u64 = 0) {
      this.community_id = community_id;
      this.timestamp = timestamp;
    }
  }

  export class owner_transferred_event {
    static encode(message: owner_transferred_event, writer: Writer): void {
      const unique_name_community_id = message.community_id;
      if (unique_name_community_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_community_id);
      }

      const unique_name_previous_owner = message.previous_owner;
      if (unique_name_previous_owner !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_previous_owner);
      }

      const unique_name_new_owner = message.new_owner;
      if (unique_name_new_owner !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_new_owner);
      }

      if (message.timestamp != 0) {
        writer.uint32(32);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): owner_transferred_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new owner_transferred_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.community_id = reader.bytes();
            break;

          case 2:
            message.previous_owner = reader.bytes();
            break;

          case 3:
            message.new_owner = reader.bytes();
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

    community_id: Uint8Array | null;
    previous_owner: Uint8Array | null;
    new_owner: Uint8Array | null;
    timestamp: u64;

    constructor(
      community_id: Uint8Array | null = null,
      previous_owner: Uint8Array | null = null,
      new_owner: Uint8Array | null = null,
      timestamp: u64 = 0
    ) {
      this.community_id = community_id;
      this.previous_owner = previous_owner;
      this.new_owner = new_owner;
      this.timestamp = timestamp;
    }
  }

  export class label_set_event {
    static encode(message: label_set_event, writer: Writer): void {
      const unique_name_community_id = message.community_id;
      if (unique_name_community_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_community_id);
      }

      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_actor);
      }

      const unique_name_post_id = message.post_id;
      if (unique_name_post_id !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_post_id);
      }

      const unique_name_label = message.label;
      if (unique_name_label !== null) {
        writer.uint32(34);
        writer.string(unique_name_label);
      }

      const unique_name_reason = message.reason;
      if (unique_name_reason !== null) {
        writer.uint32(42);
        writer.string(unique_name_reason);
      }

      if (message.timestamp != 0) {
        writer.uint32(48);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): label_set_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new label_set_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.community_id = reader.bytes();
            break;

          case 2:
            message.actor = reader.bytes();
            break;

          case 3:
            message.post_id = reader.bytes();
            break;

          case 4:
            message.label = reader.string();
            break;

          case 5:
            message.reason = reader.string();
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

    community_id: Uint8Array | null;
    actor: Uint8Array | null;
    post_id: Uint8Array | null;
    label: string | null;
    reason: string | null;
    timestamp: u64;

    constructor(
      community_id: Uint8Array | null = null,
      actor: Uint8Array | null = null,
      post_id: Uint8Array | null = null,
      label: string | null = null,
      reason: string | null = null,
      timestamp: u64 = 0
    ) {
      this.community_id = community_id;
      this.actor = actor;
      this.post_id = post_id;
      this.label = label;
      this.reason = reason;
      this.timestamp = timestamp;
    }
  }

  export enum community_role {
    none = 0,
    guest = 1,
    member = 2,
    moderator = 3,
    admin = 4,
    owner = 5,
    banned = 6,
  }
}
