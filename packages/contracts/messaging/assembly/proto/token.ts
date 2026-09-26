import { Writer, Reader } from "as-proto";

export namespace token {
  @unmanaged
  export class account_state {
    static encode(message: account_state, writer: Writer): void {
      if (message.balance != 0) {
        writer.uint32(8);
        writer.uint64(message.balance);
      }

      if (message.free_credits != 0) {
        writer.uint32(16);
        writer.uint64(message.free_credits);
      }

      if (message.token_credits != 0) {
        writer.uint32(24);
        writer.uint64(message.token_credits);
      }

      if (message.updated_at != 0) {
        writer.uint32(32);
        writer.uint64(message.updated_at);
      }

      if (message.resource_version != 0) {
        writer.uint32(40);
        writer.uint32(message.resource_version);
      }

      if (message.block != 0) {
        writer.uint32(48);
        writer.uint64(message.block);
      }

      if (message.free_ticks != 0) {
        writer.uint32(56);
        writer.uint64(message.free_ticks);
      }

      if (message.token_ticks != 0) {
        writer.uint32(64);
        writer.uint64(message.token_ticks);
      }

      if (message.transferable != 0) {
        writer.uint32(72);
        writer.uint64(message.transferable);
      }

      if (message.locked != 0) {
        writer.uint32(80);
        writer.uint64(message.locked);
      }

      if (message.recharge_blocks != 0) {
        writer.uint32(88);
        writer.uint64(message.recharge_blocks);
      }

      if (message.ticks_per_unit != 0) {
        writer.uint32(96);
        writer.uint64(message.ticks_per_unit);
      }
    }

    static decode(reader: Reader, length: i32): account_state {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new account_state();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.balance = reader.uint64();
            break;

          case 2:
            message.free_credits = reader.uint64();
            break;

          case 3:
            message.token_credits = reader.uint64();
            break;

          case 4:
            message.updated_at = reader.uint64();
            break;

          case 5:
            message.resource_version = reader.uint32();
            break;

          case 6:
            message.block = reader.uint64();
            break;

          case 7:
            message.free_ticks = reader.uint64();
            break;

          case 8:
            message.token_ticks = reader.uint64();
            break;

          case 9:
            message.transferable = reader.uint64();
            break;

          case 10:
            message.locked = reader.uint64();
            break;

          case 11:
            message.recharge_blocks = reader.uint64();
            break;

          case 12:
            message.ticks_per_unit = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    balance: u64;
    free_credits: u64;
    token_credits: u64;
    updated_at: u64;
    resource_version: u32;
    block: u64;
    free_ticks: u64;
    token_ticks: u64;
    transferable: u64;
    locked: u64;
    recharge_blocks: u64;
    ticks_per_unit: u64;

    constructor(
      balance: u64 = 0,
      free_credits: u64 = 0,
      token_credits: u64 = 0,
      updated_at: u64 = 0,
      resource_version: u32 = 0,
      block: u64 = 0,
      free_ticks: u64 = 0,
      token_ticks: u64 = 0,
      transferable: u64 = 0,
      locked: u64 = 0,
      recharge_blocks: u64 = 0,
      ticks_per_unit: u64 = 0
    ) {
      this.balance = balance;
      this.free_credits = free_credits;
      this.token_credits = token_credits;
      this.updated_at = updated_at;
      this.resource_version = resource_version;
      this.block = block;
      this.free_ticks = free_ticks;
      this.token_ticks = token_ticks;
      this.transferable = transferable;
      this.locked = locked;
      this.recharge_blocks = recharge_blocks;
      this.ticks_per_unit = ticks_per_unit;
    }
  }

  @unmanaged
  export class reward_state {
    static encode(message: reward_state, writer: Writer): void {
      if (message.day != 0) {
        writer.uint32(8);
        writer.uint64(message.day);
      }

      if (message.minted != 0) {
        writer.uint32(16);
        writer.uint64(message.minted);
      }
    }

    static decode(reader: Reader, length: i32): reward_state {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new reward_state();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.day = reader.uint64();
            break;

          case 2:
            message.minted = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    day: u64;
    minted: u64;

    constructor(day: u64 = 0, minted: u64 = 0) {
      this.day = day;
      this.minted = minted;
    }
  }

