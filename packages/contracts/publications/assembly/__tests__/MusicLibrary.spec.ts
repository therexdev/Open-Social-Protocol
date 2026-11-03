import { System, Arrays, Base58, MockVM, Protobuf, chain, system_calls } from "@koinos/sdk-as";
import { MusicLibrary } from "../MusicLibrary";
import { publications } from "../proto/publications";
import { identity } from "../proto/identity";
import { Testing } from "../common/testing";
import { Util } from "../common/util";
const CONTRACT = Base58.decode("122H3z8pc9z9xWpdirvsx1YsbTRwQHEEXu"),
  IDENTITY = Base58.decode("1NvZvWNqDX7t93inmLBvbv6kxhpEZYRFWK"),
  ALICE = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe"),
  BOB = Base58.decode("1BrPkP7JhBwT4MuRDMWiiysGEu4XkyXuCH");
const ID = new Uint8Array(32).fill(52),
  DATA = new Uint8Array(20).fill(7);
let lib!: MusicLibrary,
  begin!: publications.begin_music_arguments,
  append!: publications.append_music_arguments,
  config!: publications.set_music_config_arguments;
function auth(account: Uint8Array = ALICE, payment: i32 = -1): void {
  Testing.authorize([account]);
  const results = [
    new system_calls.exit_arguments(
      0,
      new chain.result(
        Protobuf.encode(
          new identity.resolve_actor_result(true, account, ""),
          identity.resolve_actor_result.encode
        )
      )
    ),
  ];
  if (payment >= 0)
    results.push(
      new system_calls.exit_arguments(
        payment,
        new chain.result(
          new Uint8Array(0),
          payment == 0 ? null : new chain.error_data("insufficient native balance")
        )
      )
    );
  MockVM.setCallContractResults(results);
}
function start(): void {
  auth(ALICE, 0);
  lib.begin(begin, IDENTITY);
  MockVM.commitTransaction();
}
beforeEach((): void => {
  System.setSystemBufferSize(32 * 1024);
  Testing.setup(CONTRACT);
  MockVM.setContractAddress("koin", CONTRACT);
  lib = new MusicLibrary();
  config = new publications.set_music_config_arguments(BOB, 8610000000, 10485760, true);
  Testing.authorize([CONTRACT]);
  lib.setConfig(config);
  MockVM.commitTransaction();
  const hash = lib.hash(DATA);
  begin = new publications.begin_music_arguments(
    ALICE,
    ID,
    hash,
    20,
    [hash],
    "Test track",
    "audio/mpeg",
    210000,
    1,
    100000000,
    ALICE
  );
  append = new publications.append_music_arguments(ALICE, ID, 0, DATA);
});
describe("paid native music", (): void => {
  it("matches simple benchmark pricing and exact whole-token boundaries", (): void => {
    expect(lib.fee(8403113, 8610000000)).toBe(72400000000);
    expect(lib.fee(5041885, 8610000000)).toBe(43500000000);
    expect(lib.fee(1000000, 100000000)).toBe(100000000);
    expect(lib.fee(1000001, 100000000)).toBe(200000000);
    expect(lib.fee(10485760, 1000000000000)).toBe(10485800000000);
  });
  it("requires contract authority for pricing", (): void => {
    Testing.authorize([ALICE]);
    expect(() => lib.setConfig(config)).toThrow();
  });
  it("charges once and permits retries even after changing the rate and pausing", (): void => {
    start();
    expect(lib.tracks.get(ID)!.fee).toBe(100000000);
    expect(Arrays.equal(lib.tracks.get(ID)!.recipient!, BOB)).toBe(true);
    Testing.authorize([CONTRACT]);
    config.enabled = false;
    config.rate_per_mb = 10000000000;
    lib.setConfig(config);
    MockVM.commitTransaction();
    auth();
    lib.begin(begin, IDENTITY); // no payment call mocked: a second transfer fails this test
    auth();
    lib.append(append, IDENTITY);
    MockVM.commitTransaction();
    auth();
    lib.append(append, IDENTITY);
    expect(lib.get(ID)!.received).toBe(1);
    expect(Arrays.equal(lib.chunks.get(Util.concat([ID, Util.u32be(0)]))!.data!, DATA)).toBe(true);
    expect(lib.list(new publications.list_music_arguments(ALICE)).ids.length).toBe(1);
    expect(lib.list(new publications.list_music_arguments(BOB)).ids.length).toBe(0);
    expect(lib.list(new publications.list_music_arguments(ALICE, ID)).ids.length).toBe(0);
    expect(Testing.eventNames()).toStrictEqual([
      "osp.publications.music_paid",
      "osp.publications.music_completed",
    ]);
  });
  it("rejects an unpaid append", (): void => {
    auth();
    expect(() => lib.append(append, IDENTITY)).toThrow("paid music upload not owned");
  });
  it("rejects stale quotes, underpayment and fee-recipient self-payment", (): void => {
    begin.config_revision = 0;
    auth();
    expect(() => lib.begin(begin, IDENTITY)).toThrow("price changed");
    begin.config_revision = 1;
    begin.max_fee = 0;
    auth();
    expect(() => lib.begin(begin, IDENTITY)).toThrow("accepted quote");
    begin.max_fee = 100000000;
    begin.payer = BOB;
    auth();
    expect(() => lib.begin(begin, IDENTITY)).toThrow("payer cannot");
  });
  it("requires payer authority independently from publish authority", (): void => {
    begin.payer = CONTRACT;
    auth();
    expect(() => lib.begin(begin, IDENTITY)).toThrow();
  });
  it("fails a rejected native-token transfer without a reservation", (): void => {
    auth(ALICE, 1);
    expect(() => lib.begin(begin, IDENTITY)).toThrow();
    expect(lib.tracks.get(ID) == null).toBe(true);
  });
  it("rejects changed metadata, another owner, corrupted chunks and out-of-order writes", (): void => {
    start();
    begin.title = "Changed";
    auth();
    expect(() => lib.begin(begin, IDENTITY)).toThrow("music id already used");
    append.owner = BOB;
    auth(BOB);
    expect(() => lib.append(append, IDENTITY)).toThrow("not owned");
    append.owner = ALICE;
    append.index = 1;
    auth();
    expect(() => lib.append(append, IDENTITY)).toThrow("unexpected");
    append.index = 0;
    append.data = new Uint8Array(20).fill(8);
    auth();
    expect(() => lib.append(append, IDENTITY)).toThrow("hash mismatch");
    expect(lib.list(new publications.list_music_arguments(ALICE)).ids.length).toBe(0);
  });
  it("bounds uploads and rejects invalid manifests before payment", (): void => {
    begin.size = 10485761;
    auth();
    expect(() => lib.begin(begin, IDENTITY)).toThrow("10 MiB");
    begin.size = 20000;
    auth();
    expect(() => lib.begin(begin, IDENTITY)).toThrow("chunk count");
    begin.size = 20;
    begin.mime = "video/mp4";
    auth();
    expect(() => lib.begin(begin, IDENTITY)).toThrow("unsupported audio");
  });
});

