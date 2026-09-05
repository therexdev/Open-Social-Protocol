import { Writer, Reader } from "as-proto";

export namespace sponsorship {
  export class allowed_call {
    static encode(message: allowed_call, writer: Writer): void {
      const unique_name_contract_id = message.contract_id;
      if (unique_name_contract_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_contract_id);
      }

      const unique_name_entry_points = message.entry_points;
      if (unique_name_entry_points.length !== 0) {
        for (let i = 0; i < unique_name_entry_points.length; ++i) {
          writer.uint32(16);
          writer.uint32(unique_name_entry_points[i]);
        }
      }
    }

    static decode(reader: Reader, length: i32): allowed_call {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new allowed_call();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.contract_id = reader.bytes();
            break;

          case 2:
            message.entry_points.push(reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    contract_id: Uint8Array | null;
    entry_points: Array<u32>;

    constructor(
      contract_id: Uint8Array | null = null,
      entry_points: Array<u32> = []
    ) {
      this.contract_id = contract_id;
      this.entry_points = entry_points;
    }
  }

  export class sponsor_record {
    static encode(message: sponsor_record, writer: Writer): void {
      const unique_name_sponsor = message.sponsor;
      if (unique_name_sponsor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_sponsor);
      }

      const unique_name_endpoint = message.endpoint;
      if (unique_name_endpoint !== null) {
        writer.uint32(18);
        writer.string(unique_name_endpoint);
      }

      const unique_name_policy_uri = message.policy_uri;
      if (unique_name_policy_uri !== null) {
        writer.uint32(26);
        writer.string(unique_name_policy_uri);
      }

      if (message.policy_version != 0) {
        writer.uint32(32);
        writer.uint32(message.policy_version);
      }

      const unique_name_allowed = message.allowed;
      for (let i = 0; i < unique_name_allowed.length; ++i) {
        writer.uint32(42);
        writer.fork();
        allowed_call.encode(unique_name_allowed[i], writer);
        writer.ldelim();
      }

      if (message.max_rc_per_op != 0) {
        writer.uint32(48);
        writer.uint64(message.max_rc_per_op);
      }

      if (message.max_ops_per_user_per_day != 0) {
        writer.uint32(56);
        writer.uint32(message.max_ops_per_user_per_day);
      }

      if (message.max_bytes_per_op != 0) {
        writer.uint32(64);
        writer.uint32(message.max_bytes_per_op);
      }

      if (message.active != false) {
        writer.uint32(72);
        writer.bool(message.active);
      }

      if (message.registered_at != 0) {
        writer.uint32(80);
        writer.uint64(message.registered_at);
      }

      if (message.updated_at != 0) {
        writer.uint32(88);
        writer.uint64(message.updated_at);
      }
    }

    static decode(reader: Reader, length: i32): sponsor_record {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new sponsor_record();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.sponsor = reader.bytes();
            break;

          case 2:
            message.endpoint = reader.string();
            break;

          case 3:
            message.policy_uri = reader.string();
            break;

          case 4:
            message.policy_version = reader.uint32();
            break;

          case 5:
            message.allowed.push(allowed_call.decode(reader, reader.uint32()));
            break;

          case 6:
            message.max_rc_per_op = reader.uint64();
            break;

          case 7:
            message.max_ops_per_user_per_day = reader.uint32();
            break;

          case 8:
            message.max_bytes_per_op = reader.uint32();
            break;

          case 9:
            message.active = reader.bool();
            break;

          case 10:
            message.registered_at = reader.uint64();
            break;

          case 11:
            message.updated_at = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    sponsor: Uint8Array | null;
    endpoint: string | null;
    policy_uri: string | null;
    policy_version: u32;
    allowed: Array<allowed_call>;
    max_rc_per_op: u64;
    max_ops_per_user_per_day: u32;
    max_bytes_per_op: u32;
    active: bool;
    registered_at: u64;
    updated_at: u64;

    constructor(
      sponsor: Uint8Array | null = null,
      endpoint: string | null = null,
      policy_uri: string | null = null,
      policy_version: u32 = 0,
      allowed: Array<allowed_call> = [],
      max_rc_per_op: u64 = 0,
      max_ops_per_user_per_day: u32 = 0,
      max_bytes_per_op: u32 = 0,
      active: bool = false,
      registered_at: u64 = 0,
      updated_at: u64 = 0
    ) {
      this.sponsor = sponsor;
      this.endpoint = endpoint;
      this.policy_uri = policy_uri;
      this.policy_version = policy_version;
      this.allowed = allowed;
      this.max_rc_per_op = max_rc_per_op;
      this.max_ops_per_user_per_day = max_ops_per_user_per_day;
      this.max_bytes_per_op = max_bytes_per_op;
      this.active = active;
      this.registered_at = registered_at;
      this.updated_at = updated_at;
    }
  }

  export class user_grant {
    static encode(message: user_grant, writer: Writer): void {
      const unique_name_sponsor = message.sponsor;
      if (unique_name_sponsor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_sponsor);
      }

      const unique_name_user = message.user;
      if (unique_name_user !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_user);
      }

      if (message.daily_ops != 0) {
        writer.uint32(24);
        writer.uint32(message.daily_ops);
      }

      if (message.expires_at != 0) {
        writer.uint32(32);
        writer.uint64(message.expires_at);
      }

      if (message.revoked != false) {
        writer.uint32(40);
        writer.bool(message.revoked);
      }

      if (message.updated_at != 0) {
        writer.uint32(48);
        writer.uint64(message.updated_at);
      }
    }