  export class config {
    static encode(message: config, writer: Writer): void {
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

      const unique_name_publications = message.publications;
      if (unique_name_publications !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_publications);
      }

      const unique_name_messaging = message.messaging;
      if (unique_name_messaging !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_messaging);
      }

      if (message.reward_amount != 0) {
        writer.uint32(40);
        writer.uint64(message.reward_amount);
      }

      if (message.daily_reward_cap != 0) {
        writer.uint32(48);
        writer.uint64(message.daily_reward_cap);
      }

      if (message.recipient_daily_cap != 0) {
        writer.uint32(56);
        writer.uint64(message.recipient_daily_cap);
      }

      if (message.supply != 0) {
        writer.uint32(64);
        writer.uint64(message.supply);
      }

      if (message.resource_version != 0) {
        writer.uint32(72);
        writer.uint32(message.resource_version);
      }

      if (message.activation_block != 0) {
        writer.uint32(80);
        writer.uint64(message.activation_block);
      }

      if (message.activation_time != 0) {
        writer.uint32(88);
        writer.uint64(message.activation_time);
      }
    }

    static decode(reader: Reader, length: i32): config {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new config();

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
            message.publications = reader.bytes();
            break;

          case 4:
            message.messaging = reader.bytes();
            break;

          case 5:
            message.reward_amount = reader.uint64();
            break;

          case 6:
            message.daily_reward_cap = reader.uint64();
            break;

          case 7:
            message.recipient_daily_cap = reader.uint64();
            break;

          case 8:
            message.supply = reader.uint64();
            break;

          case 9:
            message.resource_version = reader.uint32();
            break;

          case 10:
            message.activation_block = reader.uint64();
            break;

          case 11:
            message.activation_time = reader.uint64();
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
    publications: Uint8Array | null;
    messaging: Uint8Array | null;
    reward_amount: u64;
    daily_reward_cap: u64;
    recipient_daily_cap: u64;
    supply: u64;
    resource_version: u32;
    activation_block: u64;
    activation_time: u64;

    constructor(
      identity: Uint8Array | null = null,
      relationships: Uint8Array | null = null,
      publications: Uint8Array | null = null,
      messaging: Uint8Array | null = null,
      reward_amount: u64 = 0,
      daily_reward_cap: u64 = 0,
      recipient_daily_cap: u64 = 0,
      supply: u64 = 0,
      resource_version: u32 = 0,
      activation_block: u64 = 0,
      activation_time: u64 = 0
    ) {
      this.identity = identity;
      this.relationships = relationships;
      this.publications = publications;
      this.messaging = messaging;
      this.reward_amount = reward_amount;
      this.daily_reward_cap = daily_reward_cap;
      this.recipient_daily_cap = recipient_daily_cap;
      this.supply = supply;
      this.resource_version = resource_version;
      this.activation_block = activation_block;
      this.activation_time = activation_time;
    }
  }

  export class init_arguments {
    static encode(message: init_arguments, writer: Writer): void {
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

      const unique_name_publications = message.publications;
      if (unique_name_publications !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_publications);
      }

      const unique_name_messaging = message.messaging;
      if (unique_name_messaging !== null) {
        writer.uint32(34);
        writer.bytes(unique_name_messaging);
      }
    }

    static decode(reader: Reader, length: i32): init_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new init_arguments();

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
            message.publications = reader.bytes();
            break;

          case 4:
            message.messaging = reader.bytes();
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
    publications: Uint8Array | null;
    messaging: Uint8Array | null;

