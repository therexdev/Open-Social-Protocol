/**
 * ProtocolClient: RPC provider, contracts, transaction preparation, signing, simulation and
 * submission with sponsor co-signing and self-pay fallback (spec section 10).
 */
import { Provider, Transaction } from "koilib";
import type { OperationJson, ProviderInterface, SignerInterface, TransactionJson, TransactionReceipt } from "koilib";
import { chainIdToBytes } from "../ids.js";
import { decodeReceiptEvents, type DecodedEvent } from "../events.js";
import { SponsorClient, SponsorError, SponsorPool, verifySponsorResult, type SponsorDiscovery, type SponsorRefusal } from "../sponsor.js";
import type { ProtoObject } from "../encoding.js";
import type { ContractName } from "../constants.js";
import { ProtocolContracts } from "./contracts.js";
import type { Deployment } from "./deployments.js";
import type { ContractReadMethods } from "./types.js";

export interface ProtocolClientOptions {
  /** RPC URLs (failover in order) or a koilib ProviderInterface (fakes in tests). */
  rpc?: string[] | ProviderInterface;
  deployment: Deployment;
  /** Overrides `deployment.chainId`. */
  chainId?: string;
  /** Default sponsors for `submit` when none is passed explicitly. */
  sponsors?: SponsorPool | SponsorClient | Array<SponsorClient | string>;
}

export interface PrepareOptions {
  /** The user; its nonce is used. */
  payee: string;
  /** Sponsor address; defaults to the payee (self-pay). */
  payer?: string;
  /** Overrides the RC limit (defaults to the payer's available RC, koilib semantics). */
  rcLimit?: string | number;
  /** Overrides the nonce (base64url `koinos.chain.value_type`). */
  nonce?: string;
}

export interface SimulateResult {
  receipt: TransactionReceipt;
  rcUsed: string;
  events: DecodedEvent[];
  logs: string[];
  reverted: boolean;
}

export interface SubmitOptions {
  operations: OperationJson[];
  signer: SignerInterface;
  /** Sponsor(s) to try; `null` forces self-pay; undefined uses the client default. */
  sponsor?: SponsorPool | SponsorClient | null;
  /** Fall back to self-pay when every sponsor refuses (default true). */
  selfPayFallback?: boolean;
  /** Wait for block inclusion and report the block (default false). */
  waitForReceipt?: boolean;
  /** Timeout for the wait (ms). */
  waitTimeoutMs?: number;
  /**
   * RC limit override. Sponsored transactions default to `policy.maxRcPerOp * operations.length`
   * from the sponsor's signed discovery document (spec section 10.2); self-pay defaults to the
   * user's available RC.
   */
  rcLimit?: string | number;
}

export interface SubmitResult {
  transaction: TransactionJson;
  receipt: TransactionReceipt;
  events: DecodedEvent[];
  rcUsed: string;
  sponsored: boolean;
  /** Sponsor address when sponsored. */
  sponsor?: string;
  /** Sponsor refusals encountered before the successful path. */
  refusals: SponsorRefusal[];
  block?: { blockId: string; blockNumber?: number };
}

export class ProtocolClientError extends Error {
  override name = "ProtocolClientError";
}

/**
 * The node did not answer in time (koilib returns a synthetic receipt carrying `rpc_error`):
 * the transaction may or may not have been accepted. Spec section 7: move the cross-post
 * record to `unknown` (`koinosUnknown`) and look the post up before any retry.
 */
export class TransactionOutcomeUnknownError extends ProtocolClientError {
  override name = "TransactionOutcomeUnknownError";
  readonly transaction: TransactionJson;
  readonly receipt: TransactionReceipt;
  readonly rpcError: unknown;

  constructor(transaction: TransactionJson, receipt: TransactionReceipt) {
    super(`transaction outcome unknown: ${safeJson(receipt.rpc_error)}`);
    this.transaction = transaction;
    this.receipt = receipt;
    this.rpcError = receipt.rpc_error;
  }
}

/** The node applied the transaction and it reverted; nothing was recorded (`koinosFailed`). */
export class TransactionRevertedError extends ProtocolClientError {
  override name = "TransactionRevertedError";
  readonly transaction: TransactionJson;
  readonly receipt: TransactionReceipt;
  readonly logs: string[];

