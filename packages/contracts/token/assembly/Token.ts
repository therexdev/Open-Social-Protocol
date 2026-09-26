import { System, Storage, Protobuf, authority, Arrays } from "@koinos/sdk-as";
import { token } from "./proto/token";
import { publications } from "./proto/publications";
import { relationships } from "./proto/relationships";
import { Actor, Capability, IS_BLOCKED_ENTRY_POINT } from "./common/actor";
import { Util } from "./common/util";
import { Recharge, FULL, height } from "./Recharge";
System.setSystemBufferSize(32 * 1024);
const DAY: u64 = 86400000;
const FREE: u64 = 100000; // 100 actions; 1000 resource units per action.
const PER_TOKEN: u64 = 1000;
const MAX_SUPPLY: u64 = 1000000; // pilot maximum, not a mainnet economic commitment.

export class Token {
  id: Uint8Array = System.getContractId();
  config: Storage.Obj<token.config> = new Storage.Obj<token.config>(this.id, 1, token.config.decode, token.config.encode, null);
  accounts: Storage.Map<Uint8Array, token.account_state> = new Storage.Map<Uint8Array, token.account_state>(
    this.id,
    2,
    token.account_state.decode,
    token.account_state.encode,
    null
  );
  supports: Storage.Map<Uint8Array, token.reward_state> = new Storage.Map<Uint8Array, token.reward_state>(
    this.id,
    3,
    token.reward_state.decode,
    token.reward_state.encode,
    null
  );
  rewards: Storage.Map<Uint8Array, token.reward_state> = new Storage.Map<Uint8Array, token.reward_state>(
    this.id,
    4,
    token.reward_state.decode,
    token.reward_state.encode,
    null
  );
  global: Storage.Obj<token.reward_state> = new Storage.Obj<token.reward_state>(
    this.id,
    5,
    token.reward_state.decode,
    token.reward_state.encode,
    null
  );
  cfg(): token.config {
    const c = this.config.get();
    System.require(c != null, "token not configured");
    return c!;
  }
  init(args: token.init_arguments): token.init_result {
    System.requireAuthority(authority.authorization_type.contract_call, this.id);
    System.require(this.config.get() == null, "already initialized");
    this.config.put(
      new token.config(
        Util.requireAddress(args.identity, "identity"),
        Util.requireAddress(args.relationships, "relationships"),
        Util.requireAddress(args.publications, "publications"),
        Util.requireAddress(args.messaging, "messaging"),
        1,
        1000,
        10,
        0,
        2,
        height(),
        Util.now()
      )
    );
    return new token.init_result();
  }
  set_reward_policy(args: token.set_reward_policy_arguments): token.set_reward_policy_result {
    System.requireAuthority(authority.authorization_type.contract_call, this.id);
    System.require(
      args.reward_amount <= 10 && args.daily_reward_cap <= 10000 && args.recipient_daily_cap <= 100,
      "reward policy exceeds pilot bounds"
    );
    const c = this.cfg();
    c.reward_amount = args.reward_amount;
    c.daily_reward_cap = args.daily_reward_cap;
    c.recipient_daily_cap = args.recipient_daily_cap;
    this.config.put(c);
    System.event(
      "osp.token.policy_changed",
      Protobuf.encode(
        new token.policy_changed_event(c.reward_amount, c.daily_reward_cap, c.recipient_daily_cap, Util.now()),
        token.policy_changed_event.encode
      ),
      []
    );
    return new token.set_reward_policy_result();
  }
  activate_recharge(args: token.activate_recharge_arguments): token.activate_recharge_result {
    System.requireAuthority(authority.authorization_type.contract_call, this.id);
    const c = this.cfg();
    System.require(c.resource_version == 0, "recharge already activated");
    c.resource_version = 2;
    c.activation_block = height();
    c.activation_time = Util.now();
    this.config.put(c);
    System.event("osp.token.recharge_activated", Protobuf.encode(
      new token.recharge_activated_event(2, c.activation_block, c.activation_time, FULL, 100),
      token.recharge_activated_event.encode), []);
    return new token.activate_recharge_result();
  }
  open(account: Uint8Array): Recharge {
    const c = this.cfg();
    System.require(c.resource_version == 2, "five-day recharge upgrade is not activated");
    let a = this.accounts.get(account);
    if (a == null) a = new token.account_state(0, FREE, 0, c.activation_time);
    return new Recharge(this.id, account, a!, c, height());
  }
  load(account: Uint8Array): token.account_state {
    const r = this.open(account);
    return r.summarize(r.value);
  }
  save(account: Uint8Array, r: Recharge): void {
    const a = r.summarize(r.value);
    r.save();
    this.accounts.put(account, a);
    System.event(
      "osp.token.account_updated",
      Protobuf.encode(new token.account_updated_event(account, a, Util.now()), token.account_updated_event.encode),
      [account]
    );
  }
  spend(account: Uint8Array, units: u64): void {
    System.require(units > 0 && units <= 100, "invalid usage cost");
    const r = this.open(account), cost = units * FULL;
    System.require(r.capacity(0) + r.capacity(1) >= cost, "usage allowance exhausted; wait for regeneration");
    const free = min<u64>(r.capacity(0), cost);
    r.spend(0, free);
    r.spend(1, cost - free);
    this.save(account, r);
  }
  consume(args: token.consume_arguments): token.consume_result {
    const c = this.cfg(),
      caller = System.getCaller().caller;
    System.require(
      caller != null &&
        (Arrays.equal(caller!, c.publications!) || Arrays.equal(caller!, c.messaging!) || Arrays.equal(caller!, c.relationships!)),
      "only protocol contracts may consume credits"
    );
    this.spend(Util.requireAddress(args.account, "account"), args.units);
    return new token.consume_result();
  }
  transfer(args: token.transfer_arguments): token.transfer_result {
    const from = Util.requireAddress(args.from, "from"),
      to = Util.requireAddress(args.to, "to");
    System.require(!Arrays.equal(from, to), "cannot transfer to yourself");
    Actor.requireAuthorized(this.cfg().identity!, from, null, 0);
    System.require(Actor.exists(this.cfg().identity!, to), "recipient not registered");
    const a = this.open(from), b = this.open(to);
    System.require(args.value > 0 && args.value <= a.state.paid_ready, "insufficient transferable tokens; used tokens recharge before transfer");
    a.value.balance -= args.value;
    a.state.paid_ready -= args.value;
    b.value.balance += args.value;
    b.state.paid_ready += args.value;
    this.save(from, a);
    this.save(to, b);
    System.event(
      "osp.token.transfer",
      Protobuf.encode(new token.transfer_event(from, to, args.value, Util.now()), token.transfer_event.encode),
      [from, to]
    );
    return new token.transfer_result();
  }
  burn(args: token.burn_arguments): token.burn_result {
    const from = Util.requireAddress(args.from, "from"),
      c = this.cfg();
    Actor.requireAuthorized(c.identity!, from, null, 0);
    const a = this.open(from);
    System.require(args.value > 0 && args.value <= a.state.paid_ready, "insufficient transferable tokens; used tokens recharge before burning");
    a.state.paid_ready -= args.value;
    a.value.balance -= args.value;
    System.require(c.supply >= args.value, "invalid token supply");
    c.supply -= args.value;
    this.config.put(c);
    this.save(from, a);
    System.event("osp.token.burn", Protobuf.encode(new token.burn_event(from, args.value, Util.now()), token.burn_event.encode), [from]);
    return new token.burn_result();
  }
  support(args: token.support_arguments): token.support_result {
    const actor = Util.requireAddress(args.actor, "actor"),
      id = Util.requireBytes(args.post_id, 32, "post id"),
      c = this.cfg();
    System.require(id.length == 32, "post id must be 32 bytes");
    Actor.requireAuthorized(c.identity!, actor, args.device, Capability.SUPPORT);
    const call = System.call(
      c.publications!,
      0xe7392850,
      Protobuf.encode(new publications.get_post_arguments(id), publications.get_post_arguments.encode)
    );
    System.require(call.code == 0 && call.res.object != null, "post lookup failed");
    const post = Protobuf.decode<publications.get_post_result>(call.res.object!, publications.get_post_result.decode).value;
    System.require(post != null && post.state == publications.lifecycle_state.active, "post is not active");
    const recipient = post!.author!;
    System.require(!Arrays.equal(actor, recipient), "cannot support your own post");
    for (let i = 0; i < 2; i++) {
      const check = System.call(
        c.relationships!,
        IS_BLOCKED_ENTRY_POINT,
        Protobuf.encode(
          new relationships.is_blocked_arguments(i == 0 ? actor : recipient, i == 0 ? recipient : actor),
          relationships.is_blocked_arguments.encode
        )
      );
      System.require(check.code == 0 && check.res.object != null, "block lookup failed");
      System.require(
        !Protobuf.decode<relationships.is_blocked_result>(check.res.object!, relationships.is_blocked_result.decode).value,
        "support blocked"
      );
    }
    const key = Util.concat([actor, id]);
    System.require(this.supports.get(key) == null, "already supported this post");
    this.spend(actor, 1);
    const day = Util.now() / DAY;
    let global = this.global.get(),
      user = this.rewards.get(recipient);
    if (global == null || global.day != day) global = new token.reward_state(day, 0);
    if (user == null || user.day != day) user = new token.reward_state(day, 0);
    let reward = c.reward_amount;
    reward = min<u64>(reward, c.daily_reward_cap > global.minted ? c.daily_reward_cap - global.minted : 0);
    reward = min<u64>(reward, c.recipient_daily_cap > user.minted ? c.recipient_daily_cap - user.minted : 0);
    reward = min<u64>(reward, MAX_SUPPLY - c.supply);
    this.supports.put(key, new token.reward_state(day, reward));
    global.minted += reward;
    user.minted += reward;
    this.global.put(global);
    this.rewards.put(recipient, user);
    if (reward > 0) {
      const a = this.open(recipient);
      a.value.balance += reward;
      a.state.paid_ready += reward;
      c.supply += reward;
      this.config.put(c);
      this.save(recipient, a);
    }
    System.event(
      "osp.token.supported",
      Protobuf.encode(new token.supported_event(actor, recipient, id, reward, Util.now()), token.supported_event.encode),
      [actor, recipient]
    );
    return new token.support_result(reward);
  }
  get_config(args: token.get_config_arguments): token.get_config_result {
    return new token.get_config_result(this.config.get());
  }
  get_account(args: token.get_account_arguments): token.get_account_result {
    const a = this.load(Util.requireAddress(args.account, "account"));
    return new token.get_account_result(a, FREE + a.balance * PER_TOKEN);
  }
  balance_of(args: token.balance_of_arguments): token.balance_of_result {
    return new token.balance_of_result(this.load(Util.requireAddress(args.owner, "owner")).balance);
  }
  total_supply(args: token.total_supply_arguments): token.total_supply_result {
    return new token.total_supply_result(this.cfg().supply);
  }
  name(args: token.name_arguments): token.name_result {
    return new token.name_result("Open Social Action Token");
  }
  symbol(args: token.symbol_arguments): token.symbol_result {
    return new token.symbol_result("OSAT");
  }
  decimals(args: token.decimals_arguments): token.decimals_result {
    return new token.decimals_result(0);
  }
}