    static decode(reader: Reader, length: i32): user_grant {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new user_grant();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.sponsor = reader.bytes();
            break;

          case 2:
            message.user = reader.bytes();
            break;

          case 3:
            message.daily_ops = reader.uint32();
            break;

          case 4:
            message.expires_at = reader.uint64();
            break;

          case 5:
            message.revoked = reader.bool();
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

    sponsor: Uint8Array | null;
    user: Uint8Array | null;
    daily_ops: u32;
    expires_at: u64;
    revoked: bool;
    updated_at: u64;

    constructor(
      sponsor: Uint8Array | null = null,
      user: Uint8Array | null = null,
      daily_ops: u32 = 0,
      expires_at: u64 = 0,
      revoked: bool = false,
      updated_at: u64 = 0
    ) {
      this.sponsor = sponsor;
      this.user = user;
      this.daily_ops = daily_ops;
      this.expires_at = expires_at;
      this.revoked = revoked;
      this.updated_at = updated_at;
    }
  }

  export class set_sponsor_arguments {
    static encode(message: set_sponsor_arguments, writer: Writer): void {
      const unique_name_sponsor = message.sponsor;
      if (unique_name_sponsor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_sponsor);
      }

      const unique_name_endpoint = message.endpoint;
      if (unique_name_endpoint !== null) {
        writer.uint32(18);
        writer.string(unique_name_endpoint);
      }

      const unique_name_policy_uri = message.policy_uri;
      if (unique_name_policy_uri !== null) {
        writer.uint32(26);
        writer.string(unique_name_policy_uri);
      }

      if (message.policy_version != 0) {
        writer.uint32(32);
        writer.uint32(message.policy_version);
      }

      const unique_name_allowed = message.allowed;
      for (let i = 0; i < unique_name_allowed.length; ++i) {
        writer.uint32(42);
        writer.fork();
        allowed_call.encode(unique_name_allowed[i], writer);
        writer.ldelim();
      }

      if (message.max_rc_per_op != 0) {
        writer.uint32(48);
        writer.uint64(message.max_rc_per_op);
      }

      if (message.max_ops_per_user_per_day != 0) {
        writer.uint32(56);
        writer.uint32(message.max_ops_per_user_per_day);
      }

      if (message.max_bytes_per_op != 0) {
        writer.uint32(64);
        writer.uint32(message.max_bytes_per_op);
      }

      if (message.active != false) {
        writer.uint32(72);
        writer.bool(message.active);
      }
    }

