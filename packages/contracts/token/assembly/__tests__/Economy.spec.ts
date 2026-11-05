import { Arrays, Base58, Base64, MockVM, Protobuf, chain, protocol, system_calls } from "@koinos/sdk-as";
import { Token } from "../Token";
import { Economy, HARBINGER } from "../Economy";
import { token } from "../proto/token";
import { identity } from "../proto/identity";
import { publications } from "../proto/publications";
import { relationships } from "../proto/relationships";
import { Testing } from "../common/testing";
import { Util } from "../common/util";
const ID = Base58.decode("122H3z8pc9z9xWpdirvsx1YsbTRwQHEEXu"),
  A = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe"),
  B = Base58.decode("1BrPkP7JhBwT4MuRDMWiiysGEu4XkyXuCH"),
  C = Base58.decode("1NvZvWNqDX7t93inmLBvbv6kxhpEZYRFWK");
let c!: Token;
let e!: Economy;
function bytes(n: u8): Uint8Array { const b = new Uint8Array(32); b.fill(n); return b; }
function setPayer(payer: Uint8Array, payee: Uint8Array = new Uint8Array(0)): void {
  const header = new protocol.transaction_header();
  header.payer = payer;
  header.payee = payee;
  MockVM.setTransaction(new protocol.transaction(new Uint8Array(0), header));
}
function setup(): void {
  Testing.setup(ID);
  setPayer(ID);
  MockVM.setChainId(Base64.decode(HARBINGER));
  Testing.authorize([ID]);
  c = new Token();
  c.init(new token.init_arguments(C, C, C, C));
  c.activate_economy(new token.activate_economy_arguments());
  e = new Economy(c);
  c.accounts.put(A, new token.account_state(100, 100000, 100000, Testing.DEFAULT_TIME));
  c.accounts.put(B, new token.account_state(100, 100000, 100000, Testing.DEFAULT_TIME));
  c.accounts.put(C, new token.account_state(100, 100000, 100000, Testing.DEFAULT_TIME));
  const cfg = c.cfg(); cfg.supply = 300; c.config.put(cfg);
  MockVM.commitTransaction();
}
function response(b: Uint8Array): system_calls.exit_arguments { return new system_calls.exit_arguments(0, new chain.result(b)); }
function mocks(actor: Uint8Array, author: Uint8Array, version: u8 = 1, audience: i32 = 0, state: i32 = 0, blocked: bool = false): void {
  const p = new publications.post_record(); p.author = author; p.latest_version = bytes(version); p.audience = audience; p.state = state;
  Testing.authorize([actor]);
  MockVM.setCallContractResults([
    response(Protobuf.encode(new identity.resolve_actor_result(true, actor), identity.resolve_actor_result.encode)),
    response(Protobuf.encode(new publications.get_post_result(p), publications.get_post_result.encode)),
    response(Protobuf.encode(new relationships.is_blocked_result(blocked), relationships.is_blocked_result.encode)),
    response(Protobuf.encode(new relationships.is_blocked_result(false), relationships.is_blocked_result.encode)),
  ]);
}
function vote(id: u8, actor: Uint8Array = A, author: Uint8Array = B, weight: u64 = 1, direction: u32 = 1): void {
  mocks(actor, author);
  c.vote(new token.vote_arguments(actor, bytes(id), bytes(1), direction, weight));
}
function at(block: u64): void { Testing.setTime(Testing.DEFAULT_TIME + (block - 1) * 3000, block); }
function settle(id: u8, author: Uint8Array = B, version: u8 = 1, audience: i32 = 0, state: i32 = 0): u64 {
  mocks(C, author, version, audience, state);
  return c.settle_reward(new token.settle_reward_arguments(C, bytes(id))).reward;
}
function promotionArgs(nonce: u64 = 1, slot: u32 = 0, amount: u64 = 2): token.promote_arguments {
  return new token.promote_arguments(A, bytes(1), bytes(1), nonce, slot, 2, amount);
}