    constructor(
      identity: Uint8Array | null = null,
      relationships: Uint8Array | null = null,
      publications: Uint8Array | null = null,
      messaging: Uint8Array | null = null
    ) {
      this.identity = identity;
      this.relationships = relationships;
      this.publications = publications;
      this.messaging = messaging;
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

  @unmanaged
  export class set_reward_policy_arguments {
    static encode(message: set_reward_policy_arguments, writer: Writer): void {
      if (message.reward_amount != 0) {
        writer.uint32(8);
        writer.uint64(message.reward_amount);
      }

      if (message.daily_reward_cap != 0) {
        writer.uint32(16);
        writer.uint64(message.daily_reward_cap);
      }

      if (message.recipient_daily_cap != 0) {
        writer.uint32(24);
        writer.uint64(message.recipient_daily_cap);
      }
    }

    static decode(reader: Reader, length: i32): set_reward_policy_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_reward_policy_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.reward_amount = reader.uint64();
            break;

          case 2:
            message.daily_reward_cap = reader.uint64();
            break;

          case 3:
            message.recipient_daily_cap = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    reward_amount: u64;
    daily_reward_cap: u64;
    recipient_daily_cap: u64;

    constructor(
      reward_amount: u64 = 0,
      daily_reward_cap: u64 = 0,
      recipient_daily_cap: u64 = 0
    ) {
      this.reward_amount = reward_amount;
      this.daily_reward_cap = daily_reward_cap;
      this.recipient_daily_cap = recipient_daily_cap;
    }
  }

  @unmanaged
  export class set_reward_policy_result {
    static encode(message: set_reward_policy_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): set_reward_policy_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new set_reward_policy_result();

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
        config.encode(unique_name_value, writer);
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
            message.value = config.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: config | null;

    constructor(value: config | null = null) {
      this.value = value;
    }
  }

  export class get_account_arguments {
    static encode(message: get_account_arguments, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }
    }

    static decode(reader: Reader, length: i32): get_account_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_account_arguments();

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
  export class get_account_result {
    static encode(message: get_account_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        account_state.encode(unique_name_value, writer);
        writer.ldelim();
      }

      if (message.capacity != 0) {
        writer.uint32(16);
        writer.uint64(message.capacity);
      }
    }

    static decode(reader: Reader, length: i32): get_account_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_account_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = account_state.decode(reader, reader.uint32());
            break;

          case 2:
            message.capacity = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: account_state | null;
    capacity: u64;

    constructor(value: account_state | null = null, capacity: u64 = 0) {
      this.value = value;
      this.capacity = capacity;
    }
  }

  export class support_arguments {
    static encode(message: support_arguments, writer: Writer): void {
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

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): support_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new support_arguments();

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
    device: Uint8Array | null;

    constructor(
      actor: Uint8Array | null = null,
      post_id: Uint8Array | null = null,
      device: Uint8Array | null = null
    ) {
      this.actor = actor;
      this.post_id = post_id;
      this.device = device;
    }
  }

  @unmanaged
  export class support_result {
    static encode(message: support_result, writer: Writer): void {
      if (message.reward != 0) {
        writer.uint32(8);
        writer.uint64(message.reward);
      }
    }

    static decode(reader: Reader, length: i32): support_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new support_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.reward = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    reward: u64;

    constructor(reward: u64 = 0) {
      this.reward = reward;
    }
  }

  export class transfer_arguments {
    static encode(message: transfer_arguments, writer: Writer): void {
      const unique_name_from = message.from;
      if (unique_name_from !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_from);
      }

      const unique_name_to = message.to;
      if (unique_name_to !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_to);
      }

      if (message.value != 0) {
        writer.uint32(24);
        writer.uint64(message.value);
      }
    }

    static decode(reader: Reader, length: i32): transfer_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new transfer_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.from = reader.bytes();
            break;

          case 2:
            message.to = reader.bytes();
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

    from: Uint8Array | null;
    to: Uint8Array | null;
    value: u64;

