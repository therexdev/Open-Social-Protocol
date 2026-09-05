/**
 * Pure validation of submitted transactions and operations (spec section 10, items 1-3).
 *
 * Nothing here touches the network: the caller supplies the deployment, the sponsor address,
 * the allowlist and the limits. Every refusal is a `SponsorRefusal` with a stable category
 * from docs/sponsor-api.md and the HTTP status the server should answer with.
 */
import { Signer, Transaction, isAddress, type ProtocolContracts, type SponsorErrorCategory, type TransactionJson } from "@osp/sdk";
import type { CallContractOperationJson, OperationJson } from "@osp/sdk";
import { utils } from "koilib";
import { actorField, deviceMaySign, type Allowlist } from "./policy.js";

export const STATUS_FOR_CATEGORY: Readonly<Record<SponsorErrorCategory, number>> = {
  quota_exceeded: 429,
  method_not_allowed: 403,
  too_large: 413,
  chain_mismatch: 400,
  invalid_signature: 400,
  invalid_transaction: 400,
  temporarily_unavailable: 503,
};

/** A typed refusal; the server serialises it as `{ error: { category, message } }`. */
export class SponsorRefusal extends Error {
  override name = "SponsorRefusal";
  readonly category: SponsorErrorCategory;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(category: SponsorErrorCategory, message: string, details?: Record<string, unknown>) {
    super(message);
    this.category = category;
    this.status = STATUS_FOR_CATEGORY[category];
    this.details = details;
  }
}

export interface ValidationLimits {
  maxBytesPerOp: number;
  /** Decimal uint64 string. */
  maxRcPerOp: string;
  maxOpsPerTx: number;
}

export interface ValidationContext {
  /** Sponsor (payer) address. */
  sponsor: string;
  chainId: string;
  contracts: ProtocolContracts;
  allowlist: Allowlist;
  limits: ValidationLimits;
  /**
   * Resolves the current owner key of an identity (`identity.get_identity(account).owner`).
   * Consulted only when neither the actor nor the device equals the payee, so that a
   * recovered identity (owner != account, spec section 3.3) can still be sponsored.
   * Undefined = no lookup (strict actor/device == payee).
   */
  ownerOf?: ((account: string) => Promise<string | undefined>) | undefined;
}

export interface ValidatedOperation {
  index: number;
  contract: string;
  method: string;
  entryPoint: number;
  contractId: string;
  argsBytes: number;
  /** Address the operation acts for (payee, or the device signing for it). */
  actor: string | undefined;
  operation: CallContractOperationJson;
}

export interface ValidatedTransaction {
  transaction: TransactionJson;
  payee: string;
  operations: ValidatedOperation[];
  /** Addresses recovered from the user signatures (payee included). */
  signers: string[];
}

/** Maximum signatures accepted on a submitted transaction (payee + a few extras). */
export const MAX_SIGNATURES = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Decodes koilib base64url, refusing anything that is not valid base64url text. */
function argsLength(args: unknown, index: number): number {
  if (args === undefined || args === null || args === "") return 0;
  if (typeof args !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(args)) {
    throw new SponsorRefusal("invalid_transaction", `operation ${index}: args must be base64url text`);
  }
  try {
    return utils.decodeBase64url(args).length;
  } catch {
    throw new SponsorRefusal("invalid_transaction", `operation ${index}: args must be base64url text`);
  }
}

/** An actor that is neither the payee nor a signing device: accepted only if the payee owns it. */
interface PendingOwnerCheck {
  index: number;
  contract: string;
  method: string;
  field: string;
  account: string;
}

interface InspectedOperations {
  operations: ValidatedOperation[];
  /** Owner lookups still to run (after the signature check, so unsigned input costs no RPC). */
  pending: PendingOwnerCheck[];
}

function actorMismatch(check: PendingOwnerCheck, payee: string, device: string | undefined): SponsorRefusal {
  return new SponsorRefusal(
    "invalid_transaction",
    `operation ${check.index}: ${check.contract}.${check.method}.${check.field} (${check.account}) must equal the payee ${payee}${device ? " (or the device must)" : " (or the payee must be its current owner)"}`,
  );
}

/**
 * Synchronous part of operation validation: shape, allowlist, byte ceiling, decoding and the
 * actor binding that can be decided without the chain (actor or signing device == payee).
 * Actors that need an owner lookup are returned in `pending`; nothing here touches the network.
 */
