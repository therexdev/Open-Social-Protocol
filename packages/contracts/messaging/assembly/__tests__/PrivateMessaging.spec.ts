import { Util } from "../common/util";
import { Arrays, System, Crypto, Base58, MockVM, Protobuf, chain, system_calls } from "@koinos/sdk-as";
import { Messaging } from "../Messaging";
import { messaging } from "../proto/messaging";
import { identity } from "../proto/identity";
import { Testing } from "../common/testing";
const ID=Base58.decode("122H3z8pc9z9xWpdirvsx1YsbTRwQHEEXu"), ALICE=Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe"), BOB=Base58.decode("1BrPkP7JhBwT4MuRDMWiiysGEu4XkyXuCH"), PAYER=Base58.decode("1NvZvWNqDX7t93inmLBvbv6kxhpEZYRFWK");
let c!:Messaging;
function bytes(n:u8=1,length:i32=32):Uint8Array{const b=new Uint8Array(length);b.fill(n);return b;}
function response(b:Uint8Array):system_calls.exit_arguments{return new system_calls.exit_arguments(0,new chain.result(b));}
function rootAuth():void{Testing.authorize([ALICE]);MockVM.setCallContractResults([response(Protobuf.encode(new identity.resolve_actor_result(true,ALICE,""),identity.resolve_actor_result.encode)),response(new Uint8Array(0))]);}
function setup():void{Testing.setup(ID);c=new Messaging();Testing.authorize([ID]);c.set_dependencies(new messaging.set_dependencies_arguments(PAYER,PAYER,PAYER));MockVM.commitTransaction();}
function reserve():void{rootAuth();c.reserve_private_usage(new messaging.reserve_private_usage_arguments(ALICE,PAYER,bytes(),12));MockVM.commitTransaction();}
function allocate(actor:Uint8Array,grant:u8=2,units:u32=4):void{Testing.authorize([PAYER]);c.allocate_private_usage(new messaging.allocate_private_usage_arguments(PAYER,actor,bytes(grant),units));MockVM.commitTransaction();}
function fund():void{reserve();allocate(ALICE);allocate(BOB,3);}
function openBoth():void{Testing.authorize([ALICE]);c.open_private_channel(new messaging.open_private_channel_arguments(ALICE,BOB));MockVM.commitTransaction();Testing.authorize([BOB]);c.open_private_channel(new messaging.open_private_channel_arguments(BOB,ALICE));MockVM.commitTransaction();}
describe("private usage conservation",()=>{
  beforeEach(setup);
  it("gives new wallets no allowance",()=>{expect(c.get_private_units(new messaging.get_private_units_arguments(ALICE)).units).toBe(0);Testing.authorize([ALICE]);expect(()=>{c.post_private_packet(new messaging.post_private_packet_arguments(ALICE,null,bytes(9),bytes(2,4168)));}).toThrow();});
  it("reserves once and allocates once despite retries",()=>{reserve();reserve();expect(c.get_private_units(new messaging.get_private_units_arguments(PAYER,true)).units).toBe(12);allocate(ALICE);allocate(ALICE);expect(c.get_private_units(new messaging.get_private_units_arguments(PAYER,true)).units).toBe(8);expect(c.get_private_units(new messaging.get_private_units_arguments(ALICE)).units).toBe(4);});
  it("rejects stealing, over-allocation, and rebinding a grant",()=>{reserve();Testing.authorize([ALICE]);expect(()=>{c.allocate_private_usage(new messaging.allocate_private_usage_arguments(PAYER,ALICE,bytes(3),4));}).toThrow();Testing.authorize([PAYER]);expect(()=>{c.allocate_private_usage(new messaging.allocate_private_usage_arguments(PAYER,ALICE,bytes(3),13));}).toThrow();allocate(ALICE);Testing.authorize([PAYER]);expect(()=>{c.allocate_private_usage(new messaging.allocate_private_usage_arguments(PAYER,BOB,bytes(2),4));}).toThrow();});
});
describe("private consent and packet integrity",()=>{
  beforeEach(()=>{setup();fund();});
  it("stores opaque invitations without a recipient and deduplicates them",()=>{Testing.authorize([ALICE]);const a=c.post_private_packet(new messaging.post_private_packet_arguments(ALICE,null,bytes(4),bytes(4,4168))).value!;MockVM.commitTransaction();const b=c.post_private_packet(new messaging.post_private_packet_arguments(ALICE,null,bytes(4),bytes(4,4168))).value!;expect(a.sequence).toBe(b.sequence);expect(c.get_private_units(new messaging.get_private_units_arguments(ALICE)).units).toBe(3);});
  it("does not let one wallet approve both sides",()=>{Testing.authorize([ALICE]);c.open_private_channel(new messaging.open_private_channel_arguments(ALICE,BOB));MockVM.commitTransaction();c.open_private_channel(new messaging.open_private_channel_arguments(ALICE,BOB));MockVM.commitTransaction();expect(()=>{c.post_private_packet(new messaging.post_private_packet_arguments(ALICE,BOB,bytes(6),bytes(7,100)));}).toThrow();expect(c.get_private_units(new messaging.get_private_units_arguments(ALICE)).units).toBe(3);});
  it("requires alias authorization and rejects changed ciphertext on retry",()=>{openBoth();Testing.authorize([BOB]);expect(()=>{c.post_private_packet(new messaging.post_private_packet_arguments(ALICE,BOB,bytes(6),bytes(7,100)));}).toThrow();Testing.authorize([ALICE]);c.post_private_packet(new messaging.post_private_packet_arguments(ALICE,BOB,bytes(6),bytes(7,100)));MockVM.commitTransaction();expect(()=>{c.post_private_packet(new messaging.post_private_packet_arguments(ALICE,BOB,bytes(6),bytes(8,100)));}).toThrow();});
  it("closing stops packets and stale approval cannot reopen it",()=>{openBoth();Testing.authorize([BOB]);c.close_private_channel(new messaging.close_private_channel_arguments(BOB,ALICE));MockVM.commitTransaction();Testing.authorize([ALICE]);expect(()=>{c.post_private_packet(new messaging.post_private_packet_arguments(ALICE,BOB,bytes(6),bytes(7,100)));}).toThrow();expect(()=>{c.open_private_channel(new messaging.open_private_channel_arguments(ALICE,BOB));}).toThrow();});
});

