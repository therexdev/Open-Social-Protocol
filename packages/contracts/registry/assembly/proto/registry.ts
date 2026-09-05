import { Writer, Reader } from "as-proto";

export namespace registry {
  export class contract_entry {
    static encode(message: contract_entry, writer: Writer): void {
      const unique_name_name = message.name;
      if (unique_name_name !== null) {
        writer.uint32(10);
        writer.string(unique_name_name);
      }

      const unique_name_address = message.address;
      if (unique_name_address !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_address);
      }

      if (message.version != 0) {
        writer.uint32(24);
        writer.uint32(message.version);
      }

      const unique_name_abi_hash = message.abi_hash;
      if (unique_name_abi_hash !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_abi_hash);
      }

      if (message.status != 0) {
        writer.uint32(40);
        writer.int32(message.status);
      }

      if (message.effective_at != 0) {
        writer.uint32(48);
        writer.uint64(message.effective_at);
      }

      const unique_name_notes = message.notes;
      if (unique_name_notes !== null) {
        writer.uint32(58);
        writer.string(unique_name_notes);
      }

      if (message.updated_at != 0) {
        writer.uint32(64);
        writer.uint64(message.updated_at);
      }
    }

    static decode(reader: Reader, length: i32): contract_entry {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new contract_entry();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.name = reader.string();
            break;

          case 2:
            message.address = reader.bytes();
            break;

          case 3:
            message.version = reader.uint32();
            break;

          case 4:
            message.abi_hash = reader.bytes();
            break;

          case 5:
            message.status = reader.int32();
            break;

          case 6:
            message.effective_at = reader.uint64();
            break;

          case 7:
            message.notes = reader.string();
            break;

          case 8:
            message.updated_at = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    name: string | null;
    address: Uint8Array | null;
    version: u32;
    abi_hash: Uint8Array | null;
    status: contract_status;
    effective_at: u64;
    notes: string | null;
    updated_at: u64;

    constructor(
      name: string | null = null,
      address: Uint8Array | null = null,
      version: u32 = 0,
      abi_hash: Uint8Array | null = null,
      status: contract_status = 0,
      effective_at: u64 = 0,
      notes: string | null = null,
      updated_at: u64 = 0
    ) {
      this.name = name;
      this.address = address;
      this.version = version;
      this.abi_hash = abi_hash;
      this.status = status;
      this.effective_at = effective_at;
      this.notes = notes;
      this.updated_at = updated_at;
    }
  }

  export class registry_config {
    static encode(message: registry_config, writer: Writer): void {
      const unique_name_admin = message.admin;
      if (unique_name_admin !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_admin);
      }

      if (message.upgrade_delay_ms != 0) {
        writer.uint32(16);
        writer.uint64(message.upgrade_delay_ms);
      }

      if (message.protocol_version != 0) {
        writer.uint32(24);
        writer.uint32(message.protocol_version);
      }

      const unique_name_pending_admin = message.pending_admin;
      if (unique_name_pending_admin !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_pending_admin);
      }

      if (message.admin_transfer_effective_at != 0) {
        writer.uint32(40);
        writer.uint64(message.admin_transfer_effective_at);
      }
    }

    static decode(reader: Reader, length: i32): registry_config {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new registry_config();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.admin = reader.bytes();
            break;

          case 2:
            message.upgrade_delay_ms = reader.uint64();
            break;

          case 3:
            message.protocol_version = reader.uint32();
            break;

          case 4:
            message.pending_admin = reader.bytes();
            break;

          case 5:
            message.admin_transfer_effective_at = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    admin: Uint8Array | null;
    upgrade_delay_ms: u64;
    protocol_version: u32;
    pending_admin: Uint8Array | null;
    admin_transfer_effective_at: u64;

    constructor(
      admin: Uint8Array | null = null,
      upgrade_delay_ms: u64 = 0,
      protocol_version: u32 = 0,
      pending_admin: Uint8Array | null = null,
      admin_transfer_effective_at: u64 = 0
    ) {
      this.admin = admin;
      this.upgrade_delay_ms = upgrade_delay_ms;
      this.protocol_version = protocol_version;
      this.pending_admin = pending_admin;
      this.admin_transfer_effective_at = admin_transfer_effective_at;
    }
  }

  export class init_arguments {
    static encode(message: init_arguments, writer: Writer): void {
      const unique_name_admin = message.admin;
      if (unique_name_admin !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_admin);
      }

      if (message.upgrade_delay_ms != 0) {
        writer.uint32(16);
        writer.uint64(message.upgrade_delay_ms);
      }

      if (message.protocol_version != 0) {
        writer.uint32(24);
        writer.uint32(message.protocol_version);
      }
    }

    static decode(reader: Reader, length: i32): init_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new init_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.admin = reader.bytes();
            break;

          case 2:
            message.upgrade_delay_ms = reader.uint64();
            break;

          case 3:
            message.protocol_version = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    admin: Uint8Array | null;
    upgrade_delay_ms: u64;
    protocol_version: u32;

    constructor(
      admin: Uint8Array | null = null,
      upgrade_delay_ms: u64 = 0,
      protocol_version: u32 = 0
    ) {
      this.admin = admin;
      this.upgrade_delay_ms = upgrade_delay_ms;
      this.protocol_version = protocol_version;
    }
  }

  @unmanaged
  export class init_result {
    static encode(message: init_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): init_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new init_result();

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

  export class propose_contract_arguments {
    static encode(message: propose_contract_arguments, writer: Writer): void {
      const unique_name_name = message.name;
      if (unique_name_name !== null) {
        writer.uint32(10);
        writer.string(unique_name_name);
      }

      const unique_name_address = message.address;
      if (unique_name_address !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_address);
      }

      if (message.version != 0) {
        writer.uint32(24);
        writer.uint32(message.version);
      }

      const unique_name_abi_hash = message.abi_hash;
      if (unique_name_abi_hash !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_abi_hash);
      }

      const unique_name_notes = message.notes;
      if (unique_name_notes !== null) {
        writer.uint32(42);
        writer.string(unique_name_notes);
      }
    }

    static decode(reader: Reader, length: i32): propose_contract_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new propose_contract_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.name = reader.string();
            break;

          case 2:
            message.address = reader.bytes();
            break;

          case 3:
            message.version = reader.uint32();
            break;

          case 4:
            message.abi_hash = reader.bytes();
            break;

          case 5:
            message.notes = reader.string();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    name: string | null;
    address: Uint8Array | null;
    version: u32;
    abi_hash: Uint8Array | null;
    notes: string | null;

    constructor(
      name: string | null = null,
      address: Uint8Array | null = null,
      version: u32 = 0,
      abi_hash: Uint8Array | null = null,
      notes: string | null = null
    ) {
      this.name = name;
      this.address = address;
      this.version = version;
      this.abi_hash = abi_hash;
      this.notes = notes;
    }
  }

  @unmanaged
  export class propose_contract_result {
    static encode(message: propose_contract_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): propose_contract_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new propose_contract_result();

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

  export class apply_contract_arguments {
    static encode(message: apply_contract_arguments, writer: Writer): void {
      const unique_name_name = message.name;
      if (unique_name_name !== null) {
        writer.uint32(10);
        writer.string(unique_name_name);
      }
    }

    static decode(reader: Reader, length: i32): apply_contract_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new apply_contract_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.name = reader.string();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    name: string | null;

    constructor(name: string | null = null) {
      this.name = name;
    }
  }

  @unmanaged
  export class apply_contract_result {
    static encode(message: apply_contract_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): apply_contract_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new apply_contract_result();

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

  export class cancel_contract_arguments {
    static encode(message: cancel_contract_arguments, writer: Writer): void {
      const unique_name_name = message.name;
      if (unique_name_name !== null) {
        writer.uint32(10);
        writer.string(unique_name_name);
      }
    }

    static decode(reader: Reader, length: i32): cancel_contract_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new cancel_contract_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.name = reader.string();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    name: string | null;

    constructor(name: string | null = null) {
      this.name = name;
    }
  }

  @unmanaged
  export class cancel_contract_result {
    static encode(message: cancel_contract_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): cancel_contract_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new cancel_contract_result();

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

  export class deprecate_contract_arguments {
    static encode(message: deprecate_contract_arguments, writer: Writer): void {
      const unique_name_name = message.name;
      if (unique_name_name !== null) {
        writer.uint32(10);
        writer.string(unique_name_name);
      }

      const unique_name_notes = message.notes;
      if (unique_name_notes !== null) {
        writer.uint32(18);
        writer.string(unique_name_notes);
      }
    }

    static decode(reader: Reader, length: i32): deprecate_contract_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new deprecate_contract_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.name = reader.string();
            break;

          case 2:
            message.notes = reader.string();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    name: string | null;
    notes: string | null;

    constructor(name: string | null = null, notes: string | null = null) {
      this.name = name;
      this.notes = notes;
    }
  }

  @unmanaged
  export class deprecate_contract_result {
    static encode(message: deprecate_contract_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): deprecate_contract_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new deprecate_contract_result();

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

  export class propose_admin_arguments {
    static encode(message: propose_admin_arguments, writer: Writer): void {
      const unique_name_new_admin = message.new_admin;
      if (unique_name_new_admin !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_new_admin);
      }
    }

    static decode(reader: Reader, length: i32): propose_admin_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new propose_admin_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.new_admin = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    new_admin: Uint8Array | null;

    constructor(new_admin: Uint8Array | null = null) {
      this.new_admin = new_admin;
    }
  }

  @unmanaged
  export class propose_admin_result {
    static encode(message: propose_admin_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): propose_admin_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new propose_admin_result();

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
  export class cancel_admin_arguments {
    static encode(message: cancel_admin_arguments, writer: Writer): void {}

    static decode(reader: Reader, length: i32): cancel_admin_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new cancel_admin_arguments();

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
  export class cancel_admin_result {
    static encode(message: cancel_admin_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): cancel_admin_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new cancel_admin_result();

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
  export class execute_admin_arguments {
    static encode(message: execute_admin_arguments, writer: Writer): void {}

    static decode(reader: Reader, length: i32): execute_admin_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new execute_admin_arguments();

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
  export class execute_admin_result {
    static encode(message: execute_admin_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): execute_admin_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new execute_admin_result();

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

  export class get_contract_arguments {
    static encode(message: get_contract_arguments, writer: Writer): void {
      const unique_name_name = message.name;
      if (unique_name_name !== null) {
        writer.uint32(10);
        writer.string(unique_name_name);
      }
    }

    static decode(reader: Reader, length: i32): get_contract_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_contract_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.name = reader.string();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    name: string | null;

    constructor(name: string | null = null) {
      this.name = name;
    }
  }

  export class get_contract_result {
    static encode(message: get_contract_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        contract_entry.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_contract_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_contract_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = contract_entry.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: contract_entry | null;

    constructor(value: contract_entry | null = null) {
      this.value = value;
    }
  }

  export class get_proposed_contract_arguments {
    static encode(
      message: get_proposed_contract_arguments,
      writer: Writer
    ): void {
      const unique_name_name = message.name;
      if (unique_name_name !== null) {
        writer.uint32(10);
        writer.string(unique_name_name);
      }
    }

    static decode(
      reader: Reader,
      length: i32
    ): get_proposed_contract_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_proposed_contract_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.name = reader.string();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    name: string | null;

    constructor(name: string | null = null) {
      this.name = name;
    }
  }

  export class get_proposed_contract_result {
    static encode(message: get_proposed_contract_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        contract_entry.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_proposed_contract_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_proposed_contract_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = contract_entry.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: contract_entry | null;

    constructor(value: contract_entry | null = null) {
      this.value = value;
    }
  }

  @unmanaged
  export class list_contracts_arguments {
    static encode(message: list_contracts_arguments, writer: Writer): void {}

    static decode(reader: Reader, length: i32): list_contracts_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new list_contracts_arguments();

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

  export class list_contracts_result {
    static encode(message: list_contracts_result, writer: Writer): void {
      const unique_name_values = message.values;
      for (let i = 0; i < unique_name_values.length; ++i) {
        writer.uint32(10);
        writer.fork();
        contract_entry.encode(unique_name_values[i], writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): list_contracts_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new list_contracts_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.values.push(contract_entry.decode(reader, reader.uint32()));
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    values: Array<contract_entry>;

    constructor(values: Array<contract_entry> = []) {
      this.values = values;
    }
  }

  @unmanaged
  export class get_config_arguments {
    static encode(message: get_config_arguments, writer: Writer): void {}

    static decode(reader: Reader, length: i32): get_config_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_config_arguments();

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

  export class get_config_result {
    static encode(message: get_config_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        registry_config.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): get_config_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_config_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = registry_config.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: registry_config | null;

    constructor(value: registry_config | null = null) {
      this.value = value;
    }
  }

  export class contract_proposed_event {
    static encode(message: contract_proposed_event, writer: Writer): void {
      const unique_name_name = message.name;
      if (unique_name_name !== null) {
        writer.uint32(10);
        writer.string(unique_name_name);
      }

      const unique_name_address = message.address;
      if (unique_name_address !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_address);
      }

      if (message.version != 0) {
        writer.uint32(24);
        writer.uint32(message.version);
      }

      const unique_name_abi_hash = message.abi_hash;
      if (unique_name_abi_hash !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_abi_hash);
      }

      if (message.effective_at != 0) {
        writer.uint32(40);
        writer.uint64(message.effective_at);
      }
    }

    static decode(reader: Reader, length: i32): contract_proposed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new contract_proposed_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.name = reader.string();
            break;

          case 2:
            message.address = reader.bytes();
            break;

          case 3:
            message.version = reader.uint32();
            break;

          case 4:
            message.abi_hash = reader.bytes();
            break;

          case 5:
            message.effective_at = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    name: string | null;
    address: Uint8Array | null;
    version: u32;
    abi_hash: Uint8Array | null;
    effective_at: u64;

    constructor(
      name: string | null = null,
      address: Uint8Array | null = null,
      version: u32 = 0,
      abi_hash: Uint8Array | null = null,
      effective_at: u64 = 0
    ) {
      this.name = name;
      this.address = address;
      this.version = version;
      this.abi_hash = abi_hash;
      this.effective_at = effective_at;
    }
  }

  export class contract_activated_event {
    static encode(message: contract_activated_event, writer: Writer): void {
      const unique_name_name = message.name;
      if (unique_name_name !== null) {
        writer.uint32(10);
        writer.string(unique_name_name);
      }

      const unique_name_address = message.address;
      if (unique_name_address !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_address);
      }

      if (message.version != 0) {
        writer.uint32(24);
        writer.uint32(message.version);
      }

      if (message.timestamp != 0) {
        writer.uint32(32);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): contract_activated_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new contract_activated_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.name = reader.string();
            break;

          case 2:
            message.address = reader.bytes();
            break;

          case 3:
            message.version = reader.uint32();
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

    name: string | null;
    address: Uint8Array | null;
    version: u32;
    timestamp: u64;

    constructor(
      name: string | null = null,
      address: Uint8Array | null = null,
      version: u32 = 0,
      timestamp: u64 = 0
    ) {
      this.name = name;
      this.address = address;
      this.version = version;
      this.timestamp = timestamp;
    }
  }

  export class contract_cancelled_event {
    static encode(message: contract_cancelled_event, writer: Writer): void {
      const unique_name_name = message.name;
      if (unique_name_name !== null) {
        writer.uint32(10);
        writer.string(unique_name_name);
      }

      if (message.timestamp != 0) {
        writer.uint32(16);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): contract_cancelled_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new contract_cancelled_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.name = reader.string();
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

    name: string | null;
    timestamp: u64;

    constructor(name: string | null = null, timestamp: u64 = 0) {
      this.name = name;
      this.timestamp = timestamp;
    }
  }

  export class contract_deprecated_event {
    static encode(message: contract_deprecated_event, writer: Writer): void {
      const unique_name_name = message.name;
      if (unique_name_name !== null) {
        writer.uint32(10);
        writer.string(unique_name_name);
      }

      const unique_name_address = message.address;
      if (unique_name_address !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_address);
      }

      if (message.version != 0) {
        writer.uint32(24);
        writer.uint32(message.version);
      }

      if (message.timestamp != 0) {
        writer.uint32(32);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): contract_deprecated_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new contract_deprecated_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.name = reader.string();
            break;

          case 2:
            message.address = reader.bytes();
            break;

          case 3:
            message.version = reader.uint32();
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

    name: string | null;
    address: Uint8Array | null;
    version: u32;
    timestamp: u64;

    constructor(
      name: string | null = null,
      address: Uint8Array | null = null,
      version: u32 = 0,
      timestamp: u64 = 0
    ) {
      this.name = name;
      this.address = address;
      this.version = version;
      this.timestamp = timestamp;
    }
  }

  export class admin_proposed_event {
    static encode(message: admin_proposed_event, writer: Writer): void {
      const unique_name_new_admin = message.new_admin;
      if (unique_name_new_admin !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_new_admin);
      }

      if (message.effective_at != 0) {
        writer.uint32(16);
        writer.uint64(message.effective_at);
      }
    }

    static decode(reader: Reader, length: i32): admin_proposed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new admin_proposed_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.new_admin = reader.bytes();
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

    new_admin: Uint8Array | null;
    effective_at: u64;

    constructor(new_admin: Uint8Array | null = null, effective_at: u64 = 0) {
      this.new_admin = new_admin;
      this.effective_at = effective_at;
    }
  }

  export class admin_changed_event {
    static encode(message: admin_changed_event, writer: Writer): void {
      const unique_name_previous_admin = message.previous_admin;
      if (unique_name_previous_admin !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_previous_admin);
      }

      const unique_name_new_admin = message.new_admin;
      if (unique_name_new_admin !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_new_admin);
      }

      if (message.timestamp != 0) {
        writer.uint32(24);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): admin_changed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new admin_changed_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.previous_admin = reader.bytes();
            break;

          case 2:
            message.new_admin = reader.bytes();
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

    previous_admin: Uint8Array | null;
    new_admin: Uint8Array | null;
    timestamp: u64;

    constructor(
      previous_admin: Uint8Array | null = null,
      new_admin: Uint8Array | null = null,
      timestamp: u64 = 0
    ) {
      this.previous_admin = previous_admin;
      this.new_admin = new_admin;
      this.timestamp = timestamp;
    }
  }

  export enum contract_status {
    proposed = 0,
    active = 1,
    deprecated = 2,
  }
}
