import { Arrays, Base58, MockVM, Protobuf, System, chain, system_calls } from "@koinos/sdk-as";
import { MusicAccess } from "../MusicAccess";
import { PhotoLibrary } from "../PhotoLibrary";
import { publications } from "../proto/publications";
import { identity } from "../proto/identity";
import { relationships } from "../proto/relationships";
import { Testing } from "../common/testing";
import { Util } from "../common/util";
const CONTRACT = Base58.decode("122H3z8pc9z9xWpdirvsx1YsbTRwQHEEXu"),
  OWNER = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe"),
  BUYER = Base58.decode("1BrPkP7JhBwT4MuRDMWiiysGEu4XkyXuCH"),
  DEP = Base58.decode("1NvZvWNqDX7t93inmLBvbv6kxhpEZYRFWK"),
  ID = new Uint8Array(32).fill(5),
  CID = new Uint8Array(32).fill(6),
  GROUP = new Uint8Array(32).fill(7);
let c!: MusicAccess, bad!: publications.music_key, args!: publications.comment_music_arguments;
function ok(bytes: Uint8Array = new Uint8Array(0)): system_calls.exit_arguments {
  return new system_calls.exit_arguments(0, new chain.result(bytes));
}
function auth(account: Uint8Array): system_calls.exit_arguments {
  Testing.authorize([account]);
  return ok(
    Protobuf.encode(
      new identity.resolve_actor_result(true, account, ""),
      identity.resolve_actor_result.encode
    )
  );
}
function block(value: bool = false): system_calls.exit_arguments {
  return ok(
    Protobuf.encode(
      new relationships.is_blocked_result(value),
      relationships.is_blocked_result.encode
    )
  );
}
function recipient(): system_calls.exit_arguments {
  return ok(
    Protobuf.encode(
      new identity.get_identity_result(
        new identity.identity_record(BUYER, BUYER, new Uint8Array(32).fill(19), 1)
      ),
      identity.get_identity_result.encode
    )
  );
}
function sealed(): publications.music_key {
  return new publications.music_key(
    1,
    new Uint8Array(32).fill(2),
    new Uint8Array(24).fill(3),
    new Uint8Array(48).fill(4)
  );
}
function request(): void {
  c.request(new publications.request_music_access_arguments(BUYER, ID, 7), DEP, DEP, DEP);
}
function pending(): void {
  MockVM.setCallContractResults([auth(BUYER), block(), block(), recipient(), ok(), ok()]);
  request();
  MockVM.commitTransaction();
}
function grant(): void {
  c.grant(new publications.grant_music_access_arguments(OWNER, ID, BUYER, sealed()), DEP, DEP, DEP);
}
function refund(): void {
  c.refund(new publications.refund_music_access_arguments(BUYER, ID), DEP, DEP, DEP);
}
beforeEach((): void => {
  System.setSystemBufferSize(96 * 1024);
  Testing.setup(CONTRACT);
  c = new MusicAccess();
  const track = new publications.music_record(
    OWNER,
    new Uint8Array(32),
    20,
    [new Uint8Array(32)],
    1,
    "Song",
    "audio/mpeg",
    1000,
    100000000,
    DEP,
    OWNER
  );
  track.artist = "Artist";
  track.description = "Description";
  track.version = 2;
  track.encrypted = true;
  track.nonce = new Uint8Array(24);
  track.owner_key = sealed();
  track.key_hash = new Uint8Array(32);
  track.unlock_price = 7;
  c.library.tracks.put(ID, track);
  MockVM.commitTransaction();
});
it("reserves once and repeated requests keep the same pending payment", (): void => {
  pending();
  const key = Util.concat([ID, BUYER]),
    first = c.access.get(key)!;
  expect(first.status).toBe(1);
  expect(first.amount).toBe(7);
  expect(first.expires_at).toBe(Testing.DEFAULT_TIME + 86400000);
  MockVM.setCallContractResults([auth(BUYER), block(), block()]);
  request();
  expect(Arrays.equal(c.access.get(key)!.payment_id!, first.payment_id!)).toBe(true);
  expect(c.requests(new publications.list_music_requests_arguments(OWNER)).items.length).toBe(1);
});
it("delivers once, clears the pending directory, and never settles twice", (): void => {
  pending();
  MockVM.setCallContractResults([auth(OWNER), block(), block(), ok(), ok()]);
  grant();
  MockVM.commitTransaction();
  expect(c.access.get(Util.concat([ID, BUYER]))!.status).toBe(2);
  expect(c.requests(new publications.list_music_requests_arguments(OWNER)).items.length).toBe(0);
  MockVM.setCallContractResults([auth(OWNER), block(), block()]);
  grant();
  MockVM.setCallContractResults([auth(BUYER)]);
  expect(refund).toThrow();
});
it("rejects grant without payment, wrong owner, malformed keys and premature refunds", (): void => {
  MockVM.setCallContractResults([auth(OWNER), block(), block()]);
  expect(grant).toThrow();
  pending();
  MockVM.setCallContractResults([auth(BUYER)]);
  expect((): void => {
    c.grant(
      new publications.grant_music_access_arguments(BUYER, ID, OWNER, sealed()),
      DEP,
      DEP,
      DEP
    );
  }).toThrow();
  bad = sealed();
  bad.ciphertext = new Uint8Array(32);
  MockVM.setCallContractResults([auth(OWNER), block(), block()]);
  expect((): void => {
    c.grant(new publications.grant_music_access_arguments(OWNER, ID, BUYER, bad), DEP, DEP, DEP);
  }).toThrow();
  MockVM.setCallContractResults([auth(BUYER), block(), block()]);
  expect(refund).toThrow();
});
it("refunds after the deadline and rejects delivery at that exact deadline", (): void => {
  pending();
  Testing.setTime(Testing.DEFAULT_TIME + 86400000);
  MockVM.setCallContractResults([auth(OWNER), block(), block()]);
  expect(grant).toThrow();
  MockVM.setCallContractResults([auth(BUYER), ok()]);
  refund();
  MockVM.commitTransaction();
  expect(c.access.get(Util.concat([ID, BUYER]))!.status).toBe(3);
  MockVM.setCallContractResults([auth(BUYER)]);
  refund();
});
it("revoked or blocked audience members cannot receive keys and can refund early", (): void => {
  pending();
  MockVM.setCallContractResults([auth(OWNER), block(true)]);
  expect(grant).toThrow();
  MockVM.setCallContractResults([auth(BUYER), block(true), ok()]);
  refund();
  expect(c.access.get(Util.concat([ID, BUYER]))!.status).toBe(3);
});
it("friends eligibility comes from the current relationship, not a caller supplied list", (): void => {
  const v = c.library.get(ID)!;
  v.audience = 1;
  const relation = new relationships.relationship_record();
  relation.status = relationships.relationship_status.inactive;
  MockVM.setCallContractResults([
    block(),
    block(),
    ok(
      Protobuf.encode(
        new relationships.get_relationship_result(relation),
        relationships.get_relationship_result.encode
      )
    ),
  ]);
  expect(c.eligible(v, BUYER, DEP)).toBe(false);
  relation.status = relationships.relationship_status.active;
  MockVM.setCallContractResults([
    block(),
    block(),
    ok(
      Protobuf.encode(
        new relationships.get_relationship_result(relation),
        relationships.get_relationship_result.encode
      )
    ),
  ]);
  expect(c.eligible(v, BUYER, DEP)).toBe(true);
});
it("group eligibility follows current membership and closure", (): void => {
  const photos = new PhotoLibrary(),
    v = c.library.get(ID)!;
  v.audience = 2;
  v.group_id = GROUP;
  const group = new publications.collection_record(
    OWNER,
    2,
    1,
    publications.audience_kind.custom,
    [BUYER],
    new Uint8Array(1),
    false
  );
  photos.collections.put(GROUP, group);
  MockVM.commitTransaction();
  MockVM.setCallContractResults([block(), block()]);
  expect(c.eligible(v, BUYER, DEP)).toBe(true);
  group.members = [];
  photos.collections.put(GROUP, group);
  MockVM.commitTransaction();
  MockVM.setCallContractResults([block(), block()]);
  expect(c.eligible(v, BUYER, DEP)).toBe(false);
  group.members = [BUYER];
  group.closed = true;
  photos.collections.put(GROUP, group);
  MockVM.setCallContractResults([block(), block()]);
  expect(c.eligible(v, BUYER, DEP)).toBe(false);
});
it("public comments are idempotent, support replies, and can only be deleted by their author", (): void => {
  const v = c.library.get(ID)!;
  v.encrypted = false;
  v.unlock_price = 0;
  c.library.tracks.put(ID, v);
  MockVM.commitTransaction();
  args = new publications.comment_music_arguments(BUYER, ID, CID, Util.str("Nice track"));
  MockVM.setCallContractResults([auth(BUYER), block(), block(), ok()]);
  c.comment(args, DEP, DEP, DEP);
  MockVM.commitTransaction();
  MockVM.setCallContractResults([auth(BUYER), block(), block()]);
  c.comment(args, DEP, DEP, DEP);
  expect(c.listComments(new publications.list_music_comments_arguments(ID)).items.length).toBe(1);
  const reply = new publications.comment_music_arguments(
    OWNER,
    ID,
    new Uint8Array(32).fill(9),
    Util.str("Thank you"),
    null,
    CID
  );
  MockVM.setCallContractResults([auth(OWNER), ok()]);
  c.comment(reply, DEP, DEP, DEP);
  MockVM.commitTransaction();
  expect(c.listComments(new publications.list_music_comments_arguments(ID)).items.length).toBe(2);
  MockVM.setCallContractResults([auth(OWNER)]);
  expect((): void => {
    c.deleteComment(new publications.delete_music_comment_arguments(OWNER, ID, CID), DEP);
  }).toThrow();
  MockVM.setCallContractResults([auth(BUYER)]);
  c.deleteComment(new publications.delete_music_comment_arguments(BUYER, ID, CID), DEP);
  expect(c.comments.get(Util.concat([ID, CID]))!.deleted).toBe(true);
});
it("paid comments require a delivered license and an encrypted body", (): void => {
  args = new publications.comment_music_arguments(
    BUYER,
    ID,
    CID,
    new Uint8Array(32).fill(4),
    new Uint8Array(24)
  );
  MockVM.setCallContractResults([auth(BUYER), block(), block()]);
  expect((): void => {
    c.comment(args, DEP, DEP, DEP);
  }).toThrow();
  pending();
  MockVM.setCallContractResults([auth(BUYER), block(), block()]);
  expect((): void => {
    c.comment(args, DEP, DEP, DEP);
  }).toThrow();
  MockVM.setCallContractResults([auth(OWNER), block(), block(), ok(), ok()]);
  grant();
  MockVM.commitTransaction();
  args.nonce = null;
  MockVM.setCallContractResults([auth(BUYER), block(), block()]);
  expect((): void => {
    c.comment(args, DEP, DEP, DEP);
  }).toThrow();
  args.nonce = new Uint8Array(24);
  MockVM.setCallContractResults([auth(BUYER), block(), block(), ok()]);
  c.comment(args, DEP, DEP, DEP);
  expect(c.listComments(new publications.list_music_comments_arguments(ID)).items.length).toBe(1);
});