    constructor(
      from: Uint8Array | null = null,
      to: Uint8Array | null = null,
      value: u64 = 0
    ) {
      this.from = from;
      this.to = to;
      this.value = value;
    }
  }

  @unmanaged
  export class transfer_result {
    static encode(message: transfer_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): transfer_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new transfer_result();

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

  export class burn_arguments {
    static encode(message: burn_arguments, writer: Writer): void {
      const unique_name_from = message.from;
      if (unique_name_from !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_from);
      }

      if (message.value != 0) {
        writer.uint32(16);
        writer.uint64(message.value);
      }
    }

    static decode(reader: Reader, length: i32): burn_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new burn_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.from = reader.bytes();
            break;

          case 2:
            message.value = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    from: Uint8Array | null;
    value: u64;

    constructor(from: Uint8Array | null = null, value: u64 = 0) {
      this.from = from;
      this.value = value;
    }
  }

  @unmanaged
  export class burn_result {
    static encode(message: burn_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): burn_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new burn_result();

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

  export class consume_arguments {
    static encode(message: consume_arguments, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      if (message.units != 0) {
        writer.uint32(16);
        writer.uint64(message.units);
      }
    }

    static decode(reader: Reader, length: i32): consume_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new consume_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.units = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    account: Uint8Array | null;
    units: u64;

    constructor(account: Uint8Array | null = null, units: u64 = 0) {
      this.account = account;
      this.units = units;
    }
  }

  @unmanaged
  export class consume_result {
    static encode(message: consume_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): consume_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new consume_result();

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

  export class balance_of_arguments {
    static encode(message: balance_of_arguments, writer: Writer): void {
      const unique_name_owner = message.owner;
      if (unique_name_owner !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_owner);
      }
    }

    static decode(reader: Reader, length: i32): balance_of_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new balance_of_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.owner = reader.bytes();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    owner: Uint8Array | null;

    constructor(owner: Uint8Array | null = null) {
      this.owner = owner;
    }
  }

  @unmanaged
  export class balance_of_result {
    static encode(message: balance_of_result, writer: Writer): void {
      if (message.value != 0) {
        writer.uint32(8);
        writer.uint64(message.value);
      }
    }

    static decode(reader: Reader, length: i32): balance_of_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new balance_of_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: u64;

    constructor(value: u64 = 0) {
      this.value = value;
    }
  }

  @unmanaged
  export class total_supply_arguments {
    static encode(message: total_supply_arguments, writer: Writer): void {}

    static decode(reader: Reader, length: i32): total_supply_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new total_supply_arguments();

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
  export class total_supply_result {
    static encode(message: total_supply_result, writer: Writer): void {
      if (message.value != 0) {
        writer.uint32(8);
        writer.uint64(message.value);
      }
    }

    static decode(reader: Reader, length: i32): total_supply_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new total_supply_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: u64;

    constructor(value: u64 = 0) {
      this.value = value;
    }
  }

  @unmanaged
  export class name_arguments {
    static encode(message: name_arguments, writer: Writer): void {}

    static decode(reader: Reader, length: i32): name_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new name_arguments();

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

  export class name_result {
    static encode(message: name_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.string(unique_name_value);
      }
    }

    static decode(reader: Reader, length: i32): name_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new name_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = reader.string();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: string | null;

    constructor(value: string | null = null) {
      this.value = value;
    }
  }

  @unmanaged
  export class symbol_arguments {
    static encode(message: symbol_arguments, writer: Writer): void {}

    static decode(reader: Reader, length: i32): symbol_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new symbol_arguments();

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

  export class symbol_result {
    static encode(message: symbol_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.string(unique_name_value);
      }
    }

    static decode(reader: Reader, length: i32): symbol_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new symbol_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = reader.string();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: string | null;

    constructor(value: string | null = null) {
      this.value = value;
    }
  }

  @unmanaged
  export class decimals_arguments {
    static encode(message: decimals_arguments, writer: Writer): void {}

    static decode(reader: Reader, length: i32): decimals_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new decimals_arguments();

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
  export class decimals_result {
    static encode(message: decimals_result, writer: Writer): void {
      if (message.value != 0) {
        writer.uint32(8);
        writer.uint32(message.value);
      }
    }

    static decode(reader: Reader, length: i32): decimals_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new decimals_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = reader.uint32();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: u32;

    constructor(value: u32 = 0) {
      this.value = value;
    }
  }

  export class account_updated_event {
    static encode(message: account_updated_event, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(18);
        writer.fork();
        account_state.encode(unique_name_value, writer);
        writer.ldelim();
      }

      if (message.timestamp != 0) {
        writer.uint32(24);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): account_updated_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new account_updated_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.value = account_state.decode(reader, reader.uint32());
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
    value: account_state | null;
    timestamp: u64;

    constructor(
      account: Uint8Array | null = null,
      value: account_state | null = null,
      timestamp: u64 = 0
    ) {
      this.account = account;
      this.value = value;
      this.timestamp = timestamp;
    }
  }

  export class supported_event {
    static encode(message: supported_event, writer: Writer): void {
      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_recipient = message.recipient;
      if (unique_name_recipient !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_recipient);
      }

      const unique_name_post_id = message.post_id;
      if (unique_name_post_id !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_post_id);
      }

      if (message.reward != 0) {
        writer.uint32(32);
        writer.uint64(message.reward);
      }

      if (message.timestamp != 0) {
        writer.uint32(40);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): supported_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new supported_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
            message.recipient = reader.bytes();
            break;

          case 3:
            message.post_id = reader.bytes();
            break;

          case 4:
            message.reward = reader.uint64();
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
    recipient: Uint8Array | null;
    post_id: Uint8Array | null;
    reward: u64;
    timestamp: u64;

    constructor(
      actor: Uint8Array | null = null,
      recipient: Uint8Array | null = null,
      post_id: Uint8Array | null = null,
      reward: u64 = 0,
      timestamp: u64 = 0
    ) {
      this.actor = actor;
      this.recipient = recipient;
      this.post_id = post_id;
      this.reward = reward;
      this.timestamp = timestamp;
    }
  }

  export class transfer_event {
    static encode(message: transfer_event, writer: Writer): void {
      const unique_name_from = message.from;
      if (unique_name_from !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_from);
      }

      const unique_name_to = message.to;
      if (unique_name_to !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_to);
      }

      if (message.value != 0) {
        writer.uint32(24);
        writer.uint64(message.value);
      }

      if (message.timestamp != 0) {
        writer.uint32(32);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): transfer_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new transfer_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.from = reader.bytes();
            break;

          case 2:
            message.to = reader.bytes();
            break;

          case 3:
            message.value = reader.uint64();
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

    from: Uint8Array | null;
    to: Uint8Array | null;
    value: u64;
    timestamp: u64;

    constructor(
      from: Uint8Array | null = null,
      to: Uint8Array | null = null,
      value: u64 = 0,
      timestamp: u64 = 0
    ) {
      this.from = from;
      this.to = to;
      this.value = value;
      this.timestamp = timestamp;
    }
  }

  export class burn_event {
    static encode(message: burn_event, writer: Writer): void {
      const unique_name_from = message.from;
      if (unique_name_from !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_from);
      }

      if (message.value != 0) {
        writer.uint32(16);
        writer.uint64(message.value);
      }

      if (message.timestamp != 0) {
        writer.uint32(24);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): burn_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new burn_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.from = reader.bytes();
            break;

          case 2:
            message.value = reader.uint64();
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

    from: Uint8Array | null;
    value: u64;
    timestamp: u64;

    constructor(
      from: Uint8Array | null = null,
      value: u64 = 0,
      timestamp: u64 = 0
    ) {
      this.from = from;
      this.value = value;
      this.timestamp = timestamp;
    }
  }

  @unmanaged
  export class policy_changed_event {
    static encode(message: policy_changed_event, writer: Writer): void {
      if (message.reward_amount != 0) {
        writer.uint32(8);
        writer.uint64(message.reward_amount);
      }

      if (message.daily_reward_cap != 0) {
        writer.uint32(16);
        writer.uint64(message.daily_reward_cap);
      }

      if (message.recipient_daily_cap != 0) {
        writer.uint32(24);
        writer.uint64(message.recipient_daily_cap);
      }

      if (message.timestamp != 0) {
        writer.uint32(32);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): policy_changed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new policy_changed_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.reward_amount = reader.uint64();
            break;

          case 2:
            message.daily_reward_cap = reader.uint64();
            break;

          case 3:
            message.recipient_daily_cap = reader.uint64();
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

    reward_amount: u64;
    daily_reward_cap: u64;
    recipient_daily_cap: u64;
    timestamp: u64;

    constructor(
      reward_amount: u64 = 0,
      daily_reward_cap: u64 = 0,
      recipient_daily_cap: u64 = 0,
      timestamp: u64 = 0
    ) {
      this.reward_amount = reward_amount;
      this.daily_reward_cap = daily_reward_cap;
      this.recipient_daily_cap = recipient_daily_cap;
      this.timestamp = timestamp;
    }
  }

  @unmanaged
  export class recharge_state {
    static encode(message: recharge_state, writer: Writer): void {
      if (message.free_ready != 0) {
        writer.uint32(8);
        writer.uint64(message.free_ready);
      }

      if (message.paid_ready != 0) {
        writer.uint32(16);
        writer.uint64(message.paid_ready);
      }

      if (message.block != 0) {
        writer.uint32(24);
        writer.uint64(message.block);
      }

      if (message.revision != 0) {
        writer.uint32(32);
        writer.uint64(message.revision);
      }
    }

    static decode(reader: Reader, length: i32): recharge_state {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new recharge_state();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.free_ready = reader.uint64();
            break;

          case 2:
            message.paid_ready = reader.uint64();
            break;

          case 3:
            message.block = reader.uint64();
            break;

          case 4:
            message.revision = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    free_ready: u64;
    paid_ready: u64;
    block: u64;
    revision: u64;

    constructor(
      free_ready: u64 = 0,
      paid_ready: u64 = 0,
      block: u64 = 0,
      revision: u64 = 0
    ) {
      this.free_ready = free_ready;
      this.paid_ready = paid_ready;
      this.block = block;
      this.revision = revision;
    }
  }

  @unmanaged
  export class recharge_node {
    static encode(message: recharge_node, writer: Writer): void {
      if (message.count != 0) {
        writer.uint32(8);
        writer.uint64(message.count);
      }

      if (message.deadlines != 0) {
        writer.uint32(16);
        writer.uint64(message.deadlines);
      }

      if (message.revision != 0) {
        writer.uint32(24);
        writer.uint64(message.revision);
      }

      if (message.floor != 0) {
        writer.uint32(32);
        writer.uint64(message.floor);
      }
    }

    static decode(reader: Reader, length: i32): recharge_node {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new recharge_node();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.count = reader.uint64();
            break;

          case 2:
            message.deadlines = reader.uint64();
            break;

          case 3:
            message.revision = reader.uint64();
            break;

          case 4:
            message.floor = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    count: u64;
    deadlines: u64;
    revision: u64;
    floor: u64;

    constructor(
      count: u64 = 0,
      deadlines: u64 = 0,
      revision: u64 = 0,
      floor: u64 = 0
    ) {
      this.count = count;
      this.deadlines = deadlines;
      this.revision = revision;
      this.floor = floor;
    }
  }

  @unmanaged
  export class activate_recharge_arguments {
    static encode(message: activate_recharge_arguments, writer: Writer): void {}

    static decode(reader: Reader, length: i32): activate_recharge_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new activate_recharge_arguments();

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
  export class activate_recharge_result {
    static encode(message: activate_recharge_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): activate_recharge_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new activate_recharge_result();

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
  export class recharge_activated_event {
    static encode(message: recharge_activated_event, writer: Writer): void {
      if (message.resource_version != 0) {
        writer.uint32(8);
        writer.uint32(message.resource_version);
      }

      if (message.activation_block != 0) {
        writer.uint32(16);
        writer.uint64(message.activation_block);
      }

      if (message.activation_time != 0) {
        writer.uint32(24);
        writer.uint64(message.activation_time);
      }

      if (message.recharge_blocks != 0) {
        writer.uint32(32);
        writer.uint64(message.recharge_blocks);
      }

      if (message.free_units != 0) {
        writer.uint32(40);
        writer.uint64(message.free_units);
      }
    }

    static decode(reader: Reader, length: i32): recharge_activated_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new recharge_activated_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.resource_version = reader.uint32();
            break;

          case 2:
            message.activation_block = reader.uint64();
            break;

          case 3:
            message.activation_time = reader.uint64();
            break;

          case 4:
            message.recharge_blocks = reader.uint64();
            break;

          case 5:
            message.free_units = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    resource_version: u32;
    activation_block: u64;
    activation_time: u64;
    recharge_blocks: u64;
    free_units: u64;

    constructor(
      resource_version: u32 = 0,
      activation_block: u64 = 0,
      activation_time: u64 = 0,
      recharge_blocks: u64 = 0,
      free_units: u64 = 0
    ) {
      this.resource_version = resource_version;
      this.activation_block = activation_block;
      this.activation_time = activation_time;
      this.recharge_blocks = recharge_blocks;
      this.free_units = free_units;
    }
  }
}
