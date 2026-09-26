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

      if (message.economy_version != 0) {
        writer.uint32(96);
        writer.uint32(message.economy_version);
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

          case 12:
            message.economy_version = reader.uint32();
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
    economy_version: u32;

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
      activation_time: u64 = 0,
      economy_version: u32 = 0
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
      this.economy_version = economy_version;
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

  @unmanaged
  export class economy_config {
    static encode(message: economy_config, writer: Writer): void {
      if (message.version != 0) {
        writer.uint32(8);
        writer.uint32(message.version);
      }

      if (message.activation_block != 0) {
        writer.uint32(16);
        writer.uint64(message.activation_block);
      }

      if (message.period_blocks != 0) {
        writer.uint32(24);
        writer.uint64(message.period_blocks);
      }

      if (message.period_budget != 0) {
        writer.uint32(32);
        writer.uint64(message.period_budget);
      }

      if (message.curve_constant != 0) {
        writer.uint32(40);
        writer.uint64(message.curve_constant);
      }

      if (message.score_scale != 0) {
        writer.uint32(48);
        writer.uint64(message.score_scale);
      }

      if (message.max_vote_weight != 0) {
        writer.uint32(56);
        writer.uint64(message.max_vote_weight);
      }

      if (message.max_period_weight != 0) {
        writer.uint32(64);
        writer.uint64(message.max_period_weight);
      }

      if (message.promotion_price != 0) {
        writer.uint32(72);
        writer.uint64(message.promotion_price);
      }

      if (message.promotion_interval != 0) {
        writer.uint32(80);
        writer.uint64(message.promotion_interval);
      }

      if (message.max_opportunities != 0) {
        writer.uint32(88);
        writer.uint32(message.max_opportunities);
      }

      if (message.promotion_slots != 0) {
        writer.uint32(96);
        writer.uint32(message.promotion_slots);
      }

      if (message.reserved != 0) {
        writer.uint32(104);
        writer.uint64(message.reserved);
      }

      if (message.bootstrap_minted != 0) {
        writer.uint32(112);
        writer.uint64(message.bootstrap_minted);
      }
    }

    static decode(reader: Reader, length: i32): economy_config {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new economy_config();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.version = reader.uint32();
            break;

          case 2:
            message.activation_block = reader.uint64();
            break;

          case 3:
            message.period_blocks = reader.uint64();
            break;

          case 4:
            message.period_budget = reader.uint64();
            break;

          case 5:
            message.curve_constant = reader.uint64();
            break;

          case 6:
            message.score_scale = reader.uint64();
            break;

          case 7:
            message.max_vote_weight = reader.uint64();
            break;

          case 8:
            message.max_period_weight = reader.uint64();
            break;

          case 9:
            message.promotion_price = reader.uint64();
            break;

          case 10:
            message.promotion_interval = reader.uint64();
            break;

          case 11:
            message.max_opportunities = reader.uint32();
            break;

          case 12:
            message.promotion_slots = reader.uint32();
            break;

          case 13:
            message.reserved = reader.uint64();
            break;

          case 14:
            message.bootstrap_minted = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    version: u32;
    activation_block: u64;
    period_blocks: u64;
    period_budget: u64;
    curve_constant: u64;
    score_scale: u64;
    max_vote_weight: u64;
    max_period_weight: u64;
    promotion_price: u64;
    promotion_interval: u64;
    max_opportunities: u32;
    promotion_slots: u32;
    reserved: u64;
    bootstrap_minted: u64;

    constructor(
      version: u32 = 0,
      activation_block: u64 = 0,
      period_blocks: u64 = 0,
      period_budget: u64 = 0,
      curve_constant: u64 = 0,
      score_scale: u64 = 0,
      max_vote_weight: u64 = 0,
      max_period_weight: u64 = 0,
      promotion_price: u64 = 0,
      promotion_interval: u64 = 0,
      max_opportunities: u32 = 0,
      promotion_slots: u32 = 0,
      reserved: u64 = 0,
      bootstrap_minted: u64 = 0
    ) {
      this.version = version;
      this.activation_block = activation_block;
      this.period_blocks = period_blocks;
      this.period_budget = period_budget;
      this.curve_constant = curve_constant;
      this.score_scale = score_scale;
      this.max_vote_weight = max_vote_weight;
      this.max_period_weight = max_period_weight;
      this.promotion_price = promotion_price;
      this.promotion_interval = promotion_interval;
      this.max_opportunities = max_opportunities;
      this.promotion_slots = promotion_slots;
      this.reserved = reserved;
      this.bootstrap_minted = bootstrap_minted;
    }
  }

  @unmanaged
  export class reward_epoch {
    static encode(message: reward_epoch, writer: Writer): void {
      if (message.id != 0) {
        writer.uint32(8);
        writer.uint64(message.id);
      }

      if (message.start_block != 0) {
        writer.uint32(16);
        writer.uint64(message.start_block);
      }

      if (message.end_block != 0) {
        writer.uint32(24);
        writer.uint64(message.end_block);
      }

      if (message.budget != 0) {
        writer.uint32(32);
        writer.uint64(message.budget);
      }

      if (message.total_score != 0) {
        writer.uint32(40);
        writer.uint64(message.total_score);
      }

      if (message.total_weight != 0) {
        writer.uint32(48);
        writer.uint64(message.total_weight);
      }

      if (message.post_count != 0) {
        writer.uint32(56);
        writer.uint64(message.post_count);
      }

      if (message.settled_count != 0) {
        writer.uint32(64);
        writer.uint64(message.settled_count);
      }

      if (message.paid != 0) {
        writer.uint32(72);
        writer.uint64(message.paid);
      }
    }

    static decode(reader: Reader, length: i32): reward_epoch {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new reward_epoch();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.id = reader.uint64();
            break;

          case 2:
            message.start_block = reader.uint64();
            break;

          case 3:
            message.end_block = reader.uint64();
            break;

          case 4:
            message.budget = reader.uint64();
            break;

          case 5:
            message.total_score = reader.uint64();
            break;

          case 6:
            message.total_weight = reader.uint64();
            break;

          case 7:
            message.post_count = reader.uint64();
            break;

          case 8:
            message.settled_count = reader.uint64();
            break;

          case 9:
            message.paid = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    id: u64;
    start_block: u64;
    end_block: u64;
    budget: u64;
    total_score: u64;
    total_weight: u64;
    post_count: u64;
    settled_count: u64;
    paid: u64;

    constructor(
      id: u64 = 0,
      start_block: u64 = 0,
      end_block: u64 = 0,
      budget: u64 = 0,
      total_score: u64 = 0,
      total_weight: u64 = 0,
      post_count: u64 = 0,
      settled_count: u64 = 0,
      paid: u64 = 0
    ) {
      this.id = id;
      this.start_block = start_block;
      this.end_block = end_block;
      this.budget = budget;
      this.total_score = total_score;
      this.total_weight = total_weight;
      this.post_count = post_count;
      this.settled_count = settled_count;
      this.paid = paid;
    }
  }

  export class post_reward {
    static encode(message: post_reward, writer: Writer): void {
      const unique_name_post_id = message.post_id;
      if (unique_name_post_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_post_id);
      }

      const unique_name_version = message.version;
      if (unique_name_version !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_version);
      }

      const unique_name_author = message.author;
      if (unique_name_author !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_author);
      }

      if (message.epoch != 0) {
        writer.uint32(32);
        writer.uint64(message.epoch);
      }

      if (message.up != 0) {
        writer.uint32(40);
        writer.uint64(message.up);
      }

      if (message.down != 0) {
        writer.uint32(48);
        writer.uint64(message.down);
      }

      if (message.score != 0) {
        writer.uint32(56);
        writer.uint64(message.score);
      }

      if (message.settled != false) {
        writer.uint32(64);
        writer.bool(message.settled);
      }

      if (message.reward != 0) {
        writer.uint32(72);
        writer.uint64(message.reward);
      }
    }

    static decode(reader: Reader, length: i32): post_reward {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new post_reward();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.post_id = reader.bytes();
            break;

          case 2:
            message.version = reader.bytes();
            break;

          case 3:
            message.author = reader.bytes();
            break;

          case 4:
            message.epoch = reader.uint64();
            break;

          case 5:
            message.up = reader.uint64();
            break;

          case 6:
            message.down = reader.uint64();
            break;

          case 7:
            message.score = reader.uint64();
            break;

          case 8:
            message.settled = reader.bool();
            break;

          case 9:
            message.reward = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    post_id: Uint8Array | null;
    version: Uint8Array | null;
    author: Uint8Array | null;
    epoch: u64;
    up: u64;
    down: u64;
    score: u64;
    settled: bool;
    reward: u64;

    constructor(
      post_id: Uint8Array | null = null,
      version: Uint8Array | null = null,
      author: Uint8Array | null = null,
      epoch: u64 = 0,
      up: u64 = 0,
      down: u64 = 0,
      score: u64 = 0,
      settled: bool = false,
      reward: u64 = 0
    ) {
      this.post_id = post_id;
      this.version = version;
      this.author = author;
      this.epoch = epoch;
      this.up = up;
      this.down = down;
      this.score = score;
      this.settled = settled;
      this.reward = reward;
    }
  }

  @unmanaged
  export class ballot {
    static encode(message: ballot, writer: Writer): void {
      if (message.direction != 0) {
        writer.uint32(8);
        writer.uint32(message.direction);
      }

      if (message.weight != 0) {
        writer.uint32(16);
        writer.uint64(message.weight);
      }

      if (message.block != 0) {
        writer.uint32(24);
        writer.uint64(message.block);
      }
    }

    static decode(reader: Reader, length: i32): ballot {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new ballot();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.direction = reader.uint32();
            break;

          case 2:
            message.weight = reader.uint64();
            break;

          case 3:
            message.block = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    direction: u32;
    weight: u64;
    block: u64;

    constructor(direction: u32 = 0, weight: u64 = 0, block: u64 = 0) {
      this.direction = direction;
      this.weight = weight;
      this.block = block;
    }
  }

  export class promotion {
    static encode(message: promotion, writer: Writer): void {
      const unique_name_post_id = message.post_id;
      if (unique_name_post_id !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_post_id);
      }

      const unique_name_version = message.version;
      if (unique_name_version !== null) {
        writer.uint32(18);
        writer.bytes(unique_name_version);
      }

      const unique_name_author = message.author;
      if (unique_name_author !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_author);
      }

      if (message.nonce != 0) {
        writer.uint32(32);
        writer.uint64(message.nonce);
      }

      if (message.slot != 0) {
        writer.uint32(40);
        writer.uint32(message.slot);
      }

      if (message.start_block != 0) {
        writer.uint32(48);
        writer.uint64(message.start_block);
      }

      if (message.end_block != 0) {
        writer.uint32(56);
        writer.uint64(message.end_block);
      }

      if (message.interval != 0) {
        writer.uint32(64);
        writer.uint64(message.interval);
      }

      if (message.opportunities != 0) {
        writer.uint32(72);
        writer.uint32(message.opportunities);
      }

      if (message.burned != 0) {
        writer.uint32(80);
        writer.uint64(message.burned);
      }

      if (message.cancelled != false) {
        writer.uint32(88);
        writer.bool(message.cancelled);
      }
    }

    static decode(reader: Reader, length: i32): promotion {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new promotion();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.post_id = reader.bytes();
            break;

          case 2:
            message.version = reader.bytes();
            break;

          case 3:
            message.author = reader.bytes();
            break;

          case 4:
            message.nonce = reader.uint64();
            break;

          case 5:
            message.slot = reader.uint32();
            break;

          case 6:
            message.start_block = reader.uint64();
            break;

          case 7:
            message.end_block = reader.uint64();
            break;

          case 8:
            message.interval = reader.uint64();
            break;

          case 9:
            message.opportunities = reader.uint32();
            break;

          case 10:
            message.burned = reader.uint64();
            break;

          case 11:
            message.cancelled = reader.bool();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    post_id: Uint8Array | null;
    version: Uint8Array | null;
    author: Uint8Array | null;
    nonce: u64;
    slot: u32;
    start_block: u64;
    end_block: u64;
    interval: u64;
    opportunities: u32;
    burned: u64;
    cancelled: bool;

    constructor(
      post_id: Uint8Array | null = null,
      version: Uint8Array | null = null,
      author: Uint8Array | null = null,
      nonce: u64 = 0,
      slot: u32 = 0,
      start_block: u64 = 0,
      end_block: u64 = 0,
      interval: u64 = 0,
      opportunities: u32 = 0,
      burned: u64 = 0,
      cancelled: bool = false
    ) {
      this.post_id = post_id;
      this.version = version;
      this.author = author;
      this.nonce = nonce;
      this.slot = slot;
      this.start_block = start_block;
      this.end_block = end_block;
      this.interval = interval;
      this.opportunities = opportunities;
      this.burned = burned;
      this.cancelled = cancelled;
    }
  }

  @unmanaged
  export class activate_economy_arguments {
    static encode(message: activate_economy_arguments, writer: Writer): void {
      if (message.test_period_blocks != 0) {
        writer.uint32(8);
        writer.uint64(message.test_period_blocks);
      }
    }

    static decode(reader: Reader, length: i32): activate_economy_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new activate_economy_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.test_period_blocks = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    test_period_blocks: u64;

    constructor(test_period_blocks: u64 = 0) {
      this.test_period_blocks = test_period_blocks;
    }
  }

  @unmanaged
  export class activate_economy_result {
    static encode(message: activate_economy_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): activate_economy_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new activate_economy_result();

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

  export class grant_test_tokens_arguments {
    static encode(message: grant_test_tokens_arguments, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      if (message.value != 0) {
        writer.uint32(16);
        writer.uint64(message.value);
      }
    }

    static decode(reader: Reader, length: i32): grant_test_tokens_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new grant_test_tokens_arguments();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
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

    account: Uint8Array | null;
    value: u64;

    constructor(account: Uint8Array | null = null, value: u64 = 0) {
      this.account = account;
      this.value = value;
    }
  }

  @unmanaged
  export class grant_test_tokens_result {
    static encode(message: grant_test_tokens_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): grant_test_tokens_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new grant_test_tokens_result();

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

  export class vote_arguments {
    static encode(message: vote_arguments, writer: Writer): void {
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

      const unique_name_version = message.version;
      if (unique_name_version !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_version);
      }

      if (message.direction != 0) {
        writer.uint32(32);
        writer.uint32(message.direction);
      }

      if (message.weight != 0) {
        writer.uint32(40);
        writer.uint64(message.weight);
      }

      const unique_name_device = message.device;
      if (unique_name_device !== null) {
        writer.uint32(50);
        writer.bytes(unique_name_device);
      }
    }

    static decode(reader: Reader, length: i32): vote_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new vote_arguments();

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
            message.version = reader.bytes();
            break;

          case 4:
            message.direction = reader.uint32();
            break;

          case 5:
            message.weight = reader.uint64();
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

    actor: Uint8Array | null;
    post_id: Uint8Array | null;
    version: Uint8Array | null;
    direction: u32;
    weight: u64;
    device: Uint8Array | null;

    constructor(
      actor: Uint8Array | null = null,
      post_id: Uint8Array | null = null,
      version: Uint8Array | null = null,
      direction: u32 = 0,
      weight: u64 = 0,
      device: Uint8Array | null = null
    ) {
      this.actor = actor;
      this.post_id = post_id;
      this.version = version;
      this.direction = direction;
      this.weight = weight;
      this.device = device;
    }
  }

  @unmanaged
  export class vote_result {
    static encode(message: vote_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): vote_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new vote_result();

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

  export class settle_reward_arguments {
    static encode(message: settle_reward_arguments, writer: Writer): void {
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

    static decode(reader: Reader, length: i32): settle_reward_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new settle_reward_arguments();

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
  export class settle_reward_result {
    static encode(message: settle_reward_result, writer: Writer): void {
      if (message.reward != 0) {
        writer.uint32(8);
        writer.uint64(message.reward);
      }
    }

    static decode(reader: Reader, length: i32): settle_reward_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new settle_reward_result();

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

  export class promote_arguments {
    static encode(message: promote_arguments, writer: Writer): void {
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

      const unique_name_version = message.version;
      if (unique_name_version !== null) {
        writer.uint32(26);
        writer.bytes(unique_name_version);
      }

      if (message.nonce != 0) {
        writer.uint32(32);
        writer.uint64(message.nonce);
      }

      if (message.slot != 0) {
        writer.uint32(40);
        writer.uint32(message.slot);
      }

      if (message.opportunities != 0) {
        writer.uint32(48);
        writer.uint32(message.opportunities);
      }

      if (message.burn_amount != 0) {
        writer.uint32(56);
        writer.uint64(message.burn_amount);
      }
    }

    static decode(reader: Reader, length: i32): promote_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new promote_arguments();

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
            message.version = reader.bytes();
            break;

          case 4:
            message.nonce = reader.uint64();
            break;

          case 5:
            message.slot = reader.uint32();
            break;

          case 6:
            message.opportunities = reader.uint32();
            break;

          case 7:
            message.burn_amount = reader.uint64();
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
    version: Uint8Array | null;
    nonce: u64;
    slot: u32;
    opportunities: u32;
    burn_amount: u64;

    constructor(
      actor: Uint8Array | null = null,
      post_id: Uint8Array | null = null,
      version: Uint8Array | null = null,
      nonce: u64 = 0,
      slot: u32 = 0,
      opportunities: u32 = 0,
      burn_amount: u64 = 0
    ) {
      this.actor = actor;
      this.post_id = post_id;
      this.version = version;
      this.nonce = nonce;
      this.slot = slot;
      this.opportunities = opportunities;
      this.burn_amount = burn_amount;
    }
  }

  @unmanaged
  export class promote_result {
    static encode(message: promote_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): promote_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new promote_result();

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

  export class cancel_promotion_arguments {
    static encode(message: cancel_promotion_arguments, writer: Writer): void {
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

      if (message.nonce != 0) {
        writer.uint32(24);
        writer.uint64(message.nonce);
      }
    }

    static decode(reader: Reader, length: i32): cancel_promotion_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new cancel_promotion_arguments();

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
            message.nonce = reader.uint64();
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
    nonce: u64;

    constructor(
      actor: Uint8Array | null = null,
      post_id: Uint8Array | null = null,
      nonce: u64 = 0
    ) {
      this.actor = actor;
      this.post_id = post_id;
      this.nonce = nonce;
    }
  }

  @unmanaged
  export class cancel_promotion_result {
    static encode(message: cancel_promotion_result, writer: Writer): void {}

    static decode(reader: Reader, length: i32): cancel_promotion_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new cancel_promotion_result();

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
  export class get_economy_arguments {
    static encode(message: get_economy_arguments, writer: Writer): void {}

    static decode(reader: Reader, length: i32): get_economy_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_economy_arguments();

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
  export class get_economy_result {
    static encode(message: get_economy_result, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        economy_config.encode(unique_name_value, writer);
        writer.ldelim();
      }

      if (message.block != 0) {
        writer.uint32(16);
        writer.uint64(message.block);
      }

      if (message.current_epoch != 0) {
        writer.uint32(24);
        writer.uint64(message.current_epoch);
      }
    }

    static decode(reader: Reader, length: i32): get_economy_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_economy_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = economy_config.decode(reader, reader.uint32());
            break;

          case 2:
            message.block = reader.uint64();
            break;

          case 3:
            message.current_epoch = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: economy_config | null;
    block: u64;
    current_epoch: u64;

    constructor(
      value: economy_config | null = null,
      block: u64 = 0,
      current_epoch: u64 = 0
    ) {
      this.value = value;
      this.block = block;
      this.current_epoch = current_epoch;
    }
  }

  export class get_post_economy_arguments {
    static encode(message: get_post_economy_arguments, writer: Writer): void {
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

    static decode(reader: Reader, length: i32): get_post_economy_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_post_economy_arguments();

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

  export class get_post_economy_result {
    static encode(message: get_post_economy_result, writer: Writer): void {
      const unique_name_reward = message.reward;
      if (unique_name_reward !== null) {
        writer.uint32(10);
        writer.fork();
        post_reward.encode(unique_name_reward, writer);
        writer.ldelim();
      }

      const unique_name_vote = message.vote;
      if (unique_name_vote !== null) {
        writer.uint32(18);
        writer.fork();
        ballot.encode(unique_name_vote, writer);
        writer.ldelim();
      }

      const unique_name_epoch = message.epoch;
      if (unique_name_epoch !== null) {
        writer.uint32(26);
        writer.fork();
        reward_epoch.encode(unique_name_epoch, writer);
        writer.ldelim();
      }

      const unique_name_promotion = message.promotion;
      if (unique_name_promotion !== null) {
        writer.uint32(34);
        writer.fork();
        promotion.encode(unique_name_promotion, writer);
        writer.ldelim();
      }

      if (message.block != 0) {
        writer.uint32(40);
        writer.uint64(message.block);
      }
    }

    static decode(reader: Reader, length: i32): get_post_economy_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_post_economy_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.reward = post_reward.decode(reader, reader.uint32());
            break;

          case 2:
            message.vote = ballot.decode(reader, reader.uint32());
            break;

          case 3:
            message.epoch = reward_epoch.decode(reader, reader.uint32());
            break;

          case 4:
            message.promotion = promotion.decode(reader, reader.uint32());
            break;

          case 5:
            message.block = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    reward: post_reward | null;
    vote: ballot | null;
    epoch: reward_epoch | null;
    promotion: promotion | null;
    block: u64;

    constructor(
      reward: post_reward | null = null,
      vote: ballot | null = null,
      epoch: reward_epoch | null = null,
      promotion: promotion | null = null,
      block: u64 = 0
    ) {
      this.reward = reward;
      this.vote = vote;
      this.epoch = epoch;
      this.promotion = promotion;
      this.block = block;
    }
  }

  @unmanaged
  export class get_promotions_arguments {
    static encode(message: get_promotions_arguments, writer: Writer): void {}

    static decode(reader: Reader, length: i32): get_promotions_arguments {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_promotions_arguments();

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

  export class get_promotions_result {
    static encode(message: get_promotions_result, writer: Writer): void {
      const unique_name_values = message.values;
      for (let i = 0; i < unique_name_values.length; ++i) {
        writer.uint32(10);
        writer.fork();
        promotion.encode(unique_name_values[i], writer);
        writer.ldelim();
      }

      if (message.block != 0) {
        writer.uint32(16);
        writer.uint64(message.block);
      }
    }

    static decode(reader: Reader, length: i32): get_promotions_result {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new get_promotions_result();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.values.push(promotion.decode(reader, reader.uint32()));
            break;

          case 2:
            message.block = reader.uint64();
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    values: Array<promotion>;
    block: u64;

    constructor(values: Array<promotion> = [], block: u64 = 0) {
      this.values = values;
      this.block = block;
    }
  }

  @unmanaged
  export class economy_activated_event {
    static encode(message: economy_activated_event, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        economy_config.encode(unique_name_value, writer);
        writer.ldelim();
      }
    }

    static decode(reader: Reader, length: i32): economy_activated_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new economy_activated_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = economy_config.decode(reader, reader.uint32());
            break;

          default:
            reader.skipType(tag & 7);
            break;
        }
      }

      return message;
    }

    value: economy_config | null;

    constructor(value: economy_config | null = null) {
      this.value = value;
    }
  }

  export class test_tokens_granted_event {
    static encode(message: test_tokens_granted_event, writer: Writer): void {
      const unique_name_account = message.account;
      if (unique_name_account !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_account);
      }

      if (message.value != 0) {
        writer.uint32(16);
        writer.uint64(message.value);
      }

      if (message.cumulative != 0) {
        writer.uint32(24);
        writer.uint64(message.cumulative);
      }

      if (message.timestamp != 0) {
        writer.uint32(32);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): test_tokens_granted_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new test_tokens_granted_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.account = reader.bytes();
            break;

          case 2:
            message.value = reader.uint64();
            break;

          case 3:
            message.cumulative = reader.uint64();
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
    value: u64;
    cumulative: u64;
    timestamp: u64;

    constructor(
      account: Uint8Array | null = null,
      value: u64 = 0,
      cumulative: u64 = 0,
      timestamp: u64 = 0
    ) {
      this.account = account;
      this.value = value;
      this.cumulative = cumulative;
      this.timestamp = timestamp;
    }
  }

  export class voted_event {
    static encode(message: voted_event, writer: Writer): void {
      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(18);
        writer.fork();
        post_reward.encode(unique_name_value, writer);
        writer.ldelim();
      }

      const unique_name_vote = message.vote;
      if (unique_name_vote !== null) {
        writer.uint32(26);
        writer.fork();
        ballot.encode(unique_name_vote, writer);
        writer.ldelim();
      }

      const unique_name_epoch = message.epoch;
      if (unique_name_epoch !== null) {
        writer.uint32(34);
        writer.fork();
        reward_epoch.encode(unique_name_epoch, writer);
        writer.ldelim();
      }

      if (message.timestamp != 0) {
        writer.uint32(40);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): voted_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new voted_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
            message.value = post_reward.decode(reader, reader.uint32());
            break;

          case 3:
            message.vote = ballot.decode(reader, reader.uint32());
            break;

          case 4:
            message.epoch = reward_epoch.decode(reader, reader.uint32());
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
    value: post_reward | null;
    vote: ballot | null;
    epoch: reward_epoch | null;
    timestamp: u64;

    constructor(
      actor: Uint8Array | null = null,
      value: post_reward | null = null,
      vote: ballot | null = null,
      epoch: reward_epoch | null = null,
      timestamp: u64 = 0
    ) {
      this.actor = actor;
      this.value = value;
      this.vote = vote;
      this.epoch = epoch;
      this.timestamp = timestamp;
    }
  }

  export class reward_settled_event {
    static encode(message: reward_settled_event, writer: Writer): void {
      const unique_name_actor = message.actor;
      if (unique_name_actor !== null) {
        writer.uint32(10);
        writer.bytes(unique_name_actor);
      }

      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(18);
        writer.fork();
        post_reward.encode(unique_name_value, writer);
        writer.ldelim();
      }

      const unique_name_epoch = message.epoch;
      if (unique_name_epoch !== null) {
        writer.uint32(26);
        writer.fork();
        reward_epoch.encode(unique_name_epoch, writer);
        writer.ldelim();
      }

      if (message.timestamp != 0) {
        writer.uint32(32);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): reward_settled_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new reward_settled_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.actor = reader.bytes();
            break;

          case 2:
            message.value = post_reward.decode(reader, reader.uint32());
            break;

          case 3:
            message.epoch = reward_epoch.decode(reader, reader.uint32());
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
    value: post_reward | null;
    epoch: reward_epoch | null;
    timestamp: u64;

    constructor(
      actor: Uint8Array | null = null,
      value: post_reward | null = null,
      epoch: reward_epoch | null = null,
      timestamp: u64 = 0
    ) {
      this.actor = actor;
      this.value = value;
      this.epoch = epoch;
      this.timestamp = timestamp;
    }
  }

  export class promotion_changed_event {
    static encode(message: promotion_changed_event, writer: Writer): void {
      const unique_name_value = message.value;
      if (unique_name_value !== null) {
        writer.uint32(10);
        writer.fork();
        promotion.encode(unique_name_value, writer);
        writer.ldelim();
      }

      if (message.timestamp != 0) {
        writer.uint32(16);
        writer.uint64(message.timestamp);
      }
    }

    static decode(reader: Reader, length: i32): promotion_changed_event {
      const end: usize = length < 0 ? reader.end : reader.ptr + length;
      const message = new promotion_changed_event();

      while (reader.ptr < end) {
        const tag = reader.uint32();
        switch (tag >>> 3) {
          case 1:
            message.value = promotion.decode(reader, reader.uint32());
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

    value: promotion | null;
    timestamp: u64;

    constructor(value: promotion | null = null, timestamp: u64 = 0) {
      this.value = value;
      this.timestamp = timestamp;
    }
  }
}
