import { Arrays, Base64, Protobuf, Storage, System, authority } from "@koinos/sdk-as";
import { Token } from "./Token";
import { token } from "./proto/token";
import { publications } from "./proto/publications";
import { relationships } from "./proto/relationships";
import { Actor, Capability, IS_BLOCKED_ENTRY_POINT } from "./common/actor";
import { Util } from "./common/util";
import { FULL, height } from "./Recharge";

const MAX_SUPPLY: u64 = 1000000;
export const HARBINGER = "EiAIKVvm6+V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==";

/** Bounded, incremental reward accounting. No settlement scans or voter loops. */
export class Economy {
  config: Storage.Obj<token.economy_config>;
  epochs: Storage.Map<Uint8Array, token.reward_epoch>;
  posts: Storage.Map<Uint8Array, token.post_reward>;
  ballots: Storage.Map<Uint8Array, token.ballot>;
  promotions: Storage.Map<Uint8Array, token.promotion>;
  slots: Storage.Map<Uint8Array, token.promotion>;
  grants: Storage.Map<Uint8Array, token.reward_state>;

  constructor(public owner: Token) {
    const id = owner.id;
    this.config = new Storage.Obj<token.economy_config>(id, 8, token.economy_config.decode, token.economy_config.encode, null);
    this.epochs = new Storage.Map<Uint8Array, token.reward_epoch>(id, 9, token.reward_epoch.decode, token.reward_epoch.encode, null);
    this.posts = new Storage.Map<Uint8Array, token.post_reward>(id, 10, token.post_reward.decode, token.post_reward.encode, null);
    this.ballots = new Storage.Map<Uint8Array, token.ballot>(id, 11, token.ballot.decode, token.ballot.encode, null);
    this.promotions = new Storage.Map<Uint8Array, token.promotion>(id, 12, token.promotion.decode, token.promotion.encode, null);
    this.slots = new Storage.Map<Uint8Array, token.promotion>(id, 13, token.promotion.decode, token.promotion.encode, null);
    this.grants = new Storage.Map<Uint8Array, token.reward_state>(id, 14, token.reward_state.decode, token.reward_state.encode, null);
  }
  cfg(): token.economy_config {
    const c = this.config.get();
    System.require(c != null && c.version == 1, "reward voting and promotion are not activated");
    return c!;
  }
  testnet(): void {
    System.require(Arrays.equal(System.getChainId(), Base64.decode(HARBINGER)), "pilot economy is restricted to Harbinger");
  }
  activate(testPeriod: u64 = 0): void {
    System.requireAuthority(authority.authorization_type.contract_call, this.owner.id);
    this.testnet();
    const c = this.owner.cfg();
    System.require(c.supply <= MAX_SUPPLY, "existing supply exceeds pilot cap");
    System.require(c.resource_version == 2, "activate five-day recharge first");
    System.require(c.economy_version == 0 && this.config.get() == null, "economy already activated");
    System.require(testPeriod == 0 || (testPeriod >= 60 && testPeriod <= FULL), "test period must be between 60 and 144000 blocks");
    const e = new token.economy_config(1, height(), testPeriod == 0 ? FULL : testPeriod, 100, 1, 1000, 1000, 1000000, 1, 1200, 5, 32, 0, 0);
    c.economy_version = 1;
    this.owner.config.put(c);
    this.config.put(e);
    System.event("osp.token.economy_activated", Protobuf.encode(new token.economy_activated_event(e), token.economy_activated_event.encode), []);
  }
  current(c: token.economy_config, block: u64): u64 {
    System.require(block >= c.activation_block, "block precedes economy activation");
    return (block - c.activation_block) / c.period_blocks + 1;
  }
  score(up: u64, down: u64, c: token.economy_config): u64 {
    const n = up > down ? up - down : 0;
    // n <= 1,000,000: n*n*1000 and budget*score both fit in u64.
    return n * n * c.score_scale / (n + c.curve_constant);
  }
  id(value: Uint8Array | null): Uint8Array {
    const id = Util.requireBytes(value, 32, "post id");
    System.require(id.length == 32, "post id must be 32 bytes");
    return id;
  }
  post(id: Uint8Array): publications.post_record {
    const call = System.call(this.owner.cfg().publications!, 0xe7392850,
      Protobuf.encode(new publications.get_post_arguments(id), publications.get_post_arguments.encode));
    System.require(call.code == 0 && call.res.object != null, "post lookup failed");
    const p = Protobuf.decode<publications.get_post_result>(call.res.object!, publications.get_post_result.decode).value;
    System.require(p != null, "post not found");
    return p!;
  }
  eligible(p: publications.post_record, version: Uint8Array | null): bool {
    return p.state == publications.lifecycle_state.active && p.audience == publications.audience_kind.everyone &&
      version != null && version!.length == 32 && p.latest_version != null && Arrays.equal(p.latest_version!, version!);
  }
  unblocked(actor: Uint8Array, author: Uint8Array): void {
    for (let i = 0; i < 2; i++) {
      const call = System.call(this.owner.cfg().relationships!, IS_BLOCKED_ENTRY_POINT,
        Protobuf.encode(new relationships.is_blocked_arguments(i == 0 ? actor : author, i == 0 ? author : actor), relationships.is_blocked_arguments.encode));
      System.require(call.code == 0 && call.res.object != null, "block lookup failed");
      System.require(!Protobuf.decode<relationships.is_blocked_result>(call.res.object!, relationships.is_blocked_result.decode).value, "voting blocked");
    }
  }
  grant(args: token.grant_test_tokens_arguments): void {
    System.requireAuthority(authority.authorization_type.contract_call, this.owner.id);
    this.testnet();
    const account = Util.requireAddress(args.account, "account"), e = this.cfg(), c = this.owner.cfg();
    System.require(Actor.exists(c.identity!, account), "tester is not registered");
    let grant = this.grants.get(account);
    if (grant == null) grant = new token.reward_state();
    System.require(args.value > 0 && args.value <= 100 && grant.minted + args.value <= 100, "tester grant exceeds 100-token lifetime cap");
    System.require(e.bootstrap_minted + args.value <= 10000, "test bootstrap cap reached");
    System.require(c.supply + e.reserved + args.value <= MAX_SUPPLY, "token supply cap reached");
    const r = this.owner.open(account);
    r.value.balance += args.value;
    r.state.paid_ready += args.value;
    grant.minted += args.value;
    e.bootstrap_minted += args.value;
    c.supply += args.value;
    this.grants.put(account, grant);
    this.config.put(e);
    this.owner.config.put(c);
    this.owner.save(account, r);
    System.event("osp.token.test_tokens_granted", Protobuf.encode(new token.test_tokens_granted_event(account, args.value, grant.minted, Util.now()), token.test_tokens_granted_event.encode), [account]);
  }
  vote(args: token.vote_arguments): void {
    const actor = Util.requireAddress(args.actor, "actor"), id = this.id(args.post_id), e = this.cfg(), block = height();
    Actor.requireAuthorized(this.owner.cfg().identity!, actor, args.device, Capability.SUPPORT);
    System.require((args.direction == 1 || args.direction == 2) && args.weight > 0 && args.weight <= e.max_vote_weight, "invalid vote direction or weight");
    const p = this.post(id);
    System.require(this.eligible(p, args.version), "vote requires the current active public post version");
    System.require(!Arrays.equal(actor, p.author!), "cannot vote on your own post");
    this.unblocked(actor, p.author!);
    const key = Util.concat([actor, id]);
    System.require(this.ballots.get(key) == null, "already voted on this post; ballots cannot be changed");
    const epochId = this.current(e, block);
    let reward = this.posts.get(id);
    if (reward == null) reward = new token.post_reward(id, args.version, p.author, epochId);
    System.require(!reward.settled && reward.epoch == epochId && Arrays.equal(reward.version!, args.version!), "this post's reward voting window is closed");
    let epoch = this.epochs.get(Util.u64be(epochId));
    if (epoch == null) {
      const start = e.activation_block + (epochId - 1) * e.period_blocks;
      const budget = min<u64>(e.period_budget, MAX_SUPPLY - this.owner.cfg().supply - e.reserved);
      epoch = new token.reward_epoch(epochId, start, start + e.period_blocks, budget);
      e.reserved += budget;
    }
    System.require(epoch.total_weight + args.weight <= e.max_period_weight, "period vote capacity reached");
    const r = this.owner.open(actor), cost = args.weight * FULL;
    System.require(r.capacity(1) >= cost, "insufficient paid vote capacity; free credits cannot fund votes");
    r.spend(1, cost);
    const oldScore = reward.score;
    if (reward.up + reward.down == 0) epoch.post_count++;
    if (args.direction == 1) reward.up += args.weight;
    else reward.down += args.weight;
    reward.score = this.score(reward.up, reward.down, e);
    epoch.total_score = epoch.total_score - oldScore + reward.score;
    epoch.total_weight += args.weight;
    const vote = new token.ballot(args.direction, args.weight, block);
    this.ballots.put(key, vote);
    this.posts.put(id, reward);
    this.epochs.put(Util.u64be(epochId), epoch);
    this.config.put(e);
    this.owner.save(actor, r);
    System.event("osp.token.voted", Protobuf.encode(new token.voted_event(actor, reward, vote, epoch, Util.now()), token.voted_event.encode), [actor, p.author!]);
  }
  settle(args: token.settle_reward_arguments): u64 {
    const actor = Util.requireAddress(args.actor, "actor"), id = this.id(args.post_id), e = this.cfg(), c = this.owner.cfg();
    Actor.requireAuthorized(c.identity!, actor, args.device, Capability.SUPPORT);
    const reward = this.posts.get(id);
    System.require(reward != null && !reward.settled, "no unsettled reward for this post");
    const epoch = this.epochs.get(Util.u64be(reward!.epoch));
    System.require(epoch != null && height() >= epoch.end_block, "reward period is still open");
    const p = this.post(id);
    const amount = this.eligible(p, reward!.version) && epoch!.total_score > 0 ? epoch!.budget * reward!.score / epoch!.total_score : 0;
    System.require(amount <= e.reserved && epoch!.paid + amount <= epoch!.budget, "invalid reward reserve");
    // Claims never refill an existing token, even when the claimant is the author.
    if (amount > 0) {
      const r = this.owner.open(reward!.author!);
      r.value.balance += amount;
      r.state.paid_ready += amount;
      c.supply += amount;
      this.owner.save(reward!.author!, r);
    }
    reward!.settled = true;
    reward!.reward = amount;
    epoch!.paid += amount;
    epoch!.settled_count++;
    e.reserved -= amount;
    if (epoch!.settled_count == epoch!.post_count) e.reserved -= epoch!.budget - epoch!.paid;
    System.require(c.supply + e.reserved <= MAX_SUPPLY, "token supply cap reached");
    this.posts.put(id, reward!);
    this.epochs.put(Util.u64be(epoch!.id), epoch!);
    this.config.put(e);
    this.owner.config.put(c);
    System.event("osp.token.reward_settled", Protobuf.encode(new token.reward_settled_event(actor, reward, epoch, Util.now()), token.reward_settled_event.encode), [actor, reward!.author!]);
    return amount;
  }
  active(p: token.promotion | null, block: u64): bool {
    return p != null && !p.cancelled && p.end_block > block;
  }
  promote(args: token.promote_arguments): void {
    const actor = Util.requireAddress(args.actor, "actor"), id = this.id(args.post_id), e = this.cfg(), c = this.owner.cfg(), block = height();
    Actor.requireAuthorized(c.identity!, actor, null, 0);
    const p = this.post(id);
    System.require(Arrays.equal(actor, p.author!) && this.eligible(p, args.version), "only the author may promote their current public post");
    System.require(args.slot < e.promotion_slots && args.opportunities > 0 && args.opportunities <= e.max_opportunities, "invalid promotion slot or opportunities");
    System.require(args.burn_amount == <u64>args.opportunities * e.promotion_price, "approved burn amount does not match the price");
    const old = this.promotions.get(id);
    System.require(!this.active(old, block), "this post already has an active promotion");
    System.require(args.nonce == (old == null ? 1 : old.nonce + 1), "promotion nonce changed; refresh before purchasing");
    System.require(!this.active(this.slots.get(Util.u32be(args.slot)), block), "promotion slot was taken; refresh before purchasing");
    const r = this.owner.open(actor);
    System.require(args.burn_amount <= r.state.paid_ready, "promotion requires fully charged tokens; used tokens are locked");
    System.require(c.supply >= args.burn_amount, "invalid token supply");
    r.value.balance -= args.burn_amount;
    r.state.paid_ready -= args.burn_amount;
    c.supply -= args.burn_amount;
    const promo = new token.promotion(id, args.version, actor, args.nonce, args.slot, block,
      block + <u64>args.opportunities * e.promotion_interval, e.promotion_interval, args.opportunities, args.burn_amount, false);
    this.promotions.put(id, promo);
    this.slots.put(Util.u32be(args.slot), promo);
    this.owner.config.put(c);
    this.owner.save(actor, r);
    System.event("osp.token.burn", Protobuf.encode(new token.burn_event(actor, args.burn_amount, Util.now()), token.burn_event.encode), [actor]);
    System.event("osp.token.promotion_changed", Protobuf.encode(new token.promotion_changed_event(promo, Util.now()), token.promotion_changed_event.encode), [actor]);
  }
  cancel(args: token.cancel_promotion_arguments): void {
    const actor = Util.requireAddress(args.actor, "actor"), id = this.id(args.post_id);
    Actor.requireAuthorized(this.owner.cfg().identity!, actor, null, 0);
    const p = this.promotions.get(id);
    System.require(p != null && Arrays.equal(p.author!, actor) && p.nonce == args.nonce && this.active(p, height()), "no matching active promotion");
    p!.cancelled = true;
    this.promotions.put(id, p!);
    this.slots.put(Util.u32be(p!.slot), p!);
    System.event("osp.token.promotion_changed", Protobuf.encode(new token.promotion_changed_event(p, Util.now()), token.promotion_changed_event.encode), [actor]);
  }
  view(): token.get_economy_result {
    const e = this.config.get(), block = height();
    return new token.get_economy_result(e, block, e == null ? 0 : this.current(e, block));
  }
  postView(args: token.get_post_economy_arguments): token.get_post_economy_result {
    const id = this.id(args.post_id), reward = this.posts.get(id);
    const vote: token.ballot | null = Util.isEmpty(args.viewer) ? null : this.ballots.get(Util.concat([Util.requireAddress(args.viewer, "viewer"), id]));
    return new token.get_post_economy_result(reward, vote, reward == null ? null : this.epochs.get(Util.u64be(reward.epoch)), this.promotions.get(id), height());
  }
  board(): token.get_promotions_result {
    const e = this.config.get(), out = new Array<token.promotion>();
    if (e != null) for (let i: u32 = 0; i < e.promotion_slots; i++) {
      const p = this.slots.get(Util.u32be(i));
      if (p != null) out.push(p);
    }
    return new token.get_promotions_result(out, height());
  }
}