function inspectOperations(operations: unknown, payee: string, ctx: ValidationContext): InspectedOperations {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new SponsorRefusal("invalid_transaction", "transaction must contain at least one operation");
  }
  if (operations.length > ctx.limits.maxOpsPerTx) {
    throw new SponsorRefusal("too_large", `at most ${ctx.limits.maxOpsPerTx} operations per transaction (got ${operations.length})`);
  }
  const out: ValidatedOperation[] = [];
  const pending: PendingOwnerCheck[] = [];
  for (let index = 0; index < operations.length; index += 1) {
    const raw: unknown = operations[index];
    if (!isRecord(raw)) throw new SponsorRefusal("invalid_transaction", `operation ${index}: not an object`);
    const keys = Object.keys(raw);
    if (keys.length !== 1 || keys[0] !== "call_contract" || !isRecord(raw.call_contract)) {
      throw new SponsorRefusal("method_not_allowed", `operation ${index}: only call_contract operations are sponsored`);
    }
    const call = raw.call_contract;
    if (!isAddress(call.contract_id)) throw new SponsorRefusal("invalid_transaction", `operation ${index}: contract_id is not an address`);
    if (typeof call.entry_point !== "number" || !Number.isInteger(call.entry_point) || call.entry_point < 0) {
      throw new SponsorRefusal("invalid_transaction", `operation ${index}: entry_point must be an unsigned integer`);
    }
    const allowed = ctx.allowlist.lookup(call.contract_id, call.entry_point);
    if (!allowed) {
      throw new SponsorRefusal("method_not_allowed", `operation ${index}: ${call.contract_id} entry point ${call.entry_point} is not sponsored`);
    }
    const bytes = argsLength(call.args, index);
    if (bytes > ctx.limits.maxBytesPerOp) {
      throw new SponsorRefusal("too_large", `operation ${index}: ${allowed.contract}.${allowed.method} args are ${bytes} bytes (limit ${ctx.limits.maxBytesPerOp})`);
    }
    const operation: CallContractOperationJson = { contract_id: call.contract_id, entry_point: call.entry_point, args: typeof call.args === "string" ? call.args : "" };
    const decoded = ctx.contracts.decodeOperation({ call_contract: operation });
    if (!decoded) throw new SponsorRefusal("invalid_transaction", `operation ${index}: ${allowed.contract}.${allowed.method} arguments do not decode`);
    if (decoded.method !== allowed.method || decoded.contract !== allowed.contract) {
      throw new SponsorRefusal("method_not_allowed", `operation ${index}: entry point resolves to ${decoded.contract}.${decoded.method}`);
    }
    const args = decoded.args as Record<string, unknown>;
    const field = actorField(decoded.contract, decoded.method, args);
    let actor: string | undefined;
    if (field !== null) {
      const value = args[field];
      // `device` is a signing authority only where the proto says so; for authorize_device /
      // revoke_device it is the key being (de)authorised and the owner must sign.
      const device = deviceMaySign(decoded.contract, decoded.method) && typeof args.device === "string" && args.device.length > 0 ? args.device : undefined;
      if (typeof value !== "string" || value.length === 0) {
        throw new SponsorRefusal("invalid_transaction", `operation ${index}: ${decoded.contract}.${decoded.method}.${field} is required`);
      }
      const check: PendingOwnerCheck = { index, contract: decoded.contract, method: decoded.method, field, account: value };
      if (value === payee) actor = value;
      else if (device === payee) actor = device;
      else if (!device && ctx.ownerOf) pending.push(check);
      else throw actorMismatch(check, payee, device);
    }
    out.push({
      index,
      contract: decoded.contract,
      method: decoded.method,
      entryPoint: decoded.entryPoint,
      contractId: call.contract_id,
      argsBytes: bytes,
      actor,
      operation,
    });
  }
  return { operations: out, pending };
}

/**
 * Runs the deferred owner lookups (`identity.get_identity(account).owner`, once per account)
 * and binds the actor of each pending operation, or refuses. An RPC failure is
 * `temporarily_unavailable`, never a silent refusal.
 */
async function resolveOwners(inspected: InspectedOperations, payee: string, ctx: ValidationContext): Promise<void> {
  const owners = new Map<string, string | undefined>();
  for (const check of inspected.pending) {
    if (!owners.has(check.account)) {
      try {
        owners.set(check.account, ctx.ownerOf ? await ctx.ownerOf(check.account) : undefined);
      } catch (error) {
        throw new SponsorRefusal("temporarily_unavailable", `cannot resolve the owner of ${check.account}: ${(error as Error).message}`);
      }
    }
    if (owners.get(check.account) !== payee) throw actorMismatch(check, payee, undefined);
    const operation = inspected.operations[check.index];
    if (operation) operation.actor = check.account;
  }
}

/**
 * Validates operations for `payee`: shape, allowlist, byte ceiling and actor binding.
 * Shared by `/v1/prepare` and `/v1/sponsor`. Only the optional owner lookup is async.
 */
export async function validateOperations(operations: unknown, payee: string, ctx: ValidationContext): Promise<ValidatedOperation[]> {
  const inspected = inspectOperations(operations, payee, ctx);
  await resolveOwners(inspected, payee, ctx);
  return inspected.operations;
}

function parseRcLimit(value: unknown): bigint {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new SponsorRefusal("invalid_transaction", "header.rc_limit must be an unsigned integer");
}

