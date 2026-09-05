// node --import tsx --test scripts/common.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Provider } from "koilib";
import { ABIS } from "@osp/proto";
import { CONTRACT_BUILD_DIR, CONTRACT_ORDER, contractSigner, parseArgs, networkFromArgs, NETWORKS } from "./common.ts";

const provider = new Provider(["http://localhost:8080"]);

test("contract accounts derive deterministically from network, name and seed", () => {
  const a1 = contractSigner("harbinger", "identity", "seed-one", provider).getAddress();
  const a2 = contractSigner("harbinger", "identity", "seed-one", provider).getAddress();
  assert.equal(a1, a2);
  assert.notEqual(a1, contractSigner("harbinger", "relationships", "seed-one", provider).getAddress());
  assert.notEqual(a1, contractSigner("localnet", "identity", "seed-one", provider).getAddress());
  assert.notEqual(a1, contractSigner("harbinger", "identity", "seed-two", provider).getAddress());
  const addresses = new Set(CONTRACT_ORDER.map((n) => contractSigner("harbinger", n, "seed-one", provider).getAddress()));
  assert.equal(addresses.size, CONTRACT_ORDER.length);
});

test("argument parsing and network presets", () => {
  const args = parseArgs(["--network", "harbinger", "--dry-run", "--only", "identity,registry"]);
  assert.equal(args.network, "harbinger");
  assert.equal(args["dry-run"], true);
  assert.equal(args.only, "identity,registry");
  const { name, preset } = networkFromArgs(args);
  assert.equal(name, "harbinger");
  assert.deepEqual(preset.rpc, NETWORKS.harbinger!.rpc);
  assert.throws(() => networkFromArgs(parseArgs(["--network", "nope"])), /unknown network/);
  const custom = networkFromArgs(parseArgs(["--network", "custom", "--rpc", "http://a,http://b"]));
  assert.deepEqual(custom.preset.rpc, ["http://a", "http://b"]);
});

test("compiled contract ABIs agree with @osp/proto koilib ABIs (entry points, methods)", (t) => {
  let checked = 0;
  for (const name of CONTRACT_ORDER) {
    const abiPath = join(CONTRACT_BUILD_DIR, `${name}.abi`);
    if (!existsSync(abiPath)) continue;
    const compiled = JSON.parse(readFileSync(abiPath, "utf8")) as { methods: Record<string, { "entry-point": string; "read-only": boolean }> };
    const koilib = ABIS[name];
    assert.deepEqual(Object.keys(compiled.methods).sort(), Object.keys(koilib.methods).sort(), `${name}: method sets differ`);
    for (const [method, m] of Object.entries(compiled.methods)) {
      assert.equal(Number.parseInt(m["entry-point"], 16), koilib.methods[method]!.entry_point, `${name}.${method} entry point`);
      assert.equal(m["read-only"], koilib.methods[method]!.read_only, `${name}.${method} read-only flag`);
    }
    checked += 1;
  }
  if (checked === 0) t.diagnostic("no compiled ABIs found; run npm run build -w packages/contracts first");
});
