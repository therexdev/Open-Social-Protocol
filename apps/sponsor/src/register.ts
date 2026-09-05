/**
 * On-chain registration (`sponsorship.set_sponsor`, spec section 10): the sponsor publishes
 * its endpoint and policy so clients can discover it without any off-chain directory.
 *
 * Registration is self-paid by the sponsor key and is best effort: an unreachable RPC or a
 * reverted transaction is reported, never thrown from `ensureRegistered`.
 */
import type { ProtocolClient, SetSponsorArgs, Signer, SponsorRecord } from "@osp/sdk";
import type { Allowlist, PolicyLimits } from "./policy.js";

export interface DesiredRecordInput {
  sponsor: string;
  publicUrl: string;
  allowlist: Allowlist;
  limits: PolicyLimits;
}

/** The `set_sponsor` arguments describing this service's current policy. */
export function desiredRecord(input: DesiredRecordInput): SetSponsorArgs {
  const endpoint = input.publicUrl.replace(/\/+$/, "");
  const maxOps = Math.min(input.limits.dailyOps, 0xffffffff);
  return {
    sponsor: input.sponsor,
    endpoint,
    policy_uri: `${endpoint}/.well-known/osp-sponsor.json`,
    policy_version: input.limits.version,
    allowed: input.allowlist.toAllowedCalls(),
    max_rc_per_op: input.limits.maxRcPerOp,
    max_ops_per_user_per_day: maxOps,
    max_bytes_per_op: input.limits.maxBytesPerOp,
    active: true,
  };
}

function normalizeAllowed(list: Array<{ contract_id: unknown; entry_points?: number[] | undefined }> | undefined): string {
  return JSON.stringify(
    (list ?? [])
      .map((entry) => ({ contract_id: String(entry.contract_id), entry_points: [...(entry.entry_points ?? [])].sort((a, b) => a - b) }))
      .sort((a, b) => a.contract_id.localeCompare(b.contract_id)),
  );
}

/** True when the on-chain record already reflects `desired` (timestamps ignored). */
export function recordMatches(existing: SponsorRecord | undefined, desired: SetSponsorArgs): boolean {
  if (!existing) return false;
  return (
    existing.sponsor === desired.sponsor &&
    existing.endpoint === desired.endpoint &&
    existing.policy_uri === (desired.policy_uri ?? "") &&
    existing.policy_version === (desired.policy_version ?? 0) &&
    normalizeAllowed(existing.allowed) === normalizeAllowed(desired.allowed) &&
    BigInt(existing.max_rc_per_op) === BigInt(desired.max_rc_per_op ?? 0) &&
    existing.max_ops_per_user_per_day === (desired.max_ops_per_user_per_day ?? 0) &&
    existing.max_bytes_per_op === (desired.max_bytes_per_op ?? 0) &&
    existing.active === (desired.active ?? false)
  );
}

export type RegisterResult =
  | { status: "unchanged"; sponsor: string }
  | { status: "registered"; sponsor: string; txId: string; rcUsed: string }
  | { status: "failed"; sponsor: string; error: string };

export interface EnsureRegisteredOptions {
  client: ProtocolClient;
  signer: Signer;
  desired: SetSponsorArgs;
  log?: (message: string) => void;
}

/**
 * Reads the on-chain sponsor record and, when it differs from `desired`, submits a self-paid
 * `set_sponsor`. Never throws: RPC and chain failures come back as `{ status: "failed" }`.
 */
export async function ensureRegistered(options: EnsureRegisteredOptions): Promise<RegisterResult> {
  const { client, signer, desired } = options;
  const log = options.log ?? (() => undefined);
  const sponsor = String(desired.sponsor);
  try {
    const existing = await client.reads.sponsorship.get_sponsor({ sponsor });
    if (recordMatches(existing?.value, desired)) {
      log(`sponsor record for ${sponsor} is up to date (policy v${desired.policy_version ?? 0})`);
      return { status: "unchanged", sponsor };
    }
    log(`${existing?.value ? "updating" : "creating"} on-chain sponsor record for ${sponsor} (self-paid)`);
    const operation = await client.ops.sponsorship.set_sponsor(desired);
    const result = await client.submit({ operations: [operation], signer, sponsor: null, selfPayFallback: true });
    if (result.receipt.reverted) {
      const logs = (result.receipt.logs ?? []).join("; ");
      log(`set_sponsor reverted: ${logs}`);
      return { status: "failed", sponsor, error: `set_sponsor reverted: ${logs}` };
    }
    const txId = result.transaction.id ?? "";
    log(`set_sponsor broadcast (tx ${txId}, rc ${result.rcUsed})`);
    return { status: "registered", sponsor, txId, rcUsed: result.rcUsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`on-chain registration skipped: ${message}`);
    return { status: "failed", sponsor, error: message };
  }
}