  constructor(transaction: TransactionJson, receipt: TransactionReceipt) {
    const logs = receipt.logs ?? [];
    super(`transaction reverted${logs.length > 0 ? `: ${logs.join("; ")}` : ""}`);
    this.transaction = transaction;
    this.receipt = receipt;
    this.logs = logs;
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Throws `TransactionOutcomeUnknownError` for koilib's synthetic timeout receipts. */
export function assertReceiptKnown(transaction: TransactionJson, receipt: TransactionReceipt): void {
  if (receipt.rpc_error !== undefined && receipt.rpc_error !== null) throw new TransactionOutcomeUnknownError(transaction, receipt);
}

/** Throws `TransactionRevertedError` when the receipt reports a revert. */
export function assertNotReverted(transaction: TransactionJson, receipt: TransactionReceipt): void {
  if (receipt.reverted) throw new TransactionRevertedError(transaction, receipt);
}

/**
 * `policy.maxRcPerOp * operationCount` from a sponsor discovery document (spec section 10.2),
 * or undefined when the policy carries no usable ceiling.
 */
export function sponsoredRcLimit(discovery: Pick<SponsorDiscovery, "policy">, operationCount: number): string | undefined {
  const raw = discovery.policy?.maxRcPerOp;
  if (raw === undefined || raw === null || !Number.isInteger(operationCount) || operationCount < 1) return undefined;
  try {
    const perOp = BigInt(raw as string | number | bigint);
    if (perOp <= 0n) return undefined;
    return (perOp * BigInt(operationCount)).toString();
  } catch {
    return undefined;
  }
}

export class ProtocolClient {
  readonly provider: ProviderInterface;
  readonly deployment: Deployment;
  readonly chainId: string;
  readonly contracts: ProtocolContracts;
  readonly sponsors: SponsorPool;

  constructor(options: ProtocolClientOptions) {
    this.deployment = options.deployment;
    this.chainId = options.chainId ?? options.deployment.chainId;
    const rpc = options.rpc ?? options.deployment.rpc;
    this.provider = Array.isArray(rpc) ? new Provider(rpc) : rpc;
    this.contracts = new ProtocolContracts(options.deployment, this.provider);
    const sponsors = options.sponsors ?? options.deployment.sponsors ?? [];
    this.sponsors =
      sponsors instanceof SponsorPool
        ? sponsors
        : new SponsorPool(sponsors instanceof SponsorClient ? [sponsors] : sponsors, { expectedChainId: this.chainId });
  }

  /** Raw chain id bytes for post ids and AADs. */
  get chainIdBytes(): Uint8Array {
    return chainIdToBytes(this.chainId);
  }

  /** Typed operation builders (`client.ops.publications.publish(...)`). */
  get ops(): ProtocolContracts["ops"] {
    return this.contracts.ops;
  }

  /** Typed read-only calls (`client.reads.identity.get_identity(...)`). */
  get reads(): ProtocolContracts["reads"] {
    return this.contracts.reads;
  }

  /** Untyped read-only call. */
  read<C extends ContractName, M extends keyof ContractReadMethods[C] & string>(
    contract: C,
    method: M,
    args?: ContractReadMethods[C][M] extends [infer A, unknown] ? A : never,
  ): Promise<(ContractReadMethods[C][M] extends [unknown, infer R] ? R : never) | undefined>;
  read<T = ProtoObject>(contract: ContractName, method: string, args?: ProtoObject): Promise<T | undefined>;
  read(contract: ContractName, method: string, args: ProtoObject = {}): Promise<unknown> {
    return this.contracts.read(contract, method, args);
  }

  /** Checks that the RPC node serves the expected chain. */
  async verifyChainId(): Promise<{ ok: boolean; actual: string }> {
    const actual = await this.provider.getChainId();
    return { ok: actual === this.chainId, actual };
  }

  /**
   * Builds an unsigned transaction: `header.payee` = user (nonce source), `header.payer` =
   * sponsor or the user, `rc_limit` from the payer, chain id from the deployment.
   */
  async prepare(operations: OperationJson[], options: PrepareOptions): Promise<TransactionJson> {
    if (operations.length === 0) throw new ProtocolClientError("no operations");
    const payer = options.payer ?? options.payee;
    const sponsored = payer !== options.payee;
    const header: NonNullable<TransactionJson["header"]> = {
      chain_id: this.chainId,
      payer,
      ...(sponsored && { payee: options.payee }),
      ...(options.rcLimit !== undefined && { rc_limit: options.rcLimit }),
      ...(options.nonce !== undefined && { nonce: options.nonce }),
    };
    return Transaction.prepareTransaction({ header, operations: [...operations] }, this.provider, payer);
  }

  /** Appends the signer's signature (the transaction must be prepared). */
  async sign(transaction: TransactionJson, signer: SignerInterface): Promise<TransactionJson> {
    if (!transaction.id) throw new ProtocolClientError("transaction is not prepared");
    return signer.signTransaction(transaction);
  }

  /**
   * Applies the transaction without broadcasting (`broadcast: false`) and reports RC usage.
   * Throws `TransactionOutcomeUnknownError` when the node timed out; a revert is reported in
   * `reverted`/`logs` (that is what a simulation is for).
   */
  async simulate(transaction: TransactionJson): Promise<SimulateResult> {
    const { receipt } = await this.provider.sendTransaction(transaction, false);
    assertReceiptKnown(transaction, receipt);
    return {
      receipt,
      rcUsed: receipt.rc_used ?? "0",
      events: decodeReceiptEvents(receipt, this.deployment),
      logs: receipt.logs ?? [],
      reverted: Boolean(receipt.reverted),
    };
  }

  /**
   * Broadcasts a fully signed transaction (self-pay or already co-signed). Throws
   * `TransactionOutcomeUnknownError` (node timeout: outcome unknown, look the post up before any
   * retry) or `TransactionRevertedError` (applied and reverted) instead of returning such receipts.
   */
  async broadcast(transaction: TransactionJson): Promise<{ transaction: TransactionJson; receipt: TransactionReceipt }> {
    const { transaction: sent, receipt } = await this.provider.sendTransaction(transaction, true);
    assertReceiptKnown(sent, receipt);
    assertNotReverted(sent, receipt);
    return { transaction: sent, receipt };
  }

  /**
   * Prepares, signs and submits operations. With sponsors: prepare with `payer = sponsor` and
   * `rc_limit = policy.maxRcPerOp * operations.length`, sign as payee, `POST /v1/sponsor`, verify
   * that the sponsor returned exactly the signed transaction (plus its signature) and a receipt
   * for it; on refusal try the next sponsor, then self-pay. Throws
   * `TransactionOutcomeUnknownError` (timeout; map to the `koinosUnknown` reconcile event and
   * look up before retrying) or `TransactionRevertedError` (map to `koinosFailed`).
   */
  async submit(options: SubmitOptions): Promise<SubmitResult> {
    const payee = options.signer.getAddress();
    const pool =
      options.sponsor === null
        ? new SponsorPool([])
        : options.sponsor instanceof SponsorClient
          ? new SponsorPool([options.sponsor])
          : (options.sponsor ?? this.sponsors);
    const selfPayFallback = options.selfPayFallback ?? true;

    const attempt = await pool.tryEach(async (sponsor) => {
      const discovery = await sponsor.discover();
      if (discovery.network?.chainId && discovery.network.chainId !== this.chainId) {
        throw new SponsorError("chain_mismatch", `sponsor serves chain ${discovery.network.chainId}`, { endpoint: sponsor.endpoint });
      }
      const rcLimit = options.rcLimit ?? sponsoredRcLimit(discovery, options.operations.length);
      const prepared = await this.prepare(options.operations, {
        payee,
        payer: discovery.sponsor,
        ...(rcLimit !== undefined && { rcLimit }),
      });
      const signed = await this.sign(prepared, options.signer);
      const result = await sponsor.sponsor(signed);
      // Never trust the sponsor's copy: it must be the transaction the user signed (spec 1, 10.3).
      await verifySponsorResult(signed, result, sponsor.endpoint);
      return { transaction: result.transaction, receipt: result.receipt, sponsorAddress: discovery.sponsor };
    });

    let transaction: TransactionJson;
    let receipt: TransactionReceipt;
    let sponsored = false;
    let sponsorAddress: string | undefined;
    if (attempt.ok) {
      transaction = attempt.value.transaction;
      receipt = attempt.value.receipt;
      // A timeout on the sponsor's node is not a refusal: the transaction may be in flight.
      assertReceiptKnown(transaction, receipt);
      assertNotReverted(transaction, receipt);
      sponsored = true;
      sponsorAddress = attempt.value.sponsorAddress;
    } else {
      if (!selfPayFallback && pool.sponsors.length > 0) {
        const last = attempt.refusals[attempt.refusals.length - 1];
        throw last?.error ?? new ProtocolClientError("every sponsor refused");
      }
      const prepared = await this.prepare(options.operations, {
        payee,
        ...(options.rcLimit !== undefined && { rcLimit: options.rcLimit }),
      });
      const signed = await this.sign(prepared, options.signer);
      ({ transaction, receipt } = await this.broadcast(signed));
    }

    const result: SubmitResult = {
      transaction,
      receipt,
      events: decodeReceiptEvents(receipt, this.deployment),
      rcUsed: receipt.rc_used ?? "0",
      sponsored,
      ...(sponsorAddress !== undefined && { sponsor: sponsorAddress }),
      refusals: attempt.refusals,
    };
    if (options.waitForReceipt && transaction.id) {
      const waitFn = (transaction as { wait?: (type?: "byBlock" | "byTransactionId", timeout?: number) => Promise<{ blockId: string; blockNumber?: number }> }).wait;
      const block = waitFn
        ? await waitFn("byTransactionId", options.waitTimeoutMs)
        : await this.provider.wait(transaction.id, "byTransactionId", options.waitTimeoutMs);
      result.block = block;
    }
    return result;
  }
}