/**
 * Validates a payee-signed transaction end to end (spec section 10):
 * chain id, payer/payee, operation count, RC ceiling, allowlist, byte ceiling, actor binding,
 * header/id/merkle-root consistency and a signature recovering to the payee.
 *
 * Everything that needs the chain (owner lookups for recovered identities) runs last, after
 * the signatures have been verified: an unsigned or forged request never costs an RPC call.
 */
export async function validateTransaction(input: unknown, ctx: ValidationContext): Promise<ValidatedTransaction> {
  if (!isRecord(input)) throw new SponsorRefusal("invalid_transaction", "transaction must be an object");
  const header = input.header;
  if (!isRecord(header)) throw new SponsorRefusal("invalid_transaction", "transaction.header is required");

  if (header.chain_id !== ctx.chainId) {
    throw new SponsorRefusal("chain_mismatch", `transaction is for chain ${String(header.chain_id ?? "(none)")}; this sponsor serves ${ctx.chainId}`);
  }
  if (header.payer !== ctx.sponsor) {
    throw new SponsorRefusal("invalid_transaction", `header.payer must be the sponsor ${ctx.sponsor}`);
  }
  if (!isAddress(header.payee)) throw new SponsorRefusal("invalid_transaction", "header.payee must be the user's address");
  const payee = header.payee;
  if (payee === ctx.sponsor) throw new SponsorRefusal("invalid_transaction", "header.payee must not be the sponsor");
  if (typeof header.nonce !== "string" || header.nonce.length === 0) {
    throw new SponsorRefusal("invalid_transaction", "header.nonce is required");
  }
  if (typeof header.operation_merkle_root !== "string" || header.operation_merkle_root.length === 0) {
    throw new SponsorRefusal("invalid_transaction", "header.operation_merkle_root is required");
  }

  const inspected = inspectOperations(input.operations, payee, ctx);
  const { operations } = inspected;

  const rcLimit = parseRcLimit(header.rc_limit);
  const rcCeiling = BigInt(ctx.limits.maxRcPerOp) * BigInt(operations.length);
  if (rcLimit > rcCeiling) {
    throw new SponsorRefusal("too_large", `rc_limit ${rcLimit} exceeds ${ctx.limits.maxRcPerOp} x ${operations.length} operations`);
  }

  // Recompute the merkle root and id from what was submitted: a header that does not match its
  // operations, or an id that does not match its header, cannot carry a valid user signature.
  const cleanHeader = {
    chain_id: header.chain_id,
    rc_limit: header.rc_limit as string | number,
    nonce: header.nonce,
    operation_merkle_root: header.operation_merkle_root,
    payer: header.payer,
    payee,
  };
  let recomputed: TransactionJson;
  try {
    recomputed = await Transaction.prepareTransaction(
      { header: { ...cleanHeader }, operations: operations.map((op): OperationJson => ({ call_contract: { ...op.operation } })) },
      undefined,
      ctx.sponsor,
    );
  } catch (error) {
    throw new SponsorRefusal("invalid_transaction", `transaction cannot be encoded: ${(error as Error).message}`);
  }
  if (recomputed.header?.operation_merkle_root !== header.operation_merkle_root) {
    throw new SponsorRefusal("invalid_signature", "header.operation_merkle_root does not match the operations");
  }
  let expectedId: string;
  try {
    expectedId = Transaction.computeTransactionId(cleanHeader);
  } catch (error) {
    throw new SponsorRefusal("invalid_transaction", `transaction header cannot be encoded: ${(error as Error).message}`);
  }
  if (input.id !== expectedId) {
    throw new SponsorRefusal("invalid_signature", "transaction id does not match its header");
  }

  const signatures = input.signatures;
  if (!Array.isArray(signatures) || signatures.length === 0 || !signatures.every((s) => typeof s === "string" && s.length > 0)) {
    throw new SponsorRefusal("invalid_signature", "transaction carries no user signature");
  }
  if (signatures.length > MAX_SIGNATURES) {
    throw new SponsorRefusal("invalid_transaction", `at most ${MAX_SIGNATURES} signatures are accepted`);
  }
  const transaction: TransactionJson = {
    id: expectedId,
    header: cleanHeader,
    operations: operations.map((op): OperationJson => ({ call_contract: { ...op.operation } })),
    signatures: [...(signatures as string[])],
  };
  let signers: string[];
  try {
    signers = await Signer.recoverAddresses(transaction);
  } catch (error) {
    throw new SponsorRefusal("invalid_signature", `signature cannot be recovered: ${(error as Error).message}`);
  }
  if (!signers.includes(payee)) {
    throw new SponsorRefusal("invalid_signature", `no signature recovers to the payee ${payee}`);
  }
  if (signers.includes(ctx.sponsor)) {
    throw new SponsorRefusal("invalid_transaction", "transaction already carries the sponsor signature");
  }

  // Only now, with a payee signature in hand, consult the chain for recovered identities.
  await resolveOwners(inspected, payee, ctx);
  return { transaction, payee, operations, signers };
}
