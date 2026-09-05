/**
 * Sponsor policy: which `(contract, entry_point)` pairs are funded, and which argument
 * field names the acting account for each method (spec section 10, sponsor-api.md).
 *
 * Default allowlist: every non-read-only method of identity, relationships, publications and
 * communities except the admin setters (`set_identity_contract`, `set_relationships_contract`).
 * Sponsorship and registry methods are never funded unless listed explicitly with
 * `OSP_SPONSOR_ALLOWLIST`.
 */
import { ABIS } from "@osp/proto";
import { CONTRACT_NAMES, type ContractName, type Deployment, type SponsorPolicy } from "@osp/sdk";

/** Contracts funded by the default policy. */
export const SPONSORED_CONTRACTS: readonly ContractName[] = ["identity", "relationships", "publications", "communities"];

/** Methods that are never sponsored by default (contract-account administration). */
export const ADMIN_METHODS: ReadonlySet<string> = new Set(["set_identity_contract", "set_relationships_contract"]);

/**
 * Argument field naming the acting account per method. `null` marks methods anyone may
 * call (no actor to compare against the payee). Methods missing here fall back to
 * `ACTOR_FIELD_PRIORITY`.
 */
export const ACTOR_FIELDS: Readonly<Partial<Record<ContractName, Readonly<Record<string, string | null>>>>> = {
  identity: {
    register: "account",
    update_profile: "account",
    rotate_encryption_key: "account",
    authorize_device: "account",
    revoke_device: "account",
    set_recovery_policy: "account",
    apply_recovery_policy: "account",
    cancel_recovery_policy: "account",
    // The guardian signs a recovery proposal (spec section 3.3).
    propose_recovery: "guardian",
    cancel_recovery: "account",
    // "anyone may call" after the delay; the new owner typically does.
    execute_recovery: null,
  },
  relationships: {
    request_friend: "requester",
    accept_friend: "approver",
    remove_friend: "actor",
    block: "actor",
    unblock: "actor",
    follow: "follower",
    unfollow: "follower",
    rotate_audience: "actor",
  },
  publications: {
    publish: "author",
    set_lifecycle: "author",
    react: "actor",
    distribute_keys: "author",
    record_cross_post: "author",
  },
  communities: {
    create_community: "creator",
    set_role: "actor",
    set_policy: "actor",
    propose_owner_transfer: "owner",
    cancel_owner_transfer: "owner",
    execute_owner_transfer: null,
    set_label: "actor",
  },
  sponsorship: {
    set_sponsor: "sponsor",
    deactivate_sponsor: "sponsor",
    set_user_grant: "sponsor",
    revoke_user_grant: "sponsor",
  },
};

/**
 * Methods whose `device` argument is the subject of the call (the key being authorised or
 * revoked), not a device authority signing it. The contract requires the owner, so the payee
 * is never accepted through `device === payee` for these: only `account === payee` or the
 * owner lookup applies.
 */
export const DEVICE_IS_SUBJECT: ReadonlySet<string> = new Set(["identity.authorize_device", "identity.revoke_device"]);

/** True when `contract.method` may be signed by the `device` named in its arguments. */
export function deviceMaySign(contract: ContractName, method: string): boolean {
  return !DEVICE_IS_SUBJECT.has(`${contract}.${method}`);
}

/** Fallback search order for methods without an explicit `ACTOR_FIELDS` entry. */
export const ACTOR_FIELD_PRIORITY: readonly string[] = [
  "account",
  "author",
  "actor",
  "requester",
  "approver",
  "follower",
  "creator",
  "owner",
  "sponsor",
  "guardian",
];

/**
 * Returns the name of the argument field that must equal the payee for `contract.method`,
 * or `null` when the method has no actor (anyone may call it).
 */
export function actorField(contract: ContractName, method: string, args: Record<string, unknown>): string | null {
  const explicit = ACTOR_FIELDS[contract]?.[method];
  if (explicit !== undefined) return explicit;
  return ACTOR_FIELD_PRIORITY.find((field) => typeof args[field] === "string") ?? null;
}

export interface AllowedMethod {
  contract: ContractName;
  address: string;
  method: string;
  entryPoint: number;
}

export class PolicyError extends Error {
  override name = "PolicyError";
}

function isContractName(value: string): value is ContractName {
  return (CONTRACT_NAMES as readonly string[]).includes(value);
}

/** Every write method of the four social contracts except the admin setters. */
export function defaultAllowlist(deployment: Deployment): AllowedMethod[] {
  const out: AllowedMethod[] = [];
  for (const contract of SPONSORED_CONTRACTS) {
    for (const [method, def] of Object.entries(ABIS[contract].methods)) {
      if (def.read_only || ADMIN_METHODS.has(method)) continue;
      out.push({ contract, address: deployment.contracts[contract].address, method, entryPoint: def.entry_point });
    }
  }
  return out;
}

