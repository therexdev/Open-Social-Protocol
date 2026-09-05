// Deploy the Open Social Protocol contracts to a Koinos network.
//
//   node --import tsx scripts/deploy-contracts.ts --network harbinger [--dry-run] [--only identity,registry] [--force]
//
// Environment:
//   KOINOS_HARBINGER_DEPLOYER_WIF  funded account that pays Mana (payer)
//   OSP_CONTRACT_SEED              random string; contract accounts derive from it (keep it to upgrade in place)
//   OSP_REGISTRY_ADMIN             registry admin address (default: deployer)
//   OSP_UPGRADE_DELAY_MS           registry time-lock (default 86400000 = 1 day)
//   KOINOS_RPC                     comma-separated RPC override
//
// The contract account signs the upload (contract_upload authority) and the deployer
// co-signs as payer. Dependencies are wired with contract-account signatures and the
// registry is initialised and bootstrapped. Results go to deployments/<network>.json.
import { Contract, Signer, utils } from "koilib";
import type { TransactionJson, TransactionJsonWait } from "koilib";
import { ABIS, PROTOCOL_VERSION } from "@osp/proto";
import {
  CONTRACT_ORDER,
  type ContractName,
  type Deployment,
  contractSigner,
  deployerSigner,
  formatMana,
  log,
  networkFromArgs,
  parseArgs,
  providerFor,
  readContractArtifacts,
  readDeployment,
  requireSeed,
  writeDeployment,
} from "./common.ts";

const args = parseArgs(process.argv.slice(2));
const { name: network, preset } = networkFromArgs(args);
const dryRun = args["dry-run"] === true;
const force = args.force === true;
const only = typeof args.only === "string" ? (args.only.split(",").map((s) => s.trim()) as ContractName[]) : [...CONTRACT_ORDER];

