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
import type { TransactionJson } from "koilib";
import { ABIS, PROTOCOL_VERSION } from "@osp/proto";
import {
  CONTRACT_ORDER,
  type ContractName,
  type Deployment,
  type PendingContractUpload,
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
import { submitMeasured } from "./deployment-transactions.ts";
import { verifyUpload } from "./verify-upload.ts";
import { deploymentProbe } from "./deployment-probes.ts";
import { deploymentServiceEndpoints } from "./deployment-services.ts";
import { confirmDeploymentTransaction, requireFreshDeploymentHead } from "./deployment-confirmation.ts";

const args = parseArgs(process.argv.slice(2));
const { name: network, preset } = networkFromArgs(args);
const dryRun = args["dry-run"] === true;
const force = args.force === true;
const tokenFree = args.economy === "token-free";
if (network === "mainnet" && !tokenFree) throw new Error("Mainnet launch requires --economy token-free");
const only = (typeof args.only === "string" ? (args.only.split(",").map((s) => s.trim()) as ContractName[]) : [...CONTRACT_ORDER]).filter(name => !tokenFree || name !== "token");
if (only.some(name => !CONTRACT_ORDER.includes(name))) throw new Error("Unknown contract selection");

async function main(): Promise<void> {
  if (network === "mainnet") {
    requiredHttps("OSP_MAINNET_INDEXER_URL"); requiredHttps("OSP_MAINNET_SPONSOR_URL");
    if (!process.env.OSP_MAINNET_SPONSOR_ADDRESS) throw new Error("OSP_MAINNET_SPONSOR_ADDRESS is required");
  }
  const provider = providerFor(preset);
  const deployer = deployerSigner(preset, provider);
  const deployerAddress = deployer.getAddress();
  const seed = requireSeed(network);

  const chainId = await provider.getChainId();
  log(`network:  ${network}`);
  log(`rpc:      ${preset.rpc.join(", ")}`);
  log(`chain id: ${chainId}`);
  if (preset.expectedChainId && preset.expectedChainId !== chainId) {
    throw new Error(`Wrong chain: expected ${preset.expectedChainId}, received ${chainId}`);
  }
  const initialHead = await requireFreshDeploymentHead(provider);
  log(`fresh head: ${initialHead.head_topology.height} (${new Date(Number(initialHead.head_block_time)).toISOString()})`);
  log(`deployer: ${deployerAddress} (rc: ${formatMana(await provider.getAccountRc(deployerAddress))})`);
  if (dryRun) log("mode:     DRY RUN (transactions are simulated with broadcast=false; nothing is committed)");

  const published = readDeployment(network);
  const previous = readDeployment(network, true) ?? published;
  const deployment: Deployment = {
    network,
    ...(tokenFree && { economy: "token-free" as const }),
    chainId,
    rpc: preset.rpc,
    protocolVersion: PROTOCOL_VERSION,
    deployedAt: new Date().toISOString(),
    deployer: deployerAddress,
    contracts: { ...(previous?.contracts ?? {}) },
    pendingUploads: { ...(previous?.pendingUploads ?? {}) },
    startHeight: previous?.startHeight,
    registryAdmin: previous?.registryAdmin,
    upgradeDelayMs: previous?.upgradeDelayMs,
    ...deploymentServiceEndpoints(published, previous),
    ...(network === "mainnet" && { indexers: [requiredHttps("OSP_MAINNET_INDEXER_URL")], sponsors: [requiredHttps("OSP_MAINNET_SPONSOR_URL")] }),
  };
  if (previous && previous.chainId !== chainId && (!force || network === "mainnet")) {
    throw new Error(`deployments/${network}.json was written for chain ${previous.chainId}; pass --force to overwrite`);
  }

  // Resolve every contract account first so addresses are known for wiring.
  const signers = new Map<ContractName, Signer>();
  for (const name of CONTRACT_ORDER) signers.set(name, contractSigner(network, name, seed, provider));
  const address = (name: ContractName): string => signers.get(name)!.getAddress();
  if (tokenFree && previous?.contracts.token && !previous.contracts.token.reserved) throw new Error("Refusing to disable an existing token deployment through the launch script");
  if (previous?.economy === "token-free" && !tokenFree) throw new Error("Economic activation requires a separate reviewed migration");
  if (tokenFree) deployment.contracts.token = { address: address("token"), reserved: true, txId: "", block: "0", wasmSha256: "", abiSha256: "", rcUsed: "0" };
  log("");
  log("contract accounts (derived from OSP_CONTRACT_SEED):");
  for (const name of CONTRACT_ORDER) log(`  ${name.padEnd(14)} ${address(name)}`);

  let minBlock: number | undefined;
  const rcReport: Array<{ step: string; rc: string }> = [];

  const completeUpload = async (name: ContractName, pending: PendingContractUpload) => {
    if (pending.address !== address(name)) throw new Error(`[${name}] pending upload belongs to a different contract account`);
    const included = await confirmDeploymentTransaction(provider, pending.txId, Number(pending.startBlock), { log: message => log(`[${name}] ${message}`) });
    const entry = { address: pending.address, txId: pending.txId, block: String(included.blockNumber), wasmSha256: pending.wasmSha256,
      abiSha256: pending.abiSha256, rcUsed: String(included.receipt.rc_used ?? pending.rcUsed) };
    if (!await verifyUpload(provider, entry)) throw new Error(`[${name}] confirmed transaction does not match the expected upload bytes and ABI`);
    deployment.contracts[name] = entry;
    delete deployment.pendingUploads![name];
    minBlock = minBlock === undefined ? included.blockNumber : Math.min(minBlock, included.blockNumber);
    if (!deployment.startHeight || Number(deployment.startHeight) > minBlock) deployment.startHeight = String(minBlock);
    writeDeployment(deployment, true);
    rcReport.push({ step: `upload ${name}`, rc: entry.rcUsed });
    log(`[${name}] tx ${entry.txId} confirmed in block ${entry.block}: ${formatMana(entry.rcUsed)}`);
  };

  // A previous run may have broadcast successfully and then lost confirmation.
  // Resolve those IDs before preparing any new deployment transaction/nonce.
  if (!dryRun) for (const [name, pending] of Object.entries(deployment.pendingUploads ?? {})) {
    if (!CONTRACT_ORDER.includes(name as ContractName) || !pending) throw new Error("Invalid pending upload checkpoint");
    log(`[${name}] reconciling saved transaction ${pending.txId} before any new upload`);
    await completeUpload(name as ContractName, pending);
  }

  // 1. Upload contracts.
  for (const name of only) {
    const art = readContractArtifacts(name);
    const signer = signers.get(name)!;
    const existing = deployment.contracts[name];
    if (existing && existing.address !== signer.getAddress()) {
      throw new Error(`[${name}] derived address differs from the deployed contract; refusing to replace existing accounts`);
    }
    if (existing && existing.wasmSha256 === art.wasmSha256 && existing.abiSha256 === art.abiSha256 &&
        existing.address === signer.getAddress() && !force && await verifyUpload(provider, existing)) {
      log(`\n[${name}] unchanged (wasm sha256 ${art.wasmSha256.slice(0, 12)}...), skipping upload`);
      continue;
    }
    const contract = new Contract({
      id: signer.getAddress(),
      abi: ABIS[name] as never,
      bytecode: new Uint8Array(art.wasm),
      provider,
      signer,
      options: { payer: deployerAddress },
    });
    log(`\n[${name}] uploading ${art.wasm.length} bytes to ${signer.getAddress()}`);
    // Execute the new bytecode in the same transaction as its upload. Simulation now
    // catches startup failures before broadcast, and an upload cannot succeed alone.
    const probe = deploymentProbe(name, signer.getAddress());
    log(`[${name}] validating execution with ${probe.name} in the upload transaction`);
    const nextOperations = [await contract.encodeOperation(probe)];
    if (name === "token" && existing) {
      const current = (await contract.functions.get_config!({})).result as { value?: { resource_version?: number } } | undefined;
      if (current?.value && Number(current.value.resource_version ?? 0) === 0) {
        // The upload and owner-authenticated cutoff commit or revert together.
        // No external snapshot and no interval where v1 and v2 both spend credits.
        nextOperations.push(await contract.encodeOperation({ name: "activate_recharge", args: {} }));
        log("[token] activating five-day recharge atomically with the upgrade");
      }
    }
    const prepared = await contract.deploy({
      abi: art.abi, sendTransaction: false, signTransaction: false, nextOperations,
    });
    const { transaction, receipt } = await submitMeasured(prepared.transaction as TransactionJson, provider, [signer, deployer], {
      dryRun,
      log: message => log(`[${name}] ${message}`),
      beforeBroadcast: async (tx, simulation) => {
        const head = await requireFreshDeploymentHead(provider);
        deployment.pendingUploads![name] = { address: signer.getAddress(), txId: tx.id!, startBlock: head.head_topology.height,
          submittedAt: new Date().toISOString(), wasmSha256: art.wasmSha256, abiSha256: art.abiSha256, rcUsed: String(simulation.rc_used) };
        writeDeployment(deployment, true);
        log(`[${name}] saved upload checkpoint for ${tx.id} before broadcast`);
      },
    });
    if (dryRun) {
      log(`[${name}] simulated: ${formatMana(receipt?.rc_used)}${receipt?.reverted ? " REVERTED" : ""}`);
      rcReport.push({ step: `upload ${name}`, rc: String(receipt?.rc_used ?? "?") });
      continue;
    }
    if (!transaction || !receipt) throw new Error(`[${name}] deploy returned no receipt`);
    if (receipt.reverted) throw new Error(`[${name}] upload reverted: ${JSON.stringify(receipt)}`);
    await completeUpload(name, deployment.pendingUploads![name]!);
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
      options: { payer: deployerAddress },
    });
    const fn = contract.functions[method];
    if (!fn) throw new Error(`${name}.${method} not in ABI`);
    const prepared = await fn(callArgs, { sendTransaction: false, signTransaction: false });
    let startHeight = 0;
    const { transaction, receipt } = await submitMeasured(prepared.transaction as TransactionJson, provider, [signer, deployer], {
      log: message => log(`[${name}.${method}] ${message}`),
      beforeBroadcast: async () => { startHeight = Number((await requireFreshDeploymentHead(provider)).head_topology.height); },
    });
    if (!transaction || !receipt) throw new Error(`${name}.${method} returned no receipt`);
    if (receipt.reverted) throw new Error(`${name}.${method} reverted: ${JSON.stringify(receipt.logs ?? receipt)}`);
    await confirmDeploymentTransaction(provider, transaction.id!, startHeight, { log: message => log(`[${name}.${method}] ${message}`) });
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

  for (const name of ["relationships", "publications"] as const) {
    const usage = await read(name, "get_token_contract");
    if (tokenFree ? usage?.token_free !== true : usage?.value !== address("token")) await call(name, "set_token_contract", tokenFree ? { token_free: true } : { address: address("token") }, signers.get(name)!);
  }
  const messagingDeps = await read("messaging", "get_dependencies").catch(() => undefined);
  if (messagingDeps?.identity !== identity || messagingDeps?.relationships !== relationships || (tokenFree ? messagingDeps?.token_free !== true : messagingDeps?.token !== address("token"))) {
    await call("messaging", "set_dependencies", { identity, relationships, ...(tokenFree ? { token_free: true } : { token: address("token") }) }, signers.get("messaging")!);
  }
  if (!tokenFree) {
    const tokenConfig = await read("token", "get_config");
    if (!tokenConfig?.value) await call("token", "init", { identity, relationships, publications: address("publications"), messaging: address("messaging") }, signers.get("token")!);
  } else {
    const sponsor = process.env.OSP_MAINNET_SPONSOR_ADDRESS;
    if (!sponsor) throw new Error("OSP_MAINNET_SPONSOR_ADDRESS is required for hosted media configuration");
    const music = (await read("publications", "get_music_config"))?.value as Record<string,unknown> | undefined;
    if (!music?.enabled || music.recipient !== sponsor) await call("publications", "set_music_config", { recipient: sponsor, rate_per_mb: "1", flat_fee: "0", max_bytes: 10485760, enabled: true }, signers.get("publications")!);
  }

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
      if (!wanted || wanted.reserved) continue;
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
  delete deployment.pendingUploads;
  const file = writeDeployment(deployment);
  writeDeployment(deployment, true);
  printRc(rcReport);
  log(`\nwrote ${file}`);
}

function requiredHttps(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} must be configured before mainnet deployment`);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error(`${key} must be a public HTTPS URL`);
  return url.toString().replace(/\/+$/, "");
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
