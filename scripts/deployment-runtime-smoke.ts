// Execute the actual release entry points, not the separately compiled as-pect test module.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Contract, Signer, utils } from "koilib";
import { ABIS, PROTOCOL_VERSION } from "@osp/proto";
import { CONTRACT_BUILD_DIR, CONTRACT_ORDER, type ContractName } from "./common.ts";
import { deploymentProbe } from "./deployment-probes.ts";
import { fixtureDeployment } from "../packages/sdk/src/testing/fixtures.ts";
import { buildAllowlist } from "../apps/sponsor/src/policy.ts";
import { desiredRecord } from "../apps/sponsor/src/register.ts";
import { sponsorPolicyBytes } from "./sponsor-registration-wire.ts";
import { encode } from "@osp/sdk";
import protobuf from "protobufjs";

const require = createRequire(import.meta.url);
const { MockVM } = require("@koinos/mock-vm");
const { KoinosError } = require("@koinos/mock-vm/src/errors.js");
const meta = require("@koinos/mock-vm/src/constants.js");
const { koinos } = require("@koinos/proto-js");

export async function smokeDeploymentRuntime(log: (message: string) => void = console.log, tokenFree = false): Promise<void> {
  const activeContracts = CONTRACT_ORDER.filter(name => !tokenFree || name !== "token");
  const vm = new MockVM(true);
  require("../packages/contracts/scripts/mock-vm-storage.cjs").fixMockStorageOrdering(vm);
  const admin = Signer.fromSeed("osp-release-smoke-admin").getAddress();
  const addresses = Object.fromEntries(CONTRACT_ORDER.map(name => [name, Signer.fromSeed(`osp-release-smoke-${name}`).getAddress()])) as Record<ContractName, string>;
  // Name lookup is metadata only; this never executes a native or OSAT token module.
  vm.db.putObject(meta.CONTRACT_ADDRESS_SPACE, new TextEncoder().encode("koin"), koinos.contracts.name_service.address_record.encode({ address: utils.decodeBase58(admin) }).finish());
  const contracts = new Map(CONTRACT_ORDER.map(name => [name, new Contract({ id: addresses[name], abi: ABIS[name] as never })]));
  const modules = new Map(CONTRACT_ORDER.map(name => [name, new WebAssembly.Module(readFileSync(join(CONTRACT_BUILD_DIR, `${name}.wasm`)))]));
  const put = (key: Uint8Array, bytes: Uint8Array) => vm.db.putObject(meta.METADATA_SPACE, key, bytes);
  let calls = 0;

  const invoke = async (name: ContractName, method: string, args: Record<string, unknown> = {}, authorized = [addresses[name], admin], wireArgs?: Uint8Array): Promise<Record<string, any>> => {
    assert(!tokenFree || name !== "token", "Token must never execute during token-free bootstrap");
    const contract = contracts.get(name)!;
    const operation = (await contract.encodeOperation({ name: method, args })).call_contract!;
    put(meta.CONTRACT_ID_KEY, utils.decodeBase58(addresses[name]));
    put(meta.ENTRY_POINT_KEY, koinos.chain.value_type.encode({ int32_value: operation.entry_point }).finish());
    put(meta.CONTRACT_ARGUMENTS_KEY, wireArgs ?? utils.decodeBase64url(operation.args));
    put(meta.HEAD_INFO_KEY, koinos.chain.head_info.encode({ head_block_time: "1800000000000", last_irreversible_block: "1", head_topology: { height: "1" } }).finish());
    put(meta.CALLER_KEY, koinos.chain.caller_data.encode({ caller: new Uint8Array(), caller_privilege: 0 }).finish());
    put(meta.AUTHORITY_KEY, koinos.chain.list_type.encode({ values: authorized.map(account => ({ bytes_value: utils.decodeBase58(account), int32_value: 0, bool_value: true })) }).finish());
    vm.db.removeObject(meta.METADATA_SPACE, meta.CONTRACT_RESULT_KEY);
    vm.db.commitTransaction();
    // Match the chain's lifecycle: no host calls during instantiation, then attach memory,
    // then explicitly execute _start. A fresh instance is used for every contract call.
    let ready = false;
    const instance = new WebAssembly.Instance(modules.get(name)!, { env: {
      invoke_system_call: (...params: number[]) => {
        assert(ready, `${name}.${method}: host call during instantiation`);
        return vm.invokeSystemCall(...params);
      },
    } });
    vm.setInstance(instance);
    ready = true;
    assert.equal(typeof instance.exports._start, "function", `${name}: missing _start`);
    let exited = false;
    try { (instance.exports._start as () => void)(); }
    catch (error) {
      if (error instanceof KoinosError && (error as { code?: number }).code === 0) exited = true;
      else throw new Error(`${name}.${method}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    assert(exited, `${name}.${method}: no successful System.exit`);
    calls += 1;
    const bytes = vm.db.getObject(meta.METADATA_SPACE, meta.CONTRACT_RESULT_KEY)?.value ?? new Uint8Array();
    return await contract.serializer!.deserialize(bytes, contract.abi!.methods![method]!.return!) as Record<string, any>;
  };

  // Start every untouched contract through its generated ABI dispatcher.
  for (const name of activeContracts) {
    const probe = deploymentProbe(name, addresses[name]);
    assert.equal(contracts.get(name)!.abi!.methods![probe.name]!.read_only, true, `${name}: deployment probe must be read-only`);
    await invoke(name, probe.name, probe.args);
  }
  const limits = await invoke("publications", "get_limits");
  assert.equal(Number(limits.value.protocol_version), PROTOCOL_VERSION);
  await assert.rejects(invoke("messaging", "get_dependencies"), /messaging not configured/);
  log(`release entry points: ${activeContracts.length} contracts started successfully`);

  // Use the service's real ABI payload, including repeated numeric entry points.
  // AS-only tests serialize those differently from koilib/protobufjs clients.
  const sponsorDeployment = fixtureDeployment();
  for (const name of CONTRACT_ORDER) sponsorDeployment.contracts[name].address = addresses[name];
  const sponsorPolicy = desiredRecord({
    sponsor: admin,
    publicUrl: "https://social-sponsor.usekoinos.com",
    allowlist: buildAllowlist(sponsorDeployment),
    limits: { version: 2, dailyOps: 200, burstOps: 20, burstWindowSec: 60, maxBytesPerOp: 6144, maxRcPerOp: "200000000", maxOpsPerTx: 4 },
  });
  await invoke("sponsorship", "set_sponsor", sponsorPolicy as unknown as Record<string, unknown>, [admin]);
  const sponsorRecord = (await invoke("sponsorship", "get_sponsor", { sponsor: admin })).value;
  assert.deepEqual(sponsorRecord.allowed, sponsorPolicy.allowed);
  assert.equal(sponsorRecord.policy_version, 2);
  const wirePolicy = {
    ...sponsorPolicy,
    allowed: [{ contract_id: addresses.token, entry_points: [0, 1, 127, 128, 0x80000000, 0xffffffff] }],
  };
  for (const format of ["packed", "unpacked", "mixed"] as const) {
    await invoke("sponsorship", "set_sponsor", {}, [admin], sponsorPolicyBytes(wirePolicy, format));
    assert.deepEqual((await invoke("sponsorship", "get_sponsor", { sponsor: admin })).value.allowed, wirePolicy.allowed);
  }
  // A nested packed length must not consume the following parent fields.
  const base = encode("sponsorship.set_sponsor_arguments", { ...wirePolicy, allowed: [] });
  for (const invalid of [[18, 255, 255, 255, 255, 15], [18, 1, 128], [21, 0, 0, 0, 0]]) {
    const nested = protobuf.Writer.create().uint32(10).bytes(utils.decodeBase58(addresses.token)).finish();
    const outer = protobuf.Writer.create().uint32(42).bytes(Buffer.concat([nested, Buffer.from(invalid)])).finish();
    await assert.rejects(invoke("sponsorship", "set_sponsor", {}, [admin], Buffer.concat([base, outer])));
    assert.deepEqual((await invoke("sponsorship", "get_sponsor", { sponsor: admin })).value.allowed, wirePolicy.allowed);
  }
  const maximumPolicy = {
    ...sponsorPolicy,
    allowed: Array.from({ length: 32 }, () => ({ contract_id: addresses.token, entry_points: Array.from({ length: 64 }, (_, i) => 0xffffffff - i) })),
  };
  await invoke("sponsorship", "set_sponsor", maximumPolicy as unknown as Record<string, unknown>, [admin]);
  assert.deepEqual((await invoke("sponsorship", "get_sponsor", { sponsor: admin })).value.allowed, maximumPolicy.allowed);
  await assert.rejects(invoke("sponsorship", "set_sponsor", { ...sponsorPolicy, allowed: [...maximumPolicy.allowed, maximumPolicy.allowed[0]] }, [admin]), /too many allowed calls/);
  await assert.rejects(invoke("sponsorship", "set_sponsor", { ...sponsorPolicy, allowed: [{ contract_id: addresses.token, entry_points: Array(65).fill(1) }] }, [admin]), /too many entry points/);
  await assert.rejects(invoke("sponsorship", "set_sponsor", sponsorPolicy as unknown as Record<string, unknown>, []));
  await invoke("sponsorship", "set_sponsor", sponsorPolicy as unknown as Record<string, unknown>, [admin]);
  assert.deepEqual((await invoke("sponsorship", "list_sponsors", { limit: 1 })).values[0].allowed, sponsorPolicy.allowed);
  log("sponsor registry verified: service payload, packed/unpacked/mixed fields, malformed input, limits and authority");

  // Exercise the full bootstrap call sequence with real serialization and persisted storage.
  for (const name of ["relationships", "publications", "communities"] as const) {
    await invoke(name, "set_identity_contract", { address: addresses.identity });
  }
  await invoke("publications", "set_relationships_contract", { address: addresses.relationships });
  for (const name of ["relationships", "publications"] as const) {
    await invoke(name, "set_token_contract", tokenFree ? { token_free:true } : { address: addresses.token });
  }
  await invoke("messaging", "set_dependencies", { identity: addresses.identity, relationships: addresses.relationships, ...(tokenFree ? {token_free:true} : {token:addresses.token}) });
  const tokenDependencies = { identity: addresses.identity, relationships: addresses.relationships, publications: addresses.publications, messaging: addresses.messaging };
  if (!tokenFree) await invoke("token", "init", tokenDependencies);
  await invoke("registry", "init", { admin, upgrade_delay_ms: "86400000", protocol_version: PROTOCOL_VERSION });
  for (const name of activeContracts) {
    await invoke("registry", "propose_contract", { name, address: addresses[name], version: 1, abi_hash: utils.encodeBase64url(new Uint8Array(32).fill(1)), notes: "release bootstrap smoke test" }, [admin]);
  }

  // All dependency and discovery values used by the deployment verifier must round-trip.
  for (const name of ["relationships", "communities"] as const) {
    assert.equal((await invoke(name, "get_identity_contract")).value, addresses.identity);
  }
  const publicationDependencies = await invoke("publications", "get_dependencies");
  assert.equal(publicationDependencies.identity, addresses.identity);
  assert.equal(publicationDependencies.relationships, addresses.relationships);
  for (const name of ["relationships", "publications"] as const) {
    const mode = await invoke(name,"get_token_contract");
    if (tokenFree) { assert.equal(mode.token_free,true); assert(!mode.value); }
    else assert.equal(mode.value,addresses.token);
  }
  const messagingDependencies = await invoke("messaging", "get_dependencies");
  assert.equal(messagingDependencies.identity, addresses.identity);
  assert.equal(messagingDependencies.relationships, addresses.relationships);
  if (tokenFree) { assert.equal(messagingDependencies.token_free,true); assert(!messagingDependencies.token); }
  else assert.equal(messagingDependencies.token,addresses.token);
  assert.equal((await invoke("messaging", "get_private_status")).version, 2);
  assert.equal((await invoke("messaging", "get_private_units", { account: admin })).units, "0");
  if (!tokenFree) {
  const config = (await invoke("token", "get_config")).value;
  for (const [key, value] of Object.entries(tokenDependencies)) assert.equal(config[key], value);
  assert.equal(config.resource_version, 2);
  assert.equal((await invoke("token", "get_economy")).self_paid_settlement, true);
  const resources = (await invoke("token", "get_account", { account: admin })).value;
  assert.equal(resources.resource_version, 2);
  assert.equal(resources.free_ticks, "14400000");
  assert.equal(resources.recharge_blocks, "144000");
  await assert.rejects(invoke("token", "activate_recharge", {}, []));
  await assert.rejects(invoke("token", "activate_recharge"), /already activated/);
  }
  assert.equal((await invoke("publications", "get_library_version")).hosted_manifest_version, 1);
  assert.equal((await invoke("publications", "get_music_config")).value.hosted_manifest_version, 1);
  const registryConfig = (await invoke("registry", "get_config")).value;
  assert.equal(registryConfig.admin, admin);
  assert.equal(registryConfig.upgrade_delay_ms, "86400000");
  const entries = (await invoke("registry", "list_contracts")).values;
  assert.equal(entries.length, activeContracts.length);
  if (tokenFree) assert(!entries.some((e: {name:string}) => e.name === "token"));
  for (const name of activeContracts) {
    assert.equal(entries.find((entry: { name: string }) => entry.name === name)?.address, addresses[name]);
    assert.equal((await invoke("registry", "get_contract", { name })).value.address, addresses[name]);
  }

  // The execution harness must also enforce authority and single-use initialization.
  await assert.rejects(invoke("relationships", "set_identity_contract", { address: admin }, []));
  assert.equal((await invoke("relationships", "get_identity_contract")).value, addresses.identity);
  if (!tokenFree) await assert.rejects(invoke("token", "init", tokenDependencies), /already initialized/);
  for (const name of ["publications", "relationships"] as const) {
    await assert.rejects(invoke(name, "set_token_contract", { token_free: true }, []));
    await assert.rejects(invoke(name, "set_token_contract", { token_free: true, address: addresses.token }), /requires no token/);
    await invoke(name, "set_token_contract", { token_free: true });
    const mode = await invoke(name, "get_token_contract");
    assert.equal(mode.token_free, true); assert(!mode.value);
  }
  await invoke("messaging", "set_dependencies", { identity: addresses.identity, relationships: addresses.relationships, token_free: true });
  const mode = await invoke("messaging", "get_dependencies");
  assert.equal(mode.token_free, true); assert(!mode.token);
  await assert.rejects(invoke("messaging", "set_dependencies", { identity: addresses.identity, relationships: addresses.relationships }), /token is required/);
  await assert.rejects(invoke("messaging", "set_dependencies", { identity: addresses.identity, relationships: addresses.relationships, token: addresses.token, token_free: true }), /requires no token/);

  log(`release bootstrap verified: ${calls} successful calls, ${activeContracts.length} registry entries, authority and reinitialization checks`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  smokeDeploymentRuntime().catch(error => { console.error(error); process.exitCode = 1; });
}
