import { Writer, Reader } from "as-proto";

export namespace identity {
  export class identity_record {
    static encode(message: identity_record, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_owner);
      }

      const unique_name_encryption_key = message.encryption_key;
      if (unique_name_encryption_key !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_encryption_key);
      }

      if (message.key_version != 0) {
        writer.uint32(32);
        writer.uint32(message.key_version);
      }

      const unique_name_profile_hash = message.profile_hash;
      if (unique_name_profile_hash !== null) {
        writer.uint32(42);
        writer.bytes(unique_name_profile_hash);
      }

      const unique_name_profile_uri = message.profile_uri;
      if (unique_name_profile_uri !== null) {
        writer.uint32(50);
        writer.string(unique_name_profile_uri);
      }

      if (message.protocol_version != 0) {
        writer.uint32(56);
        writer.uint32(message.protocol_version);
      }

      if (message.device_epoch != 0) {
        writer.uint32(64);
        writer.uint32(message.device_epoch);
      }

      if (message.registered_at != 0) {
        writer.uint32(72);
        writer.uint64(message.registered_at);
      }

      if (message.updated_at != 0) {
        writer.uint32(80);
        writer.uint64(message.updated_at);
      }
    }

    static decode(reader: Reader, length: i32): identity_record {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new identity_record();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.owner = reader.bytes();
            break;

          case 3:
            message.encryption_key = reader.bytes();
            break;

          case 4:
            message.key_version = reader.uint32();
            break;

          case 5:
            message.profile_hash = reader.bytes();
            break;

          case 6:
            message.profile_uri = reader.string();
            break;

          case 7:
            message.protocol_version = reader.uint32();
            break;

          case 8:
            message.device_epoch = reader.uint32();
            break;

          case 9:
            message.registered_at = reader.uint64();
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

    account: Uint8Array | null;
    owner: Uint8Array | null;
    encryption_key: Uint8Array | null;
    key_version: u32;
    profile_hash: Uint8Array | null;
    profile_uri: string | null;
    protocol_version: u32;
    device_epoch: u32;
    registered_at: u64;
    updated_at: u64;

    constructor(
      account: Uint8Array | null = null,
      owner: Uint8Array | null = null,
      encryption_key: Uint8Array | null = null,
      key_version: u32 = 0,
      profile_hash: Uint8Array | null = null,
      profile_uri: string | null = null,
      protocol_version: u32 = 0,
      device_epoch: u32 = 0,
      registered_at: u64 = 0,
      updated_at: u64 = 0
    ) {
      this.account = account;
      this.owner = owner;
      this.encryption_key = encryption_key;
      this.key_version = key_version;
      this.profile_hash = profile_hash;
      this.profile_uri = profile_uri;
      this.protocol_version = protocol_version;
      this.device_epoch = device_epoch;
      this.registered_at = registered_at;
      this.updated_at = updated_at;
    }
  }

  export class device_record {
    static encode(message: device_record, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_device);
      }

      if (message.capabilities != 0) {
        writer.uint32(24);
        writer.uint32(message.capabilities);
      }

      if (message.expires_at != 0) {
        writer.uint32(32);
        writer.uint64(message.expires_at);
      }

      if (message.device_epoch != 0) {
        writer.uint32(40);
        writer.uint32(message.device_epoch);
      }

      if (message.revoked != false) {
        writer.uint32(48);
        writer.bool(message.revoked);
      }

      const unique_name_label = message.label;
      if (unique_name_label !== null) {
        writer.uint32(58);
        writer.string(unique_name_label);
      }

      if (message.authorized_at != 0) {
        writer.uint32(64);
        writer.uint64(message.authorized_at);
      }
    }

    static decode(reader: Reader, length: i32): device_record {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new device_record();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.device = reader.bytes();
            break;

          case 3:
            message.capabilities = reader.uint32();
            break;

          case 4:
            message.expires_at = reader.uint64();
            break;

          case 5:
            message.device_epoch = reader.uint32();
            break;

          case 6:
            message.revoked = reader.bool();
            break;

          case 7:
            message.label = reader.string();
            break;

          case 8:
            message.authorized_at = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    account: Uint8Array | null;
    device: Uint8Array | null;
    capabilities: u32;
    expires_at: u64;
    device_epoch: u32;
    revoked: bool;
    label: string | null;
    authorized_at: u64;

    constructor(
      account: Uint8Array | null = null,
      device: Uint8Array | null = null,
      capabilities: u32 = 0,
      expires_at: u64 = 0,
      device_epoch: u32 = 0,
      revoked: bool = false,
      label: string | null = null,
      authorized_at: u64 = 0
    ) {
      this.account = account;
      this.device = device;
      this.capabilities = capabilities;
      this.expires_at = expires_at;
      this.device_epoch = device_epoch;
      this.revoked = revoked;
      this.label = label;
      this.authorized_at = authorized_at;
    }
  }

  export class recovery_policy {
    static encode(message: recovery_policy, writer: Writer): void {
      const unique_name_guardians = message.guardians;
      if (unique_name_guardians.length !== 0) {
        for (let i = 0; i < unique_name_guardians.length; ++i) {
          writer.uint32(10);
          writer.bytes(unique_name_guardians[i]);
        }
      }

      if (message.threshold != 0) {
        writer.uint32(16);
        writer.uint32(message.threshold);
      }

      if (message.delay_ms != 0) {
        writer.uint32(24);
        writer.uint64(message.delay_ms);
      }
    }

    static decode(reader: Reader, length: i32): recovery_policy {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new recovery_policy();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.guardians.push(reader.bytes());
            break;

          case 2:
            message.threshold = reader.uint32();
            break;

          case 3:
            message.delay_ms = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    guardians: Array<Uint8Array>;
    threshold: u32;
    delay_ms: u64;

    constructor(
      guardians: Array<Uint8Array> = [],
      threshold: u32 = 0,
      delay_ms: u64 = 0
    ) {
      this.guardians = guardians;
      this.threshold = threshold;
      this.delay_ms = delay_ms;
    }
  }

  export class pending_policy {
    static encode(message: pending_policy, writer: Writer): void {
      const unique_name_policy = message.policy;
      if (unique_name_policy !== null) {
        writer.uint32(10);
        writer.fork();
        recovery_policy.encode(unique_name_policy, writer);
        writer.ldelim();
      }

      if (message.effective_at != 0) {
        writer.uint32(16);
        writer.uint64(message.effective_at);
      }
    }

    static decode(reader: Reader, length: i32): pending_policy {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new pending_policy();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.policy = recovery_policy.decode(reader, reader.uint32());
            break;

          case 2:
            message.effective_at = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    policy: recovery_policy | null;
    effective_at: u64;

    constructor(policy: recovery_policy | null = null, effective_at: u64 = 0) {
      this.policy = policy;
      this.effective_at = effective_at;
    }
  }

  export class pending_recovery {
    static encode(message: pending_recovery, writer: Writer): void {
      const unique_name_new_owner = message.new_owner;
      if (unique_name_new_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_new_owner);
      }

      const unique_name_approvals = message.approvals;
      if (unique_name_approvals.length !== 0) {
        for (let i = 0; i < unique_name_approvals.length; ++i) {
          writer.uint32(18);
          writer.bytes(unique_name_approvals[i]);
        }
      }

      if (message.effective_at != 0) {
        writer.uint32(24);
        writer.uint64(message.effective_at);
      }

      if (message.proposed_at != 0) {
        writer.uint32(32);
        writer.uint64(message.proposed_at);
      }
    }

    static decode(reader: Reader, length: i32): pending_recovery {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new pending_recovery();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.new_owner = reader.bytes();
            break;

          case 2:
            message.approvals.push(reader.bytes());
            break;

          case 3:
            message.effective_at = reader.uint64();
            break;

          case 4:
            message.proposed_at = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    new_owner: Uint8Array | null;
    approvals: Array<Uint8Array>;
    effective_at: u64;
    proposed_at: u64;

    constructor(
      new_owner: Uint8Array | null = null,
      approvals: Array<Uint8Array> = [],
      effective_at: u64 = 0,
      proposed_at: u64 = 0
    ) {
      this.new_owner = new_owner;
      this.approvals = approvals;
      this.effective_at = effective_at;
      this.proposed_at = proposed_at;
    }
  }

  export class recovery_state {
    static encode(message: recovery_state, writer: Writer): void {
      const unique_name_policy = message.policy;
      if (unique_name_policy !== null) {
        writer.uint32(10);
        writer.fork();
        recovery_policy.encode(unique_name_policy, writer);
        writer.ldelim();
      }

      const unique_name_pending_policy = message.pending_policy;
      if (unique_name_pending_policy !== null) {
        writer.uint32(18);
        writer.fork();
        pending_policy.encode(unique_name_pending_policy, writer);
        writer.ldelim();
      }

      const unique_name_pending_recovery = message.pending_recovery;
      if (unique_name_pending_recovery !== null) {
        writer.uint32(26);
        writer.fork();
        pending_recovery.encode(unique_name_pending_recovery, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): recovery_state {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new recovery_state();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.policy = recovery_policy.decode(reader, reader.uint32());
            break;

          case 2:
            message.pending_policy = pending_policy.decode(
              reader,
              reader.uint32()
            );
            break;

          case 3:
            message.pending_recovery = pending_recovery.decode(
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

    policy: recovery_policy | null;
    pending_policy: pending_policy | null;
    pending_recovery: pending_recovery | null;

    constructor(
      policy: recovery_policy | null = null,
      pending_policy: pending_policy | null = null,
      pending_recovery: pending_recovery | null = null
    ) {
      this.policy = policy;
      this.pending_policy = pending_policy;
      this.pending_recovery = pending_recovery;
    }
  }

  export class register_arguments {
    static encode(message: register_arguments, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_encryption_key = message.encryption_key;
      if (unique_name_encryption_key !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_encryption_key);
      }

      if (message.key_version != 0) {
        writer.uint32(24);
        writer.uint32(message.key_version);
      }

      const unique_name_profile_hash = message.profile_hash;
      if (unique_name_profile_hash !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_profile_hash);
      }

      const unique_name_profile_uri = message.profile_uri;
      if (unique_name_profile_uri !== null) {
        writer.uint32(42);
        writer.string(unique_name_profile_uri);
      }
    }

    static decode(reader: Reader, length: i32): register_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new register_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.encryption_key = reader.bytes();
            break;

          case 3:
            message.key_version = reader.uint32();
            break;

          case 4:
            message.profile_hash = reader.bytes();
            break;

          case 5:
            message.profile_uri = reader.string();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    account: Uint8Array | null;
    encryption_key: Uint8Array | null;
    key_version: u32;
    profile_hash: Uint8Array | null;
    profile_uri: string | null;

    constructor(
      account: Uint8Array | null = null,
      encryption_key: Uint8Array | null = null,
      key_version: u32 = 0,
      profile_hash: Uint8Array | null = null,
      profile_uri: string | null = null
    ) {
      this.account = account;
      this.encryption_key = encryption_key;
      this.key_version = key_version;
      this.profile_hash = profile_hash;
      this.profile_uri = profile_uri;
    }
  }

  @unmanaged
  export class register_result {
    static encode(message: register_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): register_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new register_result();

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

  export class update_profile_arguments {
    static encode(message: update_profile_arguments, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_profile_hash = message.profile_hash;
      if (unique_name_profile_hash !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_profile_hash);
      }

      const unique_name_profile_uri = message.profile_uri;
      if (unique_name_profile_uri !== null) {
        writer.uint32(26);
        writer.string(unique_name_profile_uri);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): update_profile_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new update_profile_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.profile_hash = reader.bytes();
            break;

          case 3:
            message.profile_uri = reader.string();
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

    account: Uint8Array | null;
    profile_hash: Uint8Array | null;
    profile_uri: string | null;
    device: Uint8Array | null;

    constructor(
      account: Uint8Array | null = null,
      profile_hash: Uint8Array | null = null,
      profile_uri: string | null = null,
      device: Uint8Array | null = null
    ) {
      this.account = account;
      this.profile_hash = profile_hash;
      this.profile_uri = profile_uri;
      this.device = device;
    }
  }

  @unmanaged
  export class update_profile_result {
    static encode(message: update_profile_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): update_profile_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new update_profile_result();

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

  export class rotate_encryption_key_arguments {
    static encode(
      message: rotate_encryption_key_arguments,
      writer: Writer
    ): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_encryption_key = message.encryption_key;
      if (unique_name_encryption_key !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_encryption_key);
      }

      if (message.key_version != 0) {
        writer.uint32(24);
        writer.uint32(message.key_version);
      }
    }

    static decode(
      reader: Reader,
      length: i32
    ): rotate_encryption_key_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new rotate_encryption_key_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.encryption_key = reader.bytes();
            break;

          case 3:
            message.key_version = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    account: Uint8Array | null;
    encryption_key: Uint8Array | null;
    key_version: u32;

    constructor(
      account: Uint8Array | null = null,
      encryption_key: Uint8Array | null = null,
      key_version: u32 = 0
    ) {
      this.account = account;
      this.encryption_key = encryption_key;
      this.key_version = key_version;
    }
  }

  @unmanaged
  export class rotate_encryption_key_result {
    static encode(
      message: rotate_encryption_key_result,
      writer: Writer
    ): void {}

    static decode(reader: Reader, length: i32): rotate_encryption_key_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new rotate_encryption_key_result();

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

  export class authorize_device_arguments {
    static encode(message: authorize_device_arguments, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_device);
      }

      if (message.capabilities != 0) {
        writer.uint32(24);
        writer.uint32(message.capabilities);
      }

      if (message.expires_at != 0) {
        writer.uint32(32);
        writer.uint64(message.expires_at);
      }

      const unique_name_label = message.label;
      if (unique_name_label !== null) {
        writer.uint32(42);
        writer.string(unique_name_label);
      }
    }

    static decode(reader: Reader, length: i32): authorize_device_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new authorize_device_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.device = reader.bytes();
            break;

          case 3:
            message.capabilities = reader.uint32();
            break;

          case 4:
            message.expires_at = reader.uint64();
            break;

          case 5:
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
    device: Uint8Array | null;
    capabilities: u32;
    expires_at: u64;
    label: string | null;

    constructor(
      account: Uint8Array | null = null,
      device: Uint8Array | null = null,
      capabilities: u32 = 0,
      expires_at: u64 = 0,
      label: string | null = null
    ) {
      this.account = account;
      this.device = device;
      this.capabilities = capabilities;
      this.expires_at = expires_at;
      this.label = label;
    }
  }

  @unmanaged
  export class authorize_device_result {
    static encode(message: authorize_device_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): authorize_device_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new authorize_device_result();

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

  export class revoke_device_arguments {
    static encode(message: revoke_device_arguments, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): revoke_device_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new revoke_device_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
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

    account: Uint8Array | null;
    device: Uint8Array | null;

    constructor(
      account: Uint8Array | null = null,
      device: Uint8Array | null = null
    ) {
      this.account = account;
      this.device = device;
    }
  }

  @unmanaged
  export class revoke_device_result {
    static encode(message: revoke_device_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): revoke_device_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new revoke_device_result();

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

  export class set_recovery_policy_arguments {
    static encode(
      message: set_recovery_policy_arguments,
      writer: Writer
    ): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_policy = message.policy;
      if (unique_name_policy !== null) {
        writer.uint32(18);
        writer.fork();
        recovery_policy.encode(unique_name_policy, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): set_recovery_policy_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_recovery_policy_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.policy = recovery_policy.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    account: Uint8Array | null;
    policy: recovery_policy | null;

    constructor(
      account: Uint8Array | null = null,
      policy: recovery_policy | null = null
    ) {
      this.account = account;
      this.policy = policy;
    }
  }

  @unmanaged
  export class set_recovery_policy_result {
    static encode(message: set_recovery_policy_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): set_recovery_policy_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_recovery_policy_result();

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

  export class apply_recovery_policy_arguments {
    static encode(
      message: apply_recovery_policy_arguments,
      writer: Writer
    ): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }
    }

    static decode(
      reader: Reader,
      length: i32
    ): apply_recovery_policy_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new apply_recovery_policy_arguments();

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
  export class apply_recovery_policy_result {
    static encode(
      message: apply_recovery_policy_result,
      writer: Writer
    ): void {}

    static decode(reader: Reader, length: i32): apply_recovery_policy_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new apply_recovery_policy_result();

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

  export class cancel_recovery_policy_arguments {
    static encode(
      message: cancel_recovery_policy_arguments,
      writer: Writer
    ): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }
    }

    static decode(
      reader: Reader,
      length: i32
    ): cancel_recovery_policy_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new cancel_recovery_policy_arguments();

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
  export class cancel_recovery_policy_result {
    static encode(
      message: cancel_recovery_policy_result,
      writer: Writer
    ): void {}

    static decode(reader: Reader, length: i32): cancel_recovery_policy_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new cancel_recovery_policy_result();

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

  export class propose_recovery_arguments {
    static encode(message: propose_recovery_arguments, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_guardian = message.guardian;
      if (unique_name_guardian !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_guardian);
      }

      const unique_name_new_owner = message.new_owner;
      if (unique_name_new_owner !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_new_owner);
      }
    }

    static decode(reader: Reader, length: i32): propose_recovery_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new propose_recovery_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.guardian = reader.bytes();
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

    account: Uint8Array | null;
    guardian: Uint8Array | null;
    new_owner: Uint8Array | null;

    constructor(
      account: Uint8Array | null = null,
      guardian: Uint8Array | null = null,
      new_owner: Uint8Array | null = null
    ) {
      this.account = account;
      this.guardian = guardian;
      this.new_owner = new_owner;
    }
  }

  @unmanaged
  export class propose_recovery_result {
    static encode(message: propose_recovery_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): propose_recovery_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new propose_recovery_result();

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

  export class cancel_recovery_arguments {
    static encode(message: cancel_recovery_arguments, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }
    }

    static decode(reader: Reader, length: i32): cancel_recovery_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new cancel_recovery_arguments();

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
  export class cancel_recovery_result {
    static encode(message: cancel_recovery_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): cancel_recovery_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new cancel_recovery_result();

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

  export class execute_recovery_arguments {
    static encode(message: execute_recovery_arguments, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }
    }

    static decode(reader: Reader, length: i32): execute_recovery_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new execute_recovery_arguments();

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
  export class execute_recovery_result {
    static encode(message: execute_recovery_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): execute_recovery_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new execute_recovery_result();

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

  export class get_identity_arguments {
    static encode(message: get_identity_arguments, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }
    }

    static decode(reader: Reader, length: i32): get_identity_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_identity_arguments();

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

  export class get_identity_result {
    static encode(message: get_identity_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        identity_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_identity_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_identity_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = identity_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: identity_record | null;

    constructor(value: identity_record | null = null) {
      this.value = value;
    }
  }

  export class get_device_arguments {
    static encode(message: get_device_arguments, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): get_device_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_device_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
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

    account: Uint8Array | null;
    device: Uint8Array | null;

    constructor(
      account: Uint8Array | null = null,
      device: Uint8Array | null = null
    ) {
      this.account = account;
      this.device = device;
    }
  }

  export class get_device_result {
    static encode(message: get_device_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        device_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_device_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_device_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = device_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: device_record | null;

    constructor(value: device_record | null = null) {
      this.value = value;
    }
  }

  export class get_recovery_arguments {
    static encode(message: get_recovery_arguments, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }
    }

    static decode(reader: Reader, length: i32): get_recovery_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_recovery_arguments();

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

  export class get_recovery_result {
    static encode(message: get_recovery_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        recovery_state.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_recovery_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_recovery_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = recovery_state.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: recovery_state | null;

    constructor(value: recovery_state | null = null) {
      this.value = value;
    }
  }

  export class resolve_actor_arguments {
    static encode(message: resolve_actor_arguments, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_device);
      }

      if (message.capability != 0) {
        writer.uint32(24);
        writer.uint32(message.capability);
      }
    }

    static decode(reader: Reader, length: i32): resolve_actor_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new resolve_actor_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.device = reader.bytes();
            break;

          case 3:
            message.capability = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    account: Uint8Array | null;
    device: Uint8Array | null;
    capability: u32;

    constructor(
      account: Uint8Array | null = null,
      device: Uint8Array | null = null,
      capability: u32 = 0
    ) {
      this.account = account;
      this.device = device;
      this.capability = capability;
    }
  }

  export class resolve_actor_result {
    static encode(message: resolve_actor_result, writer: Writer): void {
      if (message.ok != false) {
        writer.uint32(8);
        writer.bool(message.ok);
      }

      const unique_name_signer = message.signer;
      if (unique_name_signer !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_signer);
      }

      const unique_name_reason = message.reason;
      if (unique_name_reason !== null) {
        writer.uint32(26);
        writer.string(unique_name_reason);
      }
    }

    static decode(reader: Reader, length: i32): resolve_actor_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new resolve_actor_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.ok = reader.bool();
            break;

          case 2:
            message.signer = reader.bytes();
            break;

          case 3:
            message.reason = reader.string();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    ok: bool;
    signer: Uint8Array | null;
    reason: string | null;

    constructor(
      ok: bool = false,
      signer: Uint8Array | null = null,
      reason: string | null = null
    ) {
      this.ok = ok;
      this.signer = signer;
      this.reason = reason;
    }
  }

  export class registered_event {
    static encode(message: registered_event, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_encryption_key = message.encryption_key;
      if (unique_name_encryption_key !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_encryption_key);
      }

      if (message.key_version != 0) {
        writer.uint32(24);
        writer.uint32(message.key_version);
      }

      const unique_name_profile_hash = message.profile_hash;
      if (unique_name_profile_hash !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_profile_hash);
      }

      const unique_name_profile_uri = message.profile_uri;
      if (unique_name_profile_uri !== null) {
        writer.uint32(42);
        writer.string(unique_name_profile_uri);
      }

      if (message.protocol_version != 0) {
        writer.uint32(48);
        writer.uint32(message.protocol_version);
      }

      if (message.timestamp != 0) {
        writer.uint32(56);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): registered_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new registered_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.encryption_key = reader.bytes();
            break;

          case 3:
            message.key_version = reader.uint32();
            break;

          case 4:
            message.profile_hash = reader.bytes();
            break;

          case 5:
            message.profile_uri = reader.string();
            break;

          case 6:
            message.protocol_version = reader.uint32();
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

    account: Uint8Array | null;
    encryption_key: Uint8Array | null;
    key_version: u32;
    profile_hash: Uint8Array | null;
    profile_uri: string | null;
    protocol_version: u32;
    timestamp: u64;

    constructor(
      account: Uint8Array | null = null,
      encryption_key: Uint8Array | null = null,
      key_version: u32 = 0,
      profile_hash: Uint8Array | null = null,
      profile_uri: string | null = null,
      protocol_version: u32 = 0,
      timestamp: u64 = 0
    ) {
      this.account = account;
      this.encryption_key = encryption_key;
      this.key_version = key_version;
      this.profile_hash = profile_hash;
      this.profile_uri = profile_uri;
      this.protocol_version = protocol_version;
      this.timestamp = timestamp;
    }
  }

  export class profile_updated_event {
    static encode(message: profile_updated_event, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_profile_hash = message.profile_hash;
      if (unique_name_profile_hash !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_profile_hash);
      }

      const unique_name_profile_uri = message.profile_uri;
      if (unique_name_profile_uri !== null) {
        writer.uint32(26);
        writer.string(unique_name_profile_uri);
      }

      if (message.timestamp != 0) {
        writer.uint32(32);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): profile_updated_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new profile_updated_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.profile_hash = reader.bytes();
            break;

          case 3:
            message.profile_uri = reader.string();
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
    profile_hash: Uint8Array | null;
    profile_uri: string | null;
    timestamp: u64;

    constructor(
      account: Uint8Array | null = null,
      profile_hash: Uint8Array | null = null,
      profile_uri: string | null = null,
      timestamp: u64 = 0
    ) {
      this.account = account;
      this.profile_hash = profile_hash;
      this.profile_uri = profile_uri;
      this.timestamp = timestamp;
    }
  }

  export class key_rotated_event {
    static encode(message: key_rotated_event, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      if (message.previous_version != 0) {
        writer.uint32(16);
        writer.uint32(message.previous_version);
      }

      const unique_name_encryption_key = message.encryption_key;
      if (unique_name_encryption_key !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_encryption_key);
      }

      if (message.key_version != 0) {
        writer.uint32(32);
        writer.uint32(message.key_version);
      }

      if (message.timestamp != 0) {
        writer.uint32(40);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): key_rotated_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new key_rotated_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.previous_version = reader.uint32();
            break;

          case 3:
            message.encryption_key = reader.bytes();
            break;

          case 4:
            message.key_version = reader.uint32();
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

    account: Uint8Array | null;
    previous_version: u32;
    encryption_key: Uint8Array | null;
    key_version: u32;
    timestamp: u64;

    constructor(
      account: Uint8Array | null = null,
      previous_version: u32 = 0,
      encryption_key: Uint8Array | null = null,
      key_version: u32 = 0,
      timestamp: u64 = 0
    ) {
      this.account = account;
      this.previous_version = previous_version;
      this.encryption_key = encryption_key;
      this.key_version = key_version;
      this.timestamp = timestamp;
    }
  }

  export class device_authorized_event {
    static encode(message: device_authorized_event, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_device);
      }

      if (message.capabilities != 0) {
        writer.uint32(24);
        writer.uint32(message.capabilities);
      }

      if (message.expires_at != 0) {
        writer.uint32(32);
        writer.uint64(message.expires_at);
      }

      const unique_name_label = message.label;
      if (unique_name_label !== null) {
        writer.uint32(42);
        writer.string(unique_name_label);
      }

      if (message.device_epoch != 0) {
        writer.uint32(48);
        writer.uint32(message.device_epoch);
      }

      if (message.timestamp != 0) {
        writer.uint32(56);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): device_authorized_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new device_authorized_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.device = reader.bytes();
            break;

          case 3:
            message.capabilities = reader.uint32();
            break;

          case 4:
            message.expires_at = reader.uint64();
            break;

          case 5:
            message.label = reader.string();
            break;

          case 6:
            message.device_epoch = reader.uint32();
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

    account: Uint8Array | null;
    device: Uint8Array | null;
    capabilities: u32;
    expires_at: u64;
    label: string | null;
    device_epoch: u32;
    timestamp: u64;

    constructor(
      account: Uint8Array | null = null,
      device: Uint8Array | null = null,
      capabilities: u32 = 0,
      expires_at: u64 = 0,
      label: string | null = null,
      device_epoch: u32 = 0,
      timestamp: u64 = 0
    ) {
      this.account = account;
      this.device = device;
      this.capabilities = capabilities;
      this.expires_at = expires_at;
      this.label = label;
      this.device_epoch = device_epoch;
      this.timestamp = timestamp;
    }
  }

  export class device_revoked_event {
    static encode(message: device_revoked_event, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_device);
      }

      if (message.timestamp != 0) {
        writer.uint32(24);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): device_revoked_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new device_revoked_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.device = reader.bytes();
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

    account: Uint8Array | null;
    device: Uint8Array | null;
    timestamp: u64;

    constructor(
      account: Uint8Array | null = null,
      device: Uint8Array | null = null,
      timestamp: u64 = 0
    ) {
      this.account = account;
      this.device = device;
      this.timestamp = timestamp;
    }
  }

  export class recovery_policy_proposed_event {
    static encode(
      message: recovery_policy_proposed_event,
      writer: Writer
    ): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_policy = message.policy;
      if (unique_name_policy !== null) {
        writer.uint32(18);
        writer.fork();
        recovery_policy.encode(unique_name_policy, writer);
        writer.ldelim();
      }

      if (message.effective_at != 0) {
        writer.uint32(24);
        writer.uint64(message.effective_at);
      }
    }

    static decode(reader: Reader, length: i32): recovery_policy_proposed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new recovery_policy_proposed_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.policy = recovery_policy.decode(reader, reader.uint32());
            break;

          case 3:
            message.effective_at = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    account: Uint8Array | null;
    policy: recovery_policy | null;
    effective_at: u64;

    constructor(
      account: Uint8Array | null = null,
      policy: recovery_policy | null = null,
      effective_at: u64 = 0
    ) {
      this.account = account;
      this.policy = policy;
      this.effective_at = effective_at;
    }
  }

  export class recovery_policy_set_event {
    static encode(message: recovery_policy_set_event, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_policy = message.policy;
      if (unique_name_policy !== null) {
        writer.uint32(18);
        writer.fork();
        recovery_policy.encode(unique_name_policy, writer);
        writer.ldelim();
      }

      if (message.timestamp != 0) {
        writer.uint32(24);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): recovery_policy_set_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new recovery_policy_set_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.policy = recovery_policy.decode(reader, reader.uint32());
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

    account: Uint8Array | null;
    policy: recovery_policy | null;
    timestamp: u64;

    constructor(
      account: Uint8Array | null = null,
      policy: recovery_policy | null = null,
      timestamp: u64 = 0
    ) {
      this.account = account;
      this.policy = policy;
      this.timestamp = timestamp;
    }
  }

  export class recovery_policy_cancelled_event {
    static encode(
      message: recovery_policy_cancelled_event,
      writer: Writer
    ): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      if (message.timestamp != 0) {
        writer.uint32(16);
        writer.uint64(message.timestamp);
      }
    }

    static decode(
      reader: Reader,
      length: i32
    ): recovery_policy_cancelled_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new recovery_policy_cancelled_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
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

    account: Uint8Array | null;
    timestamp: u64;

    constructor(account: Uint8Array | null = null, timestamp: u64 = 0) {
      this.account = account;
      this.timestamp = timestamp;
    }
  }

  export class recovery_proposed_event {
    static encode(message: recovery_proposed_event, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_guardian = message.guardian;
      if (unique_name_guardian !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_guardian);
      }

      const unique_name_new_owner = message.new_owner;
      if (unique_name_new_owner !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_new_owner);
      }

      if (message.approvals != 0) {
        writer.uint32(32);
        writer.uint32(message.approvals);
      }

      if (message.threshold != 0) {
        writer.uint32(40);
        writer.uint32(message.threshold);
      }

      if (message.effective_at != 0) {
        writer.uint32(48);
        writer.uint64(message.effective_at);
      }

      if (message.timestamp != 0) {
        writer.uint32(56);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): recovery_proposed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new recovery_proposed_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.guardian = reader.bytes();
            break;

          case 3:
            message.new_owner = reader.bytes();
            break;

          case 4:
            message.approvals = reader.uint32();
            break;

          case 5:
            message.threshold = reader.uint32();
            break;

          case 6:
            message.effective_at = reader.uint64();
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

    account: Uint8Array | null;
    guardian: Uint8Array | null;
    new_owner: Uint8Array | null;
    approvals: u32;
    threshold: u32;
    effective_at: u64;
    timestamp: u64;

    constructor(
      account: Uint8Array | null = null,
      guardian: Uint8Array | null = null,
      new_owner: Uint8Array | null = null,
      approvals: u32 = 0,
      threshold: u32 = 0,
      effective_at: u64 = 0,
      timestamp: u64 = 0
    ) {
      this.account = account;
      this.guardian = guardian;
      this.new_owner = new_owner;
      this.approvals = approvals;
      this.threshold = threshold;
      this.effective_at = effective_at;
      this.timestamp = timestamp;
    }
  }

  export class recovery_cancelled_event {
    static encode(message: recovery_cancelled_event, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      if (message.timestamp != 0) {
        writer.uint32(16);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): recovery_cancelled_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new recovery_cancelled_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
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

    account: Uint8Array | null;
    timestamp: u64;

    constructor(account: Uint8Array | null = null, timestamp: u64 = 0) {
      this.account = account;
      this.timestamp = timestamp;
    }
  }

  export class recovered_event {
    static encode(message: recovered_event, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
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

      if (message.device_epoch != 0) {
        writer.uint32(32);
        writer.uint32(message.device_epoch);
      }

      if (message.timestamp != 0) {
        writer.uint32(40);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): recovered_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new recovered_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.previous_owner = reader.bytes();
            break;

          case 3:
            message.new_owner = reader.bytes();
            break;

          case 4:
            message.device_epoch = reader.uint32();
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

    account: Uint8Array | null;
    previous_owner: Uint8Array | null;
    new_owner: Uint8Array | null;
    device_epoch: u32;
    timestamp: u64;

    constructor(
      account: Uint8Array | null = null,
      previous_owner: Uint8Array | null = null,
      new_owner: Uint8Array | null = null,
      device_epoch: u32 = 0,
      timestamp: u64 = 0
    ) {
      this.account = account;
      this.previous_owner = previous_owner;
      this.new_owner = new_owner;
      this.device_epoch = device_epoch;
      this.timestamp = timestamp;
    }
  }
}