it("stores the maximum 640-chunk manifest within the protocol buffers", (): void => {
  const full = new Uint8Array(16384).fill(3),
    hash = lib.hash(full);
  begin.size = 10485760;
  begin.chunk_hashes = [];
  for (let i = 0; i < 640; i++) begin.chunk_hashes.push(hash);
  begin.max_fee = 90300000000;
  expect(Protobuf.encode(begin, publications.begin_music_arguments.encode).length < 24576).toBe(
    true
  );
  start();
  const value = lib.tracks.get(ID)!;
  expect(value.chunk_hashes.length).toBe(640);
  expect(value.fee).toBe(90300000000);
  expect(Protobuf.encode(value, publications.music_record.encode).length < 32768).toBe(true);
  append.data = full;
  auth();
  lib.append(append, IDENTITY);
  expect(lib.get(ID)!.received).toBe(1);
});

it("batches sequential chunks without rewriting the immutable manifest", (): void => {
  const data = new Uint8Array(16384).fill(7),
    hash = lib.hash(data);
  begin.size = 5 * 16384;
  begin.chunk_hashes = [hash, hash, hash, hash, hash];
  begin.max_fee = lib.fee(begin.size, 8610000000);
  start();
  const original = Protobuf.encode(lib.tracks.get(ID)!, publications.music_record.encode);
  auth();
  lib.appendBatch(
    new publications.append_music_batch_arguments(ALICE, ID, 0, [data, data, data, data]),
    IDENTITY
  );
  MockVM.commitTransaction();
  expect(lib.get(ID)!.received).toBe(4);
  expect(
    Arrays.equal(original, Protobuf.encode(lib.tracks.get(ID)!, publications.music_record.encode))
  ).toBe(true);
  auth();
  lib.appendBatch(
    new publications.append_music_batch_arguments(ALICE, ID, 0, [data, data, data, data]),
    IDENTITY
  );
  MockVM.commitTransaction();
  expect(lib.get(ID)!.received).toBe(4);
  auth();
  lib.appendBatch(new publications.append_music_batch_arguments(ALICE, ID, 4, [data]), IDENTITY);
  MockVM.commitTransaction();
  expect(lib.get(ID)!.received).toBe(5);
  expect(lib.list(new publications.list_music_arguments(ALICE)).ids.length).toBe(1);
});
it("resumes a legacy manifest into separate progress without losing confirmed chunks", (): void => {
  start();
  const legacy = lib.tracks.get(ID)!;
  legacy.version = 0;
  lib.tracks.put(ID, legacy);
  MockVM.commitTransaction();
  auth();
  lib.append(append, IDENTITY);
  MockVM.commitTransaction();
  expect(lib.tracks.get(ID)!.received).toBe(0);
  expect(lib.get(ID)!.received).toBe(1);
});
it("rejects restricted plaintext, a missing paid key and unbounded batches", (): void => {
  begin.audience = 1;
  auth();
  expect((): void => {
    lib.begin(begin, IDENTITY);
  }).toThrow();
  begin.audience = 0;
  begin.unlock_price = 10;
  auth();
  expect((): void => {
    lib.begin(begin, IDENTITY);
  }).toThrow();
  begin.encrypted = true;
  auth();
  expect((): void => {
    lib.begin(begin, IDENTITY);
  }).toThrow();
  expect((): void => {
    lib.appendBatch(
      new publications.append_music_batch_arguments(ALICE, ID, 0, [DATA, DATA, DATA, DATA, DATA]),
      IDENTITY
    );
  }).toThrow();
});
