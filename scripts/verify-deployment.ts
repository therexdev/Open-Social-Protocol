// Verify a deployment with read-only calls (no keys required).
//
//   node --import tsx scripts/verify-deployment.ts --network harbinger
import { Contract, Provider } from "koilib";
import { ABIS } from "@osp/proto";
import { CONTRACT_ORDER, type ContractName, log, networkFromArgs, parseArgs, readDeployment } from "./common.ts";

const args = parseArgs(process.argv.slice(2));
const { name: network, preset } = networkFromArgs(args);

async function main(): Promise<void> {
  const deployment = readDeployment(network);
  if (!deployment) throw new Error(`deployments/${network}.json not found`);
  const provider = new Provider(deployment.rpc?.length ? deployment.rpc : preset.rpc);
  const chainId = await provider.getChainId();
  let failures = 0;
  const check = (ok: boolean, what: string): void => {
    log(`${ok ? "ok  " : "FAIL"} ${what}`);
    if (!ok) failures += 1;
  };
  check(chainId === deployment.chainId, `chain id ${chainId}`);

  const contract = (name: ContractName): Contract => {
    const entry = deployment.contracts[name];
    if (!entry) throw new Error(`${name} missing from deployment`);
    return new Contract({ id: entry.address, abi: ABIS[name] as never, provider });
  };
  const read = async (name: ContractName, method: string, callArgs: Record<string, unknown> = {}): Promise<Record<string, unknown> | undefined> => {
    const fn = contract(name).functions[method];
    if (!fn) throw new Error(`${name}.${method} not in ABI`);
    const { result } = await fn(callArgs);
    return result as Record<string, unknown> | undefined;
  };

  for (const name of CONTRACT_ORDER) {
    const entry = deployment.contracts[name];
    if (!entry) {
      check(false, `${name} present in manifest`);
      continue;
    }
    const meta = await provider.invokeGetContractMetadata(entry.address).catch(() => undefined);
    check(Boolean(meta?.value?.hash), `${name} bytecode uploaded at ${entry.address}`);
  }

  const identity = deployment.contracts.identity?.address;
  const relationships = deployment.contracts.relationships?.address;
  const limits = await read("publications", "get_limits");
  check(Number((limits?.value as Record<string, unknown> | undefined)?.protocol_version) === deployment.protocolVersion, "publications.get_limits protocol_version");
  const deps = await read("publications", "get_dependencies");
  check(deps?.identity === identity && deps?.relationships === relationships, "publications dependencies wired");
  const rel = await read("relationships", "get_identity_contract");
  check(rel?.value === identity, "relationships identity contract wired");
  const com = await read("communities", "get_identity_contract");
  check(com?.value === identity, "communities identity contract wired");
  const cfg = await read("registry", "get_config");
  check(Boolean((cfg?.value as Record<string, unknown> | undefined)?.admin), `registry initialised (admin ${(cfg?.value as Record<string, unknown> | undefined)?.admin})`);
  const list = await read("registry", "list_contracts");
  const entries = ((list?.values as Array<Record<string, unknown>> | undefined) ?? []);
  for (const name of CONTRACT_ORDER) {
    const e = entries.find((x) => x.name === name);
    check(Boolean(e) && e!.address === deployment.contracts[name]?.address, `registry lists ${name}`);
  }
  const sponsors = await read("sponsorship", "list_sponsors", { limit: 10 });
  log(`info sponsors registered: ${((sponsors?.values as unknown[] | undefined) ?? []).length}`);
  const me = await read("identity", "get_identity", { account: deployment.deployer });
  log(`info deployer identity registered: ${me?.value ? "yes" : "no"}`);

  if (failures > 0) {
    log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  log("\ndeployment verified");
}

main().catch((err) => {
  process.stderr.write(`verify failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
