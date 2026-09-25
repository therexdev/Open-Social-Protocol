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

const require = createRequire(import.meta.url);
const { MockVM } = require("@koinos/mock-vm");
const { KoinosError } = require("@koinos/mock-vm/src/errors.js");
const meta = require("@koinos/mock-vm/src/constants.js");
const { koinos } = require("@koinos/proto-js");

export async function smokeDeploymentRuntime(log: (message: string) => void = console.log): Promise<void> {
  const vm = new MockVM(true);
  const admin = Signer.fromSeed("osp-release-smoke-admin").getAddress();
  const addresses = Object.fromEntries(CONTRACT_ORDER.map(name => [name, Signer.fromSeed(`osp-release-smoke-${name}`).getAddress()])) as Record<ContractName, string>;
  const contracts = new Map(CONTRACT_ORDER.map(name => [name, new Contract({ id: addresses[name], abi: ABIS[name] as never })]));
  const modules = new Map(CONTRACT_ORDER.map(name => [name, new WebAssembly.Module(readFileSync(join(CONTRACT_BUILD_DIR, `${name}.wasm`)))]));
  const put = (key: Uint8Array, bytes: Uint8Array) => vm.db.putObject(meta.METADATA_SPACE, key, bytes);
  let calls = 0;

  const invoke = async (name: ContractName, method: string, args: Record<string, unknown> = {}, authorized = [addresses[name], admin]): Promise<Record<string, any>> => {
    const contract = contracts.get(name)!;
    const operation = (await contract.encodeOperation({ name: method, args })).call_contract!;
    put(meta.CONTRACT_ID_KEY, utils.decodeBase58(addresses[name]));
    put(meta.ENTRY_POINT_KEY, koinos.chain.value_type.encode({ int32_value: operation.entry_point }).finish());
    put(meta.CONTRACT_ARGUMENTS_KEY, utils.decodeBase64url(operation.args));
    put(meta.HEAD_INFO_KEY, koinos.chain.head_info.encode({ head_block_time: "1800000000000", last_irreversible_block: "1" }).finish());
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
  for (const name of CONTRACT_ORDER) {
    const probe = deploymentProbe(name, addresses[name]);
    assert.equal(contracts.get(name)!.abi!.methods![probe.name]!.read_only, true, `${name}: deployment probe must be read-only`);
    await invoke(name, probe.name, probe.args);
  }
  const limits = await invoke("publications", "get_limits");
  assert.equal(Number(limits.value.protocol_version), PROTOCOL_VERSION);
  await assert.rejects(invoke("messaging", "get_dependencies"), /messaging not configured/);
  log("release entry points: all eight contracts started successfully");

  // Exercise the full bootstrap call sequence with real serialization and persisted storage.
  for (const name of ["relationships", "publications", "communities"] as const) {
    await invoke(name, "set_identity_contract", { address: addresses.identity });
  }
  await invoke("publications", "set_relationships_contract", { address: addresses.relationships });
  for (const name of ["relationships", "publications"] as const) {
    await invoke(name, "set_token_contract", { address: addresses.token });
  }
  await invoke("messaging", "set_dependencies", { identity: addresses.identity, relationships: addresses.relationships, token: addresses.token });
  const tokenDependencies = { identity: addresses.identity, relationships: addresses.relationships, publications: addresses.publications, messaging: addresses.messaging };
  await invoke("token", "init", tokenDependencies);
  await invoke("registry", "init", { admin, upgrade_delay_ms: "86400000", protocol_version: PROTOCOL_VERSION });
  for (const name of CONTRACT_ORDER) {
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
    assert.equal((await invoke(name, "get_token_contract")).value, addresses.token);
  }
  const messagingDependencies = await invoke("messaging", "get_dependencies");
  assert.equal(messagingDependencies.identity, addresses.identity);
  assert.equal(messagingDependencies.relationships, addresses.relationships);
  assert.equal(messagingDependencies.token, addresses.token);
  const config = (await invoke("token", "get_config")).value;
  for (const [key, value] of Object.entries(tokenDependencies)) assert.equal(config[key], value);
  const registryConfig = (await invoke("registry", "get_config")).value;
  assert.equal(registryConfig.admin, admin);
  assert.equal(registryConfig.upgrade_delay_ms, "86400000");
  const entries = (await invoke("registry", "list_contracts")).values;
  assert.equal(entries.length, CONTRACT_ORDER.length);
  for (const name of CONTRACT_ORDER) {
    assert.equal(entries.find((entry: { name: string }) => entry.name === name)?.address, addresses[name]);
    assert.equal((await invoke("registry", "get_contract", { name })).value.address, addresses[name]);
  }

  // The execution harness must also enforce authority and single-use initialization.
  await assert.rejects(invoke("relationships", "set_identity_contract", { address: admin }, []));
  assert.equal((await invoke("relationships", "get_identity_contract")).value, addresses.identity);
  await assert.rejects(invoke("token", "init", tokenDependencies), /already initialized/);
  log(`release bootstrap verified: ${calls} successful calls, eight registry entries, authority and reinitialization checks`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  smokeDeploymentRuntime().catch(error => { console.error(error); process.exitCode = 1; });
}
