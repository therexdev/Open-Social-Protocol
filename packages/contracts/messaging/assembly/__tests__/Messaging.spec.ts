import { Base58, MockVM, Protobuf, chain, system_calls, Arrays } from "@koinos/sdk-as";
import { Messaging } from "../Messaging";
import { messaging } from "../proto/messaging";
import { identity } from "../proto/identity";
import { relationships } from "../proto/relationships";
import { Testing } from "../common/testing";
const ID = Base58.decode("122H3z8pc9z9xWpdirvsx1YsbTRwQHEEXu"),
  ALICE = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe"),
  BOB = Base58.decode("1BrPkP7JhBwT4MuRDMWiiysGEu4XkyXuCH"),
  DEP = Base58.decode("1NvZvWNqDX7t93inmLBvbv6kxhpEZYRFWK");
let c!: Messaging;
function response(b: Uint8Array): system_calls.exit_arguments {
  return new system_calls.exit_arguments(0, new chain.result(b));
}
function auth(a: Uint8Array, blocked: bool = false, request: bool = false): void {
  Testing.authorize([a]);
  const results = [
    response(Protobuf.encode(new identity.resolve_actor_result(true, a, ""), identity.resolve_actor_result.encode)),
    response(Protobuf.encode(new relationships.is_blocked_result(blocked), relationships.is_blocked_result.encode)),
    response(Protobuf.encode(new relationships.is_blocked_result(false), relationships.is_blocked_result.encode)),
  ];
  if (request)
    results.push(response(Protobuf.encode(new identity.resolve_actor_result(true, BOB, ""), identity.resolve_actor_result.encode)));
  results.push(response(new Uint8Array(0)));
  MockVM.setCallContractResults(results);
}
function setup(): void {
  Testing.setup(ID);
  c = new Messaging();
  Testing.authorize([ID]);
  c.set_dependencies(new messaging.set_dependencies_arguments(DEP, DEP, DEP));
  MockVM.commitTransaction();
}
function requested(): void {
  auth(ALICE, false, true);
  c.request_conversation(new messaging.request_conversation_arguments(ALICE, BOB, null, 0));
  MockVM.commitTransaction();
}
function accepted(): void {
  requested();
  auth(BOB);
  c.accept_conversation(new messaging.accept_conversation_arguments(BOB, ALICE, null, 1));
  MockVM.commitTransaction();
}
function send(fill: u8 = 1): messaging.message_record {
  auth(ALICE);
  const id = new Uint8Array(32);
  id.fill(7);
  const data = new Uint8Array(50);
  data.fill(fill);
  return c.send_message(new messaging.send_message_arguments(ALICE, BOB, null, id, 1, data)).value!;
}
describe("consent and replay protection", (): void => {
  beforeEach(setup);
  it("requires recipient acceptance before delivering ciphertext", (): void => {
    requested();
    expect((): void => {
      send();
    }).toThrow();
  });
  it("does not allow the requester to accept their own request", (): void => {
    requested();
    auth(ALICE);
    expect((): void => {
      c.accept_conversation(new messaging.accept_conversation_arguments(ALICE, BOB, null, 1));
    }).toThrow();
  });
  it("rejects stale acceptance", (): void => {
    requested();
    auth(BOB);
    expect((): void => {
      c.accept_conversation(new messaging.accept_conversation_arguments(BOB, ALICE, null, 2));
    }).toThrow();
  });
  it("stores a commitment and deduplicates exact message retries", (): void => {
    accepted();
    const first = send();
    MockVM.commitTransaction();
    const again = send();
    expect(first.sequence).toBe(1);
    expect(again.sequence).toBe(1);
    expect(Arrays.equal(first.content_hash!, again.content_hash!)).toBe(true);
  });
  it("rejects reuse of an id for different ciphertext", (): void => {
    accepted();
    send();
    MockVM.commitTransaction();
    expect((): void => {
      send(2);
    }).toThrow();
  });
  it("checks blocks for new messages", (): void => {
    accepted();
    auth(ALICE, true);
    expect((): void => {
      c.send_message(new messaging.send_message_arguments(ALICE, BOB, null, new Uint8Array(32), 1, new Uint8Array(20)));
    }).toThrow();
  });
  it("a closed conversation requires fresh consent", (): void => {
    accepted();
    auth(BOB);
    c.close_conversation(new messaging.close_conversation_arguments(BOB, ALICE, null, 1));
    MockVM.commitTransaction();
    expect((): void => {
      send();
    }).toThrow();
  });
});