/**
 * Parses `OSP_SPONSOR_ALLOWLIST`: comma/whitespace separated `contract:method` entries, or
 * `contract:*` for every non-admin write method of a contract. Read-only methods and unknown
 * names are rejected.
 */
export function parseAllowlist(spec: string, deployment: Deployment): AllowedMethod[] {
  const entries = spec
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (entries.length === 0) throw new PolicyError("allowlist is empty");
  const out = new Map<string, AllowedMethod>();
  for (const entry of entries) {
    const [contract, method, ...rest] = entry.split(":");
    if (!contract || !method || rest.length > 0) throw new PolicyError(`allowlist entry "${entry}" must be contract:method`);
    if (!isContractName(contract)) throw new PolicyError(`allowlist entry "${entry}": unknown contract "${contract}"`);
    const methods = ABIS[contract].methods;
    const names = method === "*" ? Object.keys(methods).filter((m) => !methods[m]?.read_only && !ADMIN_METHODS.has(m)) : [method];
    for (const name of names) {
      const def = methods[name];
      if (!def) throw new PolicyError(`allowlist entry "${entry}": ${contract} has no method "${name}"`);
      if (def.read_only) throw new PolicyError(`allowlist entry "${entry}": ${contract}.${name} is read-only`);
      out.set(`${contract}.${name}`, { contract, address: deployment.contracts[contract].address, method: name, entryPoint: def.entry_point });
    }
  }
  return [...out.values()];
}

/** Indexed allowlist with the shapes needed for discovery and on-chain registration. */
export class Allowlist {
  readonly entries: readonly AllowedMethod[];
  private readonly byAddress: Map<string, Map<number, AllowedMethod>>;

  constructor(entries: AllowedMethod[]) {
    this.entries = [...entries].sort((a, b) => a.contract.localeCompare(b.contract) || a.method.localeCompare(b.method));
    this.byAddress = new Map();
    for (const entry of this.entries) {
      let methods = this.byAddress.get(entry.address);
      if (!methods) {
        methods = new Map();
        this.byAddress.set(entry.address, methods);
      }
      methods.set(entry.entryPoint, entry);
    }
  }

  /** The allowed method for `(contract_id, entry_point)`, if any. */
  lookup(address: string, entryPoint: number): AllowedMethod | undefined {
    return this.byAddress.get(address)?.get(entryPoint);
  }

  has(address: string, entryPoint: number): boolean {
    return this.lookup(address, entryPoint) !== undefined;
  }

  /** Discovery document shape (`policy.allowed`). */
  toDiscovery(): Array<{ contract: string; entryPoints: number[]; methods: string[] }> {
    return [...this.byAddress.entries()].map(([contract, methods]) => ({
      contract,
      entryPoints: [...methods.keys()].sort((a, b) => a - b),
      methods: [...methods.values()].map((m) => m.method).sort(),
    }));
  }

  /** `sponsorship.allowed_call` list for `set_sponsor`. */
  toAllowedCalls(): Array<{ contract_id: string; entry_points: number[] }> {
    return this.toDiscovery().map(({ contract, entryPoints }) => ({ contract_id: contract, entry_points: entryPoints }));
  }

  /** Human-readable `contract.method` names (README / logs). */
  describe(): string[] {
    return this.entries.map((e) => `${e.contract}.${e.method}`);
  }
}

export interface PolicyLimits {
  version: number;
  maxBytesPerOp: number;
  /** Decimal uint64 string. */
  maxRcPerOp: string;
  maxOpsPerTx: number;
  dailyOps: number;
  burstOps: number;
  burstWindowSec: number;
}

/** Builds the allowlist from the deployment and an optional override spec. */
export function buildAllowlist(deployment: Deployment, override?: string): Allowlist {
  return new Allowlist(override ? parseAllowlist(override, deployment) : defaultAllowlist(deployment));
}

/** `policy` section of the discovery document. */
export function discoveryPolicy(allowlist: Allowlist, limits: PolicyLimits): SponsorPolicy {
  return {
    version: limits.version,
    allowed: allowlist.toDiscovery(),
    maxBytesPerOp: limits.maxBytesPerOp,
    maxRcPerOp: limits.maxRcPerOp,
    maxOpsPerTx: limits.maxOpsPerTx,
    perUser: { dailyOps: limits.dailyOps, burstOps: limits.burstOps, burstWindowSec: limits.burstWindowSec },
  };
}
