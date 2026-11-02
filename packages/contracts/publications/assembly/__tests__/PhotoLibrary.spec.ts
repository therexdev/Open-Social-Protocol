import { Util } from "../common/util";
import {
  Arrays,
  Base58,
  MockVM,
  Protobuf,
  chain,
  system_calls,
} from "@koinos/sdk-as";
import { PhotoLibrary } from "../PhotoLibrary";
import { publications } from "../proto/publications";
import { identity } from "../proto/identity";
import { Testing } from "../common/testing";
const CONTRACT = Base58.decode("122H3z8pc9z9xWpdirvsx1YsbTRwQHEEXu");
const IDENTITY = Base58.decode("1NvZvWNqDX7t93inmLBvbv6kxhpEZYRFWK");
const ALICE = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe");
const BOB = Base58.decode("1BrPkP7JhBwT4MuRDMWiiysGEu4XkyXuCH");
const ID = new Uint8Array(32).fill(21),
  ITEM = new Uint8Array(32).fill(22);
let lib!: PhotoLibrary,
  begin!: publications.begin_photo_arguments,
  append!: publications.append_photo_arguments,
  save!: publications.save_collection_arguments,
  item!: publications.set_album_item_arguments;
function auth(account: Uint8Array, charge: bool = false): void {
  Testing.authorize([account]);
  const result = new identity.resolve_actor_result(true, account, "");
  const calls = [
    new system_calls.exit_arguments(
      0,
      new chain.result(
        Protobuf.encode(result, identity.resolve_actor_result.encode)
      )
    ),
  ];
  if (charge)
    calls.push(
      new system_calls.exit_arguments(0, new chain.result(new Uint8Array(0)))
    );
  MockVM.setCallContractResults(calls);
}
beforeEach((): void => {
  Testing.setup(CONTRACT);
  MockVM.commitTransaction();
  lib = new PhotoLibrary();
});
describe("photo archive", (): void => {
  it("prices exact boundaries and rejects zero or oversized allocations", (): void => {
    expect(lib.units(1)).toBe(1);
    expect(lib.units(32768)).toBe(1);
    expect(lib.units(32769)).toBe(2);
    expect(lib.units(65537)).toBe(4);
    expect(lib.units(131073)).toBe(7);
    expect(lib.units(229377)).toBe(10);
    expect((): void => {
      lib.units(0);
    }).toThrow();
    expect((): void => {
      lib.units(327681);
    }).toThrow();
  });
  it("charges once, verifies committed bytes, accepts identical retries and finalizes in order", (): void => {
    const data = new Uint8Array(100).fill(17),
      hash = lib.hash(data);
    begin = new publications.begin_photo_arguments(ALICE, ID, hash, 100, [
      hash,
    ]);
    auth(ALICE, true);
    lib.begin(begin, IDENTITY, CONTRACT);
    MockVM.commitTransaction();
    auth(ALICE);
    lib.begin(begin, IDENTITY, CONTRACT); // no charge result supplied
    expect(Testing.eventNames().length).toBe(1);
    append = new publications.append_photo_arguments(ALICE, ID, 0, data);
    auth(ALICE);
    lib.append(append, IDENTITY);
    MockVM.commitTransaction();
    auth(ALICE);
    lib.append(append, IDENTITY);
    expect(lib.photos.get(ID)!.received).toBe(1);
    expect(Testing.eventNames().length).toBe(2);
    append.data = new Uint8Array(100).fill(18);
    auth(ALICE);
    expect(() => lib.append(append, IDENTITY)).toThrow("chunk hash mismatch");
  });
  it("rejects another owner and commitment replacement", (): void => {
    const data = new Uint8Array(2).fill(17),
      hash = lib.hash(data);
    begin = new publications.begin_photo_arguments(ALICE, ID, hash, 2, [hash]);
    auth(ALICE, true);
    lib.begin(begin, IDENTITY, CONTRACT);
    MockVM.commitTransaction();
    begin.owner = BOB;
    auth(BOB);
    expect(() => lib.begin(begin, IDENTITY, CONTRACT)).toThrow(
      "archive id already used"
    );
    begin.owner = ALICE;
    begin.digest = new Uint8Array(32).fill(44);
    auth(ALICE);
    expect(() => lib.begin(begin, IDENTITY, CONTRACT)).toThrow(
      "archive id already used"
    );
  });
  it("fails closed without a usage contract", (): void => {
    const hash = new Uint8Array(32).fill(1);
    begin = new publications.begin_photo_arguments(ALICE, ID, hash, 2, [hash]);
    auth(ALICE);
    expect(() => lib.begin(begin, IDENTITY, null)).toThrow(
      "requires configured usage"
    );
  });
});
describe("album and group membership", (): void => {
  beforeEach((): void => {
    save = new publications.save_collection_arguments(
      ALICE,
      ID,
      0,
      1,
      publications.audience_kind.custom,
      [BOB],
      new Uint8Array(1).fill(1)
    );
    auth(ALICE, true);
    lib.save(save, IDENTITY, CONTRACT);
    MockVM.commitTransaction();
  });
  it("only allows the owner to revise membership and rejects stale edits", (): void => {
    save.owner = BOB;
    save.previous_revision = 1;
    auth(BOB);
    expect(() => lib.save(save, IDENTITY, CONTRACT)).toThrow("not owned");
    save.owner = ALICE;
    save.previous_revision = 0;
    auth(ALICE);
    expect(() => lib.save(save, IDENTITY, CONTRACT)).toThrow("stale");
  });
  it("removes current access and requires the new membership epoch for future album writes", (): void => {
    save.previous_revision = 1;
    save.members = [];
    auth(ALICE, true);
    lib.save(save, IDENTITY, CONTRACT);
    MockVM.commitTransaction();
    expect(lib.member(lib.collections.get(ID)!, BOB)).toBe(false);
    expect(lib.member(lib.collections.get(ID)!, ALICE)).toBe(true);
    item = new publications.set_album_item_arguments(
      ALICE,
      ID,
      ITEM,
      1,
      0,
      new Uint8Array(1).fill(2)
    );
    auth(ALICE);
    expect(() => lib.setItem(item, IDENTITY, CONTRACT)).toThrow(
      "membership changed"
    );
    item.epoch = 2;
    auth(ALICE, true);
    lib.setItem(item, IDENTITY, CONTRACT);
    MockVM.commitTransaction();
    item.previous_revision = 1;
    item.removed = true;
    item.envelope = null;
    auth(ALICE, true);
    lib.setItem(item, IDENTITY, CONTRACT);
    const stored = lib.items.get(Util.concat([ID, ITEM]));
    expect(stored != null && stored!.removed).toBe(true);
  });
});