describe("paid voting and reward accounting", (): void => {
  beforeEach(setup);
  it("consumes equal paid weight in either direction, preserving free capacity and rolling locks", (): void => {
    vote(1, A, B, 10, 1);
    MockVM.commitTransaction();
    vote(2, A, B, 5, 2);
    expect(c.load(A).free_ticks).toBe(100 * 144000);
    expect(c.load(A).token_ticks).toBe(85 * 144000);
    expect(c.load(A).locked).toBe(15);
    const p = e.posts.get(bytes(2))!;
    expect(p.up).toBe(0); expect(p.down).toBe(5); expect(p.score).toBe(0);
    expect(e.epochs.get(Util.u64be(1))!.total_weight).toBe(15);
    at(28801);
    expect(c.load(A).token_ticks).toBe(88 * 144000);
    expect(c.load(A).transferable).toBe(85);
  });
  it("weights paid song votes like posts and settles independently of a colliding raw post id", (): void => {
    const target = new Uint8Array(33);
    target[0] = 1; target.set(bytes(6), 1);
    vote(6, A, C, 3);
    MockVM.commitTransaction();
    mocks(A, B);
    c.vote(new token.vote_arguments(A, target, bytes(1), 1, 3));
    MockVM.commitTransaction();
    expect(e.posts.get(target)!.score).toBe(e.posts.get(bytes(6))!.score);
    expect(c.get_post_economy(new token.get_post_economy_arguments(target, A)).vote!.weight).toBe(3);
    at(144001);
    mocks(C, B);
    expect(c.settle_reward(new token.settle_reward_arguments(C, target)).reward).toBe(50);
    expect(c.load(B).balance).toBe(150);
    expect(e.posts.get(bytes(6))!.settled).toBe(false);
  });
  it("separates a song comment reward from another song with the same comment id and settles a deletion at zero", (): void => {
    const target = new Uint8Array(65); target[0] = 2; target.set(bytes(7), 1); target.set(bytes(8), 33);
    mocks(A, B); c.vote(new token.vote_arguments(A, target, bytes(1), 1, 3));
    MockVM.commitTransaction();
    expect(c.get_post_economy(new token.get_post_economy_arguments(target, A)).vote!.weight).toBe(3);
    const other = target.slice(0); other[1] = 3;
    expect(c.get_post_economy(new token.get_post_economy_arguments(other, A)).reward == null).toBe(true);
    at(144001); mocks(C, B, 1, 0, 2);
    expect(c.settle_reward(new token.settle_reward_arguments(C, target)).reward).toBe(0);
    const reward = c.get_post_economy(new token.get_post_economy_arguments(target)).reward!;
    expect(reward.settled).toBe(true); expect(Arrays.equal(reward.post_id!, target)).toBe(true);
  });
  it("rejects free voting, replay, wrong versions, self-votes and blocked votes", (): void => {
    c.accounts.put(A, new token.account_state(0, 100000, 0, Testing.DEFAULT_TIME));
    MockVM.commitTransaction();
    expect((): void => { vote(1); }).toThrow();
    expect(c.load(A).free_credits).toBe(100000);
    vote(1, B, C);
    MockVM.commitTransaction();
    expect((): void => { vote(1, B, C, 1, 2); }).toThrow();
    expect((): void => { vote(2, B, B); }).toThrow();
    mocks(B, C, 2);
    expect((): void => { c.vote(new token.vote_arguments(B, bytes(2), bytes(1), 1, 1)); }).toThrow();
    mocks(B, C, 1, 0, 0, true);
    expect((): void => { c.vote(new token.vote_arguments(B, bytes(2), bytes(1), 1, 1)); }).toThrow();
    expect(e.epochs.get(Util.u64be(1))!.total_weight).toBe(1);
  });
  it("rejects private/deleted content, zero weight and invalid direction", (): void => {
    mocks(A, B, 1, 1);
    expect((): void => { c.vote(new token.vote_arguments(A, bytes(1), bytes(1), 1, 1)); }).toThrow();
    mocks(A, B, 1, 0, 2);
    expect((): void => { c.vote(new token.vote_arguments(A, bytes(1), bytes(1), 1, 1)); }).toThrow();
    expect((): void => { vote(1, A, B, 0); }).toThrow();
    expect((): void => { vote(1, A, B, 1, 0); }).toThrow();
    expect((): void => { vote(1, A, B, 1001); }).toThrow();
  });
  it("settles proportionally without overspending or refunding a late vote", (): void => {
    vote(1, A, B, 3);
    MockVM.commitTransaction();
    at(144000);
    vote(2, B, A, 1);
    MockVM.commitTransaction();
    // score(3)=2250, score(1)=500: floor(100*2250/2750)=81 and 18.
    expect(e.cfg().reserved).toBe(100);
    expect((): void => { settle(1); }).toThrow();
    at(144001);
    expect(settle(1)).toBe(81);
    MockVM.commitTransaction();
    expect(c.load(B).locked).toBe(1);
    expect(c.load(B).token_ticks).toBe(180 * 144000 + 1);
    expect(settle(2, A)).toBe(18);
    MockVM.commitTransaction();
    expect(e.cfg().reserved).toBe(0);
    expect(c.cfg().supply).toBe(399);
    expect((): void => { settle(1); }).toThrow();
    expect((): void => { vote(1, C, B); }).toThrow();
    expect(c.cfg().supply).toBe(399);
  });
  it("lets an unregistered, self-paying signer settle an old reward to its offline author once", (): void => {
    vote(1);
    MockVM.commitTransaction();
    setPayer(C);
    Testing.authorize([C]);
    const p = new publications.post_record(); p.author = B; p.latest_version = bytes(1);
    // Only the publication lookup is available. The worker has no registered identity.
    MockVM.setCallContractResults([response(Protobuf.encode(new publications.get_post_result(p), publications.get_post_result.encode))]);
    expect((): void => { c.settle_reward(new token.settle_reward_arguments(C, bytes(1))); }).toThrow();
    at(432001);
    expect(c.get_economy(new token.get_economy_arguments()).self_paid_settlement).toBe(true);
    setPayer(C);
    Testing.authorize([C]);
    MockVM.setCallContractResults([response(Protobuf.encode(new publications.get_post_result(p), publications.get_post_result.encode))]);
    expect(c.settle_reward(new token.settle_reward_arguments(C, bytes(1))).reward).toBe(100);
    MockVM.commitTransaction();
    expect(c.load(B).balance).toBe(200);
    expect(c.load(C).balance).toBe(100);
    expect((): void => { c.settle_reward(new token.settle_reward_arguments(C, bytes(1))); }).toThrow();
    expect(c.cfg().supply).toBe(400);
  });
  it("requires the payer's authority and rejects identity bypass in sponsored and delegated calls", (): void => {
    vote(1);
    MockVM.commitTransaction();
    at(144001);
    setPayer(C); Testing.authorize([B]);
    Testing.mockResolveActor(false, null, "unregistered");
    expect((): void => { c.settle_reward(new token.settle_reward_arguments(C, bytes(1))); }).toThrow();
    setPayer(B); Testing.authorize([C]);
    Testing.mockResolveActor(false, null, "unregistered");
    expect((): void => { c.settle_reward(new token.settle_reward_arguments(C, bytes(1))); }).toThrow();
    setPayer(C, B); Testing.authorize([C]);
    Testing.mockResolveActor(false, null, "unregistered");
    expect((): void => { c.settle_reward(new token.settle_reward_arguments(C, bytes(1))); }).toThrow();
    setPayer(C); Testing.authorize([C]);
    Testing.mockResolveActor(false, null, "unknown device");
    expect((): void => { c.settle_reward(new token.settle_reward_arguments(C, bytes(1), A)); }).toThrow();
    expect(e.posts.get(bytes(1))!.settled).toBe(false);
    expect(c.cfg().supply).toBe(300);
  });
  it("still accepts the registered identity's authorized device when a third party pays the Mana", (): void => {
    vote(1);
    MockVM.commitTransaction();
    at(144001);
    const post = new publications.post_record(); post.author = B; post.latest_version = bytes(1);
    setPayer(ID, A);
    Testing.authorize([A]);
    MockVM.setCallContractResults([
      response(Protobuf.encode(new identity.resolve_actor_result(true, A), identity.resolve_actor_result.encode)),
      response(Protobuf.encode(new publications.get_post_result(post), publications.get_post_result.encode)),
    ]);
    expect(c.settle_reward(new token.settle_reward_arguments(C, bytes(1), A)).reward).toBe(100);
    expect(c.load(B).balance).toBe(200);
    expect(c.load(C).balance).toBe(100);
  });
  it("a downvote removes only pending issuance; zero-score budgets are not minted", (): void => {
    vote(1, A, B, 2);
    MockVM.commitTransaction();
    vote(1, C, B, 3, 2);
    MockVM.commitTransaction();
    expect(e.epochs.get(Util.u64be(1))!.total_score).toBe(0);
    expect(c.load(B).balance).toBe(100);
    at(144001);
    expect(settle(1)).toBe(0);
    expect(e.cfg().reserved).toBe(0);
    expect(c.cfg().supply).toBe(300);
  });
  it("changed or removed versions cannot claim or reopen old rewards", (): void => {
    vote(1);
    MockVM.commitTransaction();
    vote(2);
    MockVM.commitTransaction();
    at(144001);
    expect(settle(1, B, 2)).toBe(0);
    MockVM.commitTransaction();
    expect(settle(2, B, 1, 0, 2)).toBe(0);
    MockVM.commitTransaction();
    expect(e.cfg().reserved).toBe(0);
    expect(c.cfg().supply).toBe(300);
    expect((): void => { vote(1, C, B); }).toThrow();
  });
  it("reserves issuance across periods and bootstrap so the supply cap cannot be overcommitted", (): void => {
    const cfg = c.cfg(); cfg.supply = 999950; c.config.put(cfg);
    vote(1);
    MockVM.commitTransaction();
    expect(e.cfg().reserved).toBe(50);
    at(144001);
    vote(2);
    MockVM.commitTransaction();
    expect(e.epochs.get(Util.u64be(2))!.budget).toBe(0);
    expect(settle(1)).toBe(50);
    expect(c.cfg().supply).toBe(1000000);
    expect(e.cfg().reserved).toBe(0);
  });
  it("retires both old Support minting and its policy setter at activation", (): void => {
    mocks(A, B);
    expect((): void => { c.support(new token.support_arguments(A, bytes(1))); }).toThrow();
    Testing.authorize([ID]);
    expect((): void => { c.set_reward_policy(new token.set_reward_policy_arguments(1, 100, 10)); }).toThrow();
  });
  it("requires valid device/owner authority", (): void => {
    mocks(A, B); Testing.authorize([]);
    expect((): void => { c.vote(new token.vote_arguments(A, bytes(1), bytes(1), 1, 1, C)); }).toThrow();
    expect(c.load(A).token_ticks).toBe(100 * 144000);
  });
});

