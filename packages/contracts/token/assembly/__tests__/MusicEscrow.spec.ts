import { Base58, MockVM, chain } from "@koinos/sdk-as";
import { Token } from "../Token";
import { token } from "../proto/token";
import { Testing } from "../common/testing";
const ID = Base58.decode("122H3z8pc9z9xWpdirvsx1YsbTRwQHEEXu"),
  BUYER = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe"),
  SELLER = Base58.decode("1BrPkP7JhBwT4MuRDMWiiysGEu4XkyXuCH"),
  PUB = Base58.decode("1NvZvWNqDX7t93inmLBvbv6kxhpEZYRFWK"),
  PAYMENT = new Uint8Array(32).fill(18);
let c!: Token;
beforeEach((): void => {
  Testing.setup(ID);
  c = new Token();
  Testing.authorize([ID]);
  c.init(new token.init_arguments(PUB, PUB, PUB, PUB));
  c.accounts.put(BUYER, new token.account_state(20, 100000, 20000, Testing.DEFAULT_TIME));
  const config = c.cfg();
  config.supply = 20;
  c.config.put(config);
  MockVM.commitTransaction();
});
function asPublications(): void {
  MockVM.setCaller(new chain.caller_data(PUB, chain.privilege.user_mode));
}
function reserve(): void {
  c.reserve_music_payment(new token.reserve_music_payment_arguments(PAYMENT, BUYER, SELLER, 7));
}
it("only publications can reserve or settle a bounded OSAT payment", (): void => {
  expect(reserve).toThrow();
  asPublications();
  reserve();
  MockVM.commitTransaction();
  expect(c.load(BUYER).balance).toBe(13);
  expect(c.load(BUYER).transferable).toBe(13);
  expect(c.load(SELLER).balance).toBe(0);
  MockVM.setCaller(new chain.caller_data(BUYER, chain.privilege.user_mode));
  expect((): void => {
    c.settle_music_payment(new token.settle_music_payment_arguments(PAYMENT, false));
  }).toThrow();
});
it("settles once to the seller without creating tokens or refilling spent capacity", (): void => {
  asPublications();
  reserve();
  MockVM.commitTransaction();
  c.settle_music_payment(new token.settle_music_payment_arguments(PAYMENT, false));
  MockVM.commitTransaction();
  expect(c.load(SELLER).balance).toBe(7);
  expect(c.load(SELLER).transferable).toBe(7);
  expect(c.cfg().supply).toBe(20);
  expect(reserve).toThrow();
  expect((): void => {
    c.settle_music_payment(new token.settle_music_payment_arguments(PAYMENT, true));
  }).toThrow();
});
it("refunds the buyer exactly once", (): void => {
  asPublications();
  reserve();
  MockVM.commitTransaction();
  c.settle_music_payment(new token.settle_music_payment_arguments(PAYMENT, true));
  MockVM.commitTransaction();
  expect(c.load(BUYER).balance).toBe(20);
  expect(c.load(BUYER).transferable).toBe(20);
  expect(c.load(SELLER).balance).toBe(0);
  expect((): void => {
    c.settle_music_payment(new token.settle_music_payment_arguments(PAYMENT, false));
  }).toThrow();
});
it("cannot buy with free credits, locked tokens, zero amounts or an oversized debit", (): void => {
  asPublications();
  c.accounts.put(BUYER, new token.account_state(20, 100000, 0, Testing.DEFAULT_TIME));
  MockVM.commitTransaction();
  expect(reserve).toThrow();
  expect((): void => {
    c.reserve_music_payment(new token.reserve_music_payment_arguments(PAYMENT, BUYER, SELLER, 0));
  }).toThrow();
  expect((): void => {
    c.reserve_music_payment(new token.reserve_music_payment_arguments(PAYMENT, BUYER, SELLER, 21));
  }).toThrow();
});