let hosted: Uint8Array = new Uint8Array(0);
function reference(body: Uint8Array): Uint8Array {
  const result = new Uint8Array(44);
  result.set(Util.str("OSPREF1"));
  result.set(Util.u32be(<u32>body.length), 8);
  result.set(System.hash(Crypto.multicodec.sha2_256, body)!.slice(2), 12);
  return result;
}
describe("hosted private packet bodies", () => {
  beforeEach(() => { setup(); fund(); });
  it("retains the original ciphertext commitment and fixed invitation size", () => {
    const body = bytes(7, 4168);
    hosted = reference(body);
    Testing.authorize([ALICE]);
    const first = c.post_private_packet(new messaging.post_private_packet_arguments(ALICE, null, bytes(8), hosted)).value!;
    expect(Arrays.equal(first.content_hash!, System.hash(Crypto.multicodec.sha2_256, body)!.slice(2))).toBe(true);
    expect(hosted.length).toBe(44);
    MockVM.commitTransaction();
    const again = c.post_private_packet(new messaging.post_private_packet_arguments(ALICE, null, bytes(8), hosted)).value!;
    expect(again.sequence).toBe(first.sequence);
    expect(c.get_private_units(new messaging.get_private_units_arguments(ALICE)).units).toBe(3);
  });
  it("rejects references claiming an unpadded invitation or oversized packet", () => {
    Testing.authorize([ALICE]);
    hosted = reference(bytes(7, 4167));
    expect(() => { c.post_private_packet(new messaging.post_private_packet_arguments(ALICE, null, bytes(8), hosted)); }).toThrow();
  });
  it("retains channel consent for hosted conversation messages", () => {
    Testing.authorize([ALICE]);
    hosted = reference(bytes(7, 100));
    expect(() => { c.post_private_packet(new messaging.post_private_packet_arguments(ALICE, BOB, bytes(8), hosted)); }).toThrow();
  });
});
