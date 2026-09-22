import { Base58, MockVM, Protobuf, chain, system_calls } from "@koinos/sdk-as";
import { Token } from "../Token";
import { token } from "../proto/token";
import { identity } from "../proto/identity";
import { publications } from "../proto/publications";
import { relationships } from "../proto/relationships";
import { Testing } from "../common/testing";
const ID = Base58.decode("122H3z8pc9z9xWpdirvsx1YsbTRwQHEEXu"),
  ALICE = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe"),
  BOB = Base58.decode("1BrPkP7JhBwT4MuRDMWiiysGEu4XkyXuCH"),
  DEP = Base58.decode("1NvZvWNqDX7t93inmLBvbv6kxhpEZYRFWK");
let c!: Token;
function setup(): void {
  Testing.setup(ID);
  c = new Token();
  Testing.authorize([ID]);
  c.init(new token.init_arguments(DEP, DEP, DEP, DEP));
  MockVM.commitTransaction();
}
function asAlice(): void {
  Testing.authorize([ALICE]);
  Testing.mockResolveActor(true, ALICE, "", 2);
}
function response(bytes: Uint8Array): system_calls.exit_arguments {
  return new system_calls.exit_arguments(0, new chain.result(bytes));
}
function supportMocks(author: Uint8Array): void {
  const post = new publications.post_record();
  post.author = author;
  MockVM.setCallContractResults([
    response(Protobuf.encode(new identity.resolve_actor_result(true, ALICE, ""), identity.resolve_actor_result.encode)),
    response(Protobuf.encode(new publications.get_post_result(post), publications.get_post_result.encode)),
    response(Protobuf.encode(new relationships.is_blocked_result(false), relationships.is_blocked_result.encode)),
    response(Protobuf.encode(new relationships.is_blocked_result(false), relationships.is_blocked_result.encode)),
  ]);
  Testing.authorize([ALICE]);
}
function support(id: u8): u64 {
  const post = new Uint8Array(32);
  post.fill(id);
  supportMocks(BOB);
  return c.support(new token.support_arguments(ALICE, post, null)).reward;
}
describe("token capacity and authorization", (): void => {
  beforeEach(setup);
  it("grants a free allowance that regenerates with block time", (): void => {
    c.spend(ALICE, 100);
    expect(c.load(ALICE).free_credits).toBe(0);
    Testing.setTime(Testing.DEFAULT_TIME + 43200000);
    expect(c.load(ALICE).free_credits).toBe(50000);
    Testing.setTime(Testing.DEFAULT_TIME + 86400000);
    expect(c.load(ALICE).free_credits).toBe(100000);
  });
  it("rejects direct consumption by a wallet", (): void => {
    expect((): void => {
      c.consume(new token.consume_arguments(ALICE, 1));
    }).toThrow();
  });
  it("permits consumption by configured protocol contracts", (): void => {
    MockVM.setCaller(new chain.caller_data(DEP, chain.privilege.user_mode));
    c.consume(new token.consume_arguments(ALICE, 2));
    expect(c.load(ALICE).free_credits).toBe(98000);
  });
  it("cannot refill credits by moving used tokens back and forth", (): void => {
    c.accounts.put(ALICE, new token.account_state(10, 0, 2000, Testing.DEFAULT_TIME));
    asAlice();
    c.transfer(new token.transfer_arguments(ALICE, BOB, 5));
    expect(c.load(ALICE).token_credits).toBe(1000);
    expect(c.load(BOB).token_credits).toBe(1000);
    MockVM.commitTransaction();
    Testing.authorize([BOB]);
    Testing.mockResolveActor(true, BOB, "", 2);
    c.transfer(new token.transfer_arguments(BOB, ALICE, 5));
    expect(c.load(ALICE).token_credits).toBe(2000);
    expect(c.load(BOB).token_credits).toBe(0);
    expect(c.load(ALICE).free_credits).toBe(0);
  });
  it("rejects token transfer without owner authority", (): void => {
    c.accounts.put(ALICE, new token.account_state(10, 0, 10000, Testing.DEFAULT_TIME));
    MockVM.commitTransaction();
    Testing.authorize([]);
    Testing.mockResolveActor(true, ALICE, "");
    expect((): void => {
      c.transfer(new token.transfer_arguments(ALICE, BOB, 1));
    }).toThrow();
  });
  it("enforces recipient reward caps and one support per actor/post", (): void => {
    Testing.authorize([ID]);
    c.set_reward_policy(new token.set_reward_policy_arguments(1, 100, 2));
    MockVM.commitTransaction();
    expect(support(1)).toBe(1);
    MockVM.commitTransaction();
    expect(support(2)).toBe(1);
    MockVM.commitTransaction();
    expect(support(3)).toBe(0);
    MockVM.commitTransaction();
    expect(c.load(BOB).balance).toBe(2);
    expect((): void => {
      support(1);
    }).toThrow();
  });
  it("rejects self-support", (): void => {
    supportMocks(ALICE);
    expect((): void => {
      c.support(new token.support_arguments(ALICE, new Uint8Array(32), null));
    }).toThrow();
  });
  it("rejects reinitialization and excessive reward settings", (): void => {
    Testing.authorize([ID]);
    expect((): void => {
      c.init(new token.init_arguments(DEP, DEP, DEP, DEP));
    }).toThrow();
    Testing.authorize([ID]);
    expect((): void => {
      c.set_reward_policy(new token.set_reward_policy_arguments(11, 1, 1));
    }).toThrow();
  });
});