describe("promotion purchase and testnet boundaries", (): void => {
  beforeEach(setup);
  it("burns only the approved ready amount, without charging activity or creating rewards", (): void => {
    mocks(A, A);
    c.promote(promotionArgs());
    MockVM.commitTransaction();
    expect(c.load(A).balance).toBe(98);
    expect(c.load(A).free_credits).toBe(100000);
    expect(c.cfg().supply).toBe(298);
    expect(e.posts.get(bytes(1)) == null).toBe(true);
    const p = e.promotions.get(bytes(1))!;
    expect(p.start_block).toBe(1); expect(p.end_block).toBe(2401); expect(p.burned).toBe(2);
    expect(Arrays.equal(p.version!, bytes(1))).toBe(true);
    mocks(A, A);
    expect((): void => { c.promote(promotionArgs()); }).toThrow();
    expect(c.cfg().supply).toBe(298);
  });
  it("rejects used tokens, unapproved burns, private posts and non-authors atomically", (): void => {
    vote(2, A, B, 100);
    MockVM.commitTransaction();
    mocks(A, A);
    expect((): void => { c.promote(promotionArgs()); }).toThrow();
    at(144001);
    mocks(A, A);
    expect((): void => { c.promote(promotionArgs(1, 0, 3)); }).toThrow();
    mocks(A, A, 1, 1);
    expect((): void => { c.promote(promotionArgs()); }).toThrow();
    mocks(A, B);
    expect((): void => { c.promote(promotionArgs()); }).toThrow();
    expect(c.cfg().supply).toBe(300);
    expect(c.load(A).balance).toBe(100);
  });
  it("enforces slot contention, nonces, expiry and cancellation without refunds", (): void => {
    mocks(A, A); c.promote(promotionArgs());
    MockVM.commitTransaction();
    mocks(B, B);
    expect((): void => { c.promote(new token.promote_arguments(B, bytes(2), bytes(1), 1, 0, 1, 1)); }).toThrow();
    mocks(A, A);
    c.cancel_promotion(new token.cancel_promotion_arguments(A, bytes(1), 1));
    MockVM.commitTransaction();
    expect(e.promotions.get(bytes(1))!.cancelled).toBe(true);
    expect(c.load(A).balance).toBe(98);
    mocks(A, A);
    expect((): void => { c.promote(promotionArgs()); }).toThrow();
    mocks(A, A); c.promote(promotionArgs(2));
    MockVM.commitTransaction();
    at(2401);
    mocks(A, A); c.promote(promotionArgs(3));
    expect(e.board().values.length).toBe(1);
    expect(c.load(A).balance).toBe(94);
  });
  it("limits disclosed grants per tester, globally, by authority, and by chain", (): void => {
    Testing.authorize([A]);
    expect((): void => { c.grant_test_tokens(new token.grant_test_tokens_arguments(A, 1)); }).toThrow();
    Testing.authorize([ID]); Testing.mockResolveActor(true, A, "");
    c.grant_test_tokens(new token.grant_test_tokens_arguments(A, 100));
    MockVM.commitTransaction();
    expect(c.load(A).balance).toBe(200);
    expect(e.cfg().bootstrap_minted).toBe(100);
    Testing.authorize([ID]); Testing.mockResolveActor(true, A, "");
    expect((): void => { c.grant_test_tokens(new token.grant_test_tokens_arguments(A, 1)); }).toThrow();
    Testing.authorize([ID]); MockVM.setChainId(bytes(99));
    expect((): void => { c.grant_test_tokens(new token.grant_test_tokens_arguments(B, 1)); }).toThrow();
    MockVM.setChainId(Base64.decode(HARBINGER));
    const cfg = e.cfg(); cfg.bootstrap_minted = 10000; e.config.put(cfg); MockVM.commitTransaction();
    Testing.authorize([ID]); Testing.mockResolveActor(true, B, "");
    expect((): void => { c.grant_test_tokens(new token.grant_test_tokens_arguments(B, 1)); }).toThrow();
  });
  it("cannot activate twice or outside Harbinger", (): void => {
    Testing.authorize([ID]);
    expect((): void => { c.activate_economy(new token.activate_economy_arguments()); }).toThrow();
    setup(); MockVM.setChainId(bytes(99)); Testing.authorize([ID]);
    expect((): void => { e.testnet(); }).toThrow();
  });
});