    static decode(reader: Reader, length: i32): set_sponsor_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_sponsor_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.sponsor = reader.bytes();
            break;

          case 2:
            message.endpoint = reader.string();
            break;

          case 3:
            message.policy_uri = reader.string();
            break;

          case 4:
            message.policy_version = reader.uint32();
            break;

          case 5:
            message.allowed.push(allowed_call.decode(reader, reader.uint32()));
            break;

          case 6:
            message.max_rc_per_op = reader.uint64();
            break;

          case 7:
            message.max_ops_per_user_per_day = reader.uint32();
            break;

          case 8:
            message.max_bytes_per_op = reader.uint32();
            break;

          case 9:
            message.active = reader.bool();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    sponsor: Uint8Array | null;
    endpoint: string | null;
    policy_uri: string | null;
    policy_version: u32;
    allowed: Array<allowed_call>;
    max_rc_per_op: u64;
    max_ops_per_user_per_day: u32;
    max_bytes_per_op: u32;
    active: bool;

    constructor(
      sponsor: Uint8Array | null = null,
      endpoint: string | null = null,
      policy_uri: string | null = null,
      policy_version: u32 = 0,
      allowed: Array<allowed_call> = [],
      max_rc_per_op: u64 = 0,
      max_ops_per_user_per_day: u32 = 0,
      max_bytes_per_op: u32 = 0,
      active: bool = false
    ) {
      this.sponsor = sponsor;
      this.endpoint = endpoint;
      this.policy_uri = policy_uri;
      this.policy_version = policy_version;
      this.allowed = allowed;
      this.max_rc_per_op = max_rc_per_op;
      this.max_ops_per_user_per_day = max_ops_per_user_per_day;
      this.max_bytes_per_op = max_bytes_per_op;
      this.active = active;
    }
  }

  @unmanaged
  export class set_sponsor_result {
    static encode(message: set_sponsor_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): set_sponsor_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_sponsor_result();

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

  export class deactivate_sponsor_arguments {
    static encode(message: deactivate_sponsor_arguments, writer: Writer): void {
      const unique_name_sponsor = message.sponsor;
      if (unique_name_sponsor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_sponsor);
      }
    }

    static decode(reader: Reader, length: i32): deactivate_sponsor_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new deactivate_sponsor_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.sponsor = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    sponsor: Uint8Array | null;

    constructor(sponsor: Uint8Array | null = null) {
      this.sponsor = sponsor;
    }
  }

  @unmanaged
  export class deactivate_sponsor_result {
    static encode(message: deactivate_sponsor_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): deactivate_sponsor_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new deactivate_sponsor_result();

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

  export class set_user_grant_arguments {
    static encode(message: set_user_grant_arguments, writer: Writer): void {
      const unique_name_sponsor = message.sponsor;
      if (unique_name_sponsor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_sponsor);
      }

      const unique_name_user = message.user;
      if (unique_name_user !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_user);
      }

      if (message.daily_ops != 0) {
        writer.uint32(24);
        writer.uint32(message.daily_ops);
      }

      if (message.expires_at != 0) {
        writer.uint32(32);
        writer.uint64(message.expires_at);
      }
    }

    static decode(reader: Reader, length: i32): set_user_grant_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_user_grant_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.sponsor = reader.bytes();
            break;

          case 2:
            message.user = reader.bytes();
            break;

          case 3:
            message.daily_ops = reader.uint32();
            break;

          case 4:
            message.expires_at = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    sponsor: Uint8Array | null;
    user: Uint8Array | null;
    daily_ops: u32;
    expires_at: u64;

    constructor(
      sponsor: Uint8Array | null = null,
      user: Uint8Array | null = null,
      daily_ops: u32 = 0,
      expires_at: u64 = 0
    ) {
      this.sponsor = sponsor;
      this.user = user;
      this.daily_ops = daily_ops;
      this.expires_at = expires_at;
    }
  }

  @unmanaged
  export class set_user_grant_result {
    static encode(message: set_user_grant_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): set_user_grant_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_user_grant_result();

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

  export class revoke_user_grant_arguments {
    static encode(message: revoke_user_grant_arguments, writer: Writer): void {
      const unique_name_sponsor = message.sponsor;
      if (unique_name_sponsor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_sponsor);
      }

      const unique_name_user = message.user;
      if (unique_name_user !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_user);
      }
    }

    static decode(reader: Reader, length: i32): revoke_user_grant_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new revoke_user_grant_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.sponsor = reader.bytes();
            break;

          case 2:
            message.user = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    sponsor: Uint8Array | null;
    user: Uint8Array | null;

    constructor(
      sponsor: Uint8Array | null = null,
      user: Uint8Array | null = null
    ) {
      this.sponsor = sponsor;
      this.user = user;
    }
  }

  @unmanaged
  export class revoke_user_grant_result {
    static encode(message: revoke_user_grant_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): revoke_user_grant_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new revoke_user_grant_result();

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

  export class get_sponsor_arguments {
    static encode(message: get_sponsor_arguments, writer: Writer): void {
      const unique_name_sponsor = message.sponsor;
      if (unique_name_sponsor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_sponsor);
      }
    }

    static decode(reader: Reader, length: i32): get_sponsor_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_sponsor_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.sponsor = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    sponsor: Uint8Array | null;

    constructor(sponsor: Uint8Array | null = null) {
      this.sponsor = sponsor;
    }
  }

  export class get_sponsor_result {
    static encode(message: get_sponsor_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        sponsor_record.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_sponsor_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_sponsor_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = sponsor_record.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: sponsor_record | null;

    constructor(value: sponsor_record | null = null) {
      this.value = value;
    }
  }

  export class list_sponsors_arguments {
    static encode(message: list_sponsors_arguments, writer: Writer): void {
      const unique_name_start = message.start;
      if (unique_name_start !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_start);
      }

      if (message.limit != 0) {
        writer.uint32(16);
        writer.uint32(message.limit);
      }
    }

    static decode(reader: Reader, length: i32): list_sponsors_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new list_sponsors_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.start = reader.bytes();
            break;

          case 2:
            message.limit = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    start: Uint8Array | null;
    limit: u32;

    constructor(start: Uint8Array | null = null, limit: u32 = 0) {
      this.start = start;
      this.limit = limit;
    }
  }

  export class list_sponsors_result {
    static encode(message: list_sponsors_result, writer: Writer): void {
      const unique_name_values = message.values;
      for (let i = 0; i < unique_name_values.length; ++i) {
        writer.uint32(10);
        writer.fork();
        sponsor_record.encode(unique_name_values[i], writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): list_sponsors_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new list_sponsors_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.values.push(sponsor_record.decode(reader, reader.uint32()));
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    values: Array<sponsor_record>;

    constructor(values: Array<sponsor_record> = []) {
      this.values = values;
    }
  }

  export class get_user_grant_arguments {
    static encode(message: get_user_grant_arguments, writer: Writer): void {
      const unique_name_sponsor = message.sponsor;
      if (unique_name_sponsor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_sponsor);
      }

      const unique_name_user = message.user;
      if (unique_name_user !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_user);
      }
    }

    static decode(reader: Reader, length: i32): get_user_grant_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_user_grant_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.sponsor = reader.bytes();
            break;

          case 2:
            message.user = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    sponsor: Uint8Array | null;
    user: Uint8Array | null;

    constructor(
      sponsor: Uint8Array | null = null,
      user: Uint8Array | null = null
    ) {
      this.sponsor = sponsor;
      this.user = user;
    }
  }

  export class get_user_grant_result {
    static encode(message: get_user_grant_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        user_grant.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_user_grant_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_user_grant_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = user_grant.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: user_grant | null;

    constructor(value: user_grant | null = null) {
      this.value = value;
    }
  }

  export class sponsor_set_event {
    static encode(message: sponsor_set_event, writer: Writer): void {
      const unique_name_sponsor = message.sponsor;
      if (unique_name_sponsor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_sponsor);
      }

      const unique_name_endpoint = message.endpoint;
      if (unique_name_endpoint !== null) {
        writer.uint32(18);
        writer.string(unique_name_endpoint);
      }

      if (message.policy_version != 0) {
        writer.uint32(24);
        writer.uint32(message.policy_version);
      }

      if (message.active != false) {
        writer.uint32(32);
        writer.bool(message.active);
      }

      if (message.timestamp != 0) {
        writer.uint32(40);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): sponsor_set_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new sponsor_set_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.sponsor = reader.bytes();
            break;

          case 2:
            message.endpoint = reader.string();
            break;

          case 3:
            message.policy_version = reader.uint32();
            break;

          case 4:
            message.active = reader.bool();
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

    sponsor: Uint8Array | null;
    endpoint: string | null;
    policy_version: u32;
    active: bool;
    timestamp: u64;

    constructor(
      sponsor: Uint8Array | null = null,
      endpoint: string | null = null,
      policy_version: u32 = 0,
      active: bool = false,
      timestamp: u64 = 0
    ) {
      this.sponsor = sponsor;
      this.endpoint = endpoint;
      this.policy_version = policy_version;
      this.active = active;
      this.timestamp = timestamp;
    }
  }

  export class sponsor_deactivated_event {
    static encode(message: sponsor_deactivated_event, writer: Writer): void {
      const unique_name_sponsor = message.sponsor;
      if (unique_name_sponsor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_sponsor);
      }

      if (message.timestamp != 0) {
        writer.uint32(16);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): sponsor_deactivated_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new sponsor_deactivated_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.sponsor = reader.bytes();
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

    sponsor: Uint8Array | null;
    timestamp: u64;

    constructor(sponsor: Uint8Array | null = null, timestamp: u64 = 0) {
      this.sponsor = sponsor;
      this.timestamp = timestamp;
    }
  }

  export class user_grant_set_event {
    static encode(message: user_grant_set_event, writer: Writer): void {
      const unique_name_sponsor = message.sponsor;
      if (unique_name_sponsor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_sponsor);
      }

      const unique_name_user = message.user;
      if (unique_name_user !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_user);
      }

      if (message.daily_ops != 0) {
        writer.uint32(24);
        writer.uint32(message.daily_ops);
      }

      if (message.expires_at != 0) {
        writer.uint32(32);
        writer.uint64(message.expires_at);
      }

      if (message.timestamp != 0) {
        writer.uint32(40);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): user_grant_set_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new user_grant_set_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.sponsor = reader.bytes();
            break;

          case 2:
            message.user = reader.bytes();
            break;

          case 3:
            message.daily_ops = reader.uint32();
            break;

          case 4:
            message.expires_at = reader.uint64();
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

    sponsor: Uint8Array | null;
    user: Uint8Array | null;
    daily_ops: u32;
    expires_at: u64;
    timestamp: u64;

    constructor(
      sponsor: Uint8Array | null = null,
      user: Uint8Array | null = null,
      daily_ops: u32 = 0,
      expires_at: u64 = 0,
      timestamp: u64 = 0
    ) {
      this.sponsor = sponsor;
      this.user = user;
      this.daily_ops = daily_ops;
      this.expires_at = expires_at;
      this.timestamp = timestamp;
    }
  }

  export class user_grant_revoked_event {
    static encode(message: user_grant_revoked_event, writer: Writer): void {
      const unique_name_sponsor = message.sponsor;
      if (unique_name_sponsor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_sponsor);
      }

      const unique_name_user = message.user;
      if (unique_name_user !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_user);
      }

      if (message.timestamp != 0) {
        writer.uint32(24);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): user_grant_revoked_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new user_grant_revoked_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.sponsor = reader.bytes();
            break;

          case 2:
            message.user = reader.bytes();
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

    sponsor: Uint8Array | null;
    user: Uint8Array | null;
    timestamp: u64;

    constructor(
      sponsor: Uint8Array | null = null,
      user: Uint8Array | null = null,
      timestamp: u64 = 0
    ) {
      this.sponsor = sponsor;
      this.user = user;
      this.timestamp = timestamp;
    }
  }
}
