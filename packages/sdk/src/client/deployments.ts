/**
 * Deployment manifests (`deployments/<network>.json`, see deployments/README.md).
 */
import { CONTRACT_NAMES, type ContractName } from "../constants.js";
import { isAddress } from "../ids.js";

export interface DeploymentContract {
  address: string;
  txId?: string;
  block?: string;
  wasmSha256?: string;
  abiSha256?: string;
  rcUsed?: string;
}

export interface Deployment {
  network: string;
  /** base64url chain id recorded at deploy time. */
  chainId: string;
  rpc: string[];
  protocolVersion: number;
  deployedAt?: string;
  deployer?: string;
  contracts: Record<ContractName, DeploymentContract>;
  /** Height of the first deployment transaction; indexers replay from it. */
  startHeight?: string;
  indexers?: string[];
  sponsors?: string[];
}

export class DeploymentError extends Error {
  override name = "DeploymentError";
}

/** Parses and validates a deployment manifest (JSON text or object). */
export function loadDeployment(input: string | unknown): Deployment {
  let raw: unknown;
  try {
    raw = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw new DeploymentError("deployment manifest is not valid JSON");
  }
  if (!raw || typeof raw !== "object") throw new DeploymentError("deployment manifest must be an object");
  const d = raw as Record<string, unknown>;
  if (typeof d.network !== "string" || d.network.length === 0) throw new DeploymentError("network is required");
  if (typeof d.chainId !== "string" || d.chainId.length === 0) throw new DeploymentError("chainId is required");
  if (!Array.isArray(d.rpc) || d.rpc.length === 0 || !d.rpc.every((u) => typeof u === "string")) {
    throw new DeploymentError("rpc must be a non-empty array of URLs");
  }
  const protocolVersion = typeof d.protocolVersion === "number" ? d.protocolVersion : Number(d.protocolVersion);
  if (!Number.isInteger(protocolVersion) || protocolVersion < 1) throw new DeploymentError("protocolVersion is required");
  if (!d.contracts || typeof d.contracts !== "object") throw new DeploymentError("contracts is required");
  const contractsRaw = d.contracts as Record<string, unknown>;
  const contracts = {} as Record<ContractName, DeploymentContract>;
  for (const name of CONTRACT_NAMES) {
    const entry = contractsRaw[name];
    if (!entry || typeof entry !== "object") throw new DeploymentError(`contracts.${name} is missing`);
    const e = entry as Record<string, unknown>;
    if (!isAddress(e.address)) throw new DeploymentError(`contracts.${name}.address is not a valid address`);
    contracts[name] = {
      address: e.address,
      ...(typeof e.txId === "string" && { txId: e.txId }),
      ...(e.block !== undefined && { block: String(e.block) }),
      ...(typeof e.wasmSha256 === "string" && { wasmSha256: e.wasmSha256 }),
      ...(typeof e.abiSha256 === "string" && { abiSha256: e.abiSha256 }),
      ...(e.rcUsed !== undefined && { rcUsed: String(e.rcUsed) }),
    };
  }
  const strings = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;
  return {
    network: d.network,
    chainId: d.chainId,
    rpc: d.rpc as string[],
    protocolVersion,
    ...(typeof d.deployedAt === "string" && { deployedAt: d.deployedAt }),
    ...(typeof d.deployer === "string" && { deployer: d.deployer }),
    contracts,
    ...(d.startHeight !== undefined && { startHeight: String(d.startHeight) }),
    ...(strings(d.indexers) && { indexers: strings(d.indexers) }),
    ...(strings(d.sponsors) && { sponsors: strings(d.sponsors) }),
  };
}

/** Contract addresses by name. */
export function contractAddresses(deployment: Deployment): Record<ContractName, string> {
  const out = {} as Record<ContractName, string>;
  for (const name of CONTRACT_NAMES) out[name] = deployment.contracts[name].address;
  return out;
}

/** The contract name deployed at `address`, if it is one of the protocol contracts. */
export function contractNameForAddress(deployment: Deployment, address: string): ContractName | undefined {
  return CONTRACT_NAMES.find((name) => deployment.contracts[name].address === address);
}