async function main(): Promise<void> {
  const provider = providerFor(preset);
  const deployer = deployerSigner(preset, provider);
  const deployerAddress = deployer.getAddress();
  const seed = requireSeed();

  const chainId = await provider.getChainId();
  log(`network:  ${network}`);
  log(`rpc:      ${preset.rpc.join(", ")}`);
  log(`chain id: ${chainId}`);
  if (preset.expectedChainId && preset.expectedChainId !== chainId) {
    log(`WARNING: expected chain id ${preset.expectedChainId}; the RPC reports ${chainId}. Continuing with the RPC value.`);
  }
  log(`deployer: ${deployerAddress} (rc: ${formatMana(await provider.getAccountRc(deployerAddress))})`);
  if (dryRun) log("mode:     DRY RUN (transactions are simulated with broadcast=false; nothing is committed)");

  const previous = readDeployment(network);
  const deployment: Deployment = {
    network,
    chainId,
    rpc: preset.rpc,
    protocolVersion: PROTOCOL_VERSION,
    deployedAt: new Date().toISOString(),
    deployer: deployerAddress,
    contracts: { ...(previous?.contracts ?? {}) },
    startHeight: previous?.startHeight,
    registryAdmin: previous?.registryAdmin,
    upgradeDelayMs: previous?.upgradeDelayMs,
    indexers: previous?.indexers ?? [],
    sponsors: previous?.sponsors ?? [],
  };
  if (previous && previous.chainId !== chainId && !force) {
    throw new Error(`deployments/${network}.json was written for chain ${previous.chainId}; pass --force to overwrite`);
  }

  const addDeployerSignature = async (tx: TransactionJson): Promise<void> => {
    await deployer.signTransaction(tx);
  };

  // Resolve every contract account first so addresses are known for wiring.
  const signers = new Map<ContractName, Signer>();
  for (const name of CONTRACT_ORDER) signers.set(name, contractSigner(network, name, seed, provider));
  const address = (name: ContractName): string => signers.get(name)!.getAddress();
  log("");
  log("contract accounts (derived from OSP_CONTRACT_SEED):");
  for (const name of CONTRACT_ORDER) log(`  ${name.padEnd(14)} ${address(name)}`);

  let minBlock: number | undefined;
  const rcReport: Array<{ step: string; rc: string }> = [];

  // 1. Upload contracts.
  for (const name of only) {
    const art = readContractArtifacts(name);
    const signer = signers.get(name)!;
    const existing = deployment.contracts[name];
    if (existing && existing.wasmSha256 === art.wasmSha256 && existing.address === signer.getAddress() && !force) {
      log(`\n[${name}] unchanged (wasm sha256 ${art.wasmSha256.slice(0, 12)}...), skipping upload`);
      continue;
    }
    const contract = new Contract({
      id: signer.getAddress(),
      abi: ABIS[name] as never,
      bytecode: new Uint8Array(art.wasm),
      provider,
      signer,
      options: { payer: deployerAddress, beforeSend: addDeployerSignature },
    });
    log(`\n[${name}] uploading ${art.wasm.length} bytes to ${signer.getAddress()}`);
    if (dryRun) {
      const { transaction } = await contract.deploy({ abi: art.abi, sendTransaction: false, signTransaction: true });
      await addDeployerSignature(transaction as TransactionJson);
      const { receipt } = await provider.sendTransaction(transaction as TransactionJson, false);
      log(`[${name}] simulated: ${formatMana(receipt?.rc_used)}${receipt?.reverted ? " REVERTED" : ""}`);
      rcReport.push({ step: `upload ${name}`, rc: String(receipt?.rc_used ?? "?") });
      continue;
    }
    const { transaction, receipt } = await contract.deploy({ abi: art.abi });
    if (!transaction || !receipt) throw new Error(`[${name}] deploy returned no receipt`);
    if (receipt.reverted) throw new Error(`[${name}] upload reverted: ${JSON.stringify(receipt)}`);
    const { blockNumber } = await (transaction as TransactionJsonWait).wait("byBlock", 120000);
    log(`[${name}] tx ${transaction.id} in block ${blockNumber}: ${formatMana(receipt.rc_used)}`);
    rcReport.push({ step: `upload ${name}`, rc: String(receipt.rc_used ?? "?") });
    if (blockNumber !== undefined) minBlock = minBlock === undefined ? blockNumber : Math.min(minBlock, blockNumber);
    deployment.contracts[name] = {
      address: signer.getAddress(),
      txId: transaction.id!,
      block: String(blockNumber ?? ""),
      wasmSha256: art.wasmSha256,
      abiSha256: art.abiSha256,
      rcUsed: String(receipt.rc_used ?? ""),
    };
    if (!dryRun) writeDeployment(deployment);
  }

  if (dryRun) {
    printRc(rcReport);
    log("\ndry run complete; no state changed");
    return;
  }

  // 2. Wire dependencies (contract account signs, deployer pays).
  const call = async (name: ContractName, method: string, callArgs: Record<string, unknown>, signer: Signer): Promise<void> => {
    const contract = new Contract({
      id: address(name),
      abi: ABIS[name] as never,
      provider,
      signer,
      options: { payer: deployerAddress, beforeSend: signer.getAddress() === deployerAddress ? undefined : addDeployerSignature },
    });
    const fn = contract.functions[method];
    if (!fn) throw new Error(`${name}.${method} not in ABI`);
    const { transaction, receipt } = await fn(callArgs);
    if (!transaction || !receipt) throw new Error(`${name}.${method} returned no receipt`);
    if (receipt.reverted) throw new Error(`${name}.${method} reverted: ${JSON.stringify(receipt.logs ?? receipt)}`);
    await (transaction as TransactionJsonWait).wait("byBlock", 120000);
    rcReport.push({ step: `${name}.${method}`, rc: String(receipt.rc_used ?? "?") });
    log(`[${name}] ${method} ok (${formatMana(receipt.rc_used)})`);
  };

  const read = async (name: ContractName, method: string, callArgs: Record<string, unknown> = {}): Promise<Record<string, unknown> | undefined> => {
    const contract = new Contract({ id: address(name), abi: ABIS[name] as never, provider });
    const fn = contract.functions[method];
    if (!fn) throw new Error(`${name}.${method} not in ABI`);
    const { result } = await fn(callArgs);
    return result as Record<string, unknown> | undefined;
  };

  log("\nwiring dependencies:");
  const identity = address("identity");
  const relationships = address("relationships");

  const relCfg = await read("relationships", "get_identity_contract");
  if (relCfg?.value !== identity) await call("relationships", "set_identity_contract", { address: identity }, signers.get("relationships")!);
  else log("[relationships] identity contract already set");

  const pubDeps = await read("publications", "get_dependencies");
  if (pubDeps?.identity !== identity) await call("publications", "set_identity_contract", { address: identity }, signers.get("publications")!);
  else log("[publications] identity contract already set");
  if (pubDeps?.relationships !== relationships) await call("publications", "set_relationships_contract", { address: relationships }, signers.get("publications")!);
  else log("[publications] relationships contract already set");

  const comCfg = await read("communities", "get_identity_contract");
  if (comCfg?.value !== identity) await call("communities", "set_identity_contract", { address: identity }, signers.get("communities")!);
  else log("[communities] identity contract already set");

  // 3. Registry bootstrap.
  const admin = process.env.OSP_REGISTRY_ADMIN || deployerAddress;
  const upgradeDelayMs = process.env.OSP_UPGRADE_DELAY_MS || "86400000";
  const cfg = await read("registry", "get_config");
  if (!cfg?.value) {
    await call("registry", "init", { admin, upgrade_delay_ms: upgradeDelayMs, protocol_version: PROTOCOL_VERSION }, signers.get("registry")!);
  } else {
    log(`[registry] already initialised (admin ${(cfg.value as Record<string, unknown>).admin})`);
  }
  deployment.registryAdmin = admin;
  deployment.upgradeDelayMs = upgradeDelayMs;

  if (admin === deployerAddress) {
    for (const name of CONTRACT_ORDER) {
      const entry = await read("registry", "get_contract", { name });
      const current = entry?.value as Record<string, unknown> | undefined;
      const wanted = deployment.contracts[name];
      if (!wanted) continue;
      if (current && current.address === wanted.address) {
        log(`[registry] ${name} already registered at ${wanted.address}`);
        continue;
      }
      const version = current ? Number(current.version ?? 0) + 1 : 1;
      await call(
        "registry",
        "propose_contract",
        {
          name,
          address: wanted.address,
          version,
          abi_hash: utils.encodeBase64url(Buffer.from(wanted.abiSha256, "hex")),
          notes: `deployed ${deployment.deployedAt}`,
        },
        deployer
      );
      if (current) log(`[registry] ${name} v${version} proposed; activates after the ${upgradeDelayMs} ms time-lock (apply_contract)`);
    }
  } else {
    log(`[registry] admin ${admin} is not the deployer; register contracts with propose_contract from the admin account`);
  }

  if (minBlock !== undefined && (!deployment.startHeight || Number(deployment.startHeight) > minBlock)) {
    deployment.startHeight = String(minBlock);
  }
  const file = writeDeployment(deployment);
  printRc(rcReport);
  log(`\nwrote ${file}`);
}

function printRc(report: Array<{ step: string; rc: string }>): void {
  if (report.length === 0) return;
  log("\nresource report (measured from receipts):");
  let total = 0;
  for (const r of report) {
    log(`  ${r.step.padEnd(40)} ${formatMana(r.rc)}`);
    if (!Number.isNaN(Number(r.rc))) total += Number(r.rc);
  }
  log(`  ${"total".padEnd(40)} ${formatMana(total)}`);
}

main().catch((err) => {
  process.stderr.write(`deploy failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
