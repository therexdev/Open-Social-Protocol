/**
 * Sponsor HTTP service (docs/sponsor-api.md): discovery, prepare, sponsor, utilization.
 *
 * `SponsorService` holds the policy, validation context, quota store and RPC provider;
 * `createServer` wraps it in Fastify. Both are fully injectable so tests run offline with a
 * fake provider and a synthetic deployment.
 */
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import {
  Provider,
  ProtocolClient,
  contractAddresses,
  isAddress,
  signSponsorDiscovery,
  type Deployment,
  type OperationJson,
  type ProviderInterface,
  type Signer,
  type SponsorDiscovery,
  type SponsorErrorCategory,
  type TransactionJson,
  type TransactionReceipt,
} from "@osp/sdk";
import { SPONSOR_VERSION, type SponsorConfig } from "./config.js";
import { buildAllowlist, discoveryPolicy, type Allowlist, type PolicyLimits } from "./policy.js";
import { QuotaStore, type UtilizationReport } from "./quota.js";
import { SponsorRefusal, validateOperations, validateTransaction, type ValidationContext } from "./validate.js";

export type ServiceState = "serving" | "not_deployed" | "invalid_deployment" | "no_key";

export interface SponsorServiceOptions {
  config: SponsorConfig;
  /** Parsed manifest; undefined when `deployments/<network>.json` does not exist yet. */
  deployment?: Deployment | undefined;
  /** Where the manifest was looked for (reported by /healthz). */
  deploymentPath?: string | undefined;
  /** Manifest parse error, if any. */
  deploymentError?: string | undefined;
  /** Sponsor (payer) key; undefined when `OSP_SPONSOR_WIF` is not set. */
  signer?: Signer | undefined;
  /** RPC provider; defaults to koilib `Provider(deployment.rpc)`. */
  provider?: ProviderInterface | undefined;
  /** Quota store; defaults to the SQLite file from the config. */
  quota?: QuotaStore | undefined;
  now?: (() => number) | undefined;
}

export interface StatusReport {
  ok: boolean;
  state: ServiceState;
  message: string;
  version: string;
  network: string;
  sponsor: string | null;
  chainId: string | null;
  rpc: string[];
  deploymentPath: string | null;
  endpoint: string;
  policy: PolicyLimits;
  allowed: string[];
}

export interface SponsorResponse {
  transaction: TransactionJson;
  receipt: TransactionReceipt;
}

function stateMessage(state: ServiceState, options: SponsorServiceOptions): string {
  switch (state) {
    case "serving":
      return "serving";
    case "not_deployed":
      return `not deployed: no deployment manifest for network "${options.config.network}"${options.deploymentPath ? ` at ${options.deploymentPath}` : ""} (run the deploy-testnet workflow or npm run deploy:testnet)`;
    case "invalid_deployment":
      return `invalid deployment manifest${options.deploymentPath ? ` at ${options.deploymentPath}` : ""}: ${options.deploymentError ?? "unknown error"}`;
    case "no_key":
      return "no sponsor key: set OSP_SPONSOR_WIF to the payer's private key";
  }
}

/** Turns a koilib provider failure into a refusal: chain rejections are 400, transport failures 503. */
export function classifySendError(error: unknown): SponsorRefusal {
  const message = error instanceof Error ? error.message : String(error);
  let parsed: Record<string, unknown> | undefined;
  try {
    const value: unknown = JSON.parse(message);
    if (value && typeof value === "object") parsed = value as Record<string, unknown>;
  } catch {
    parsed = undefined;
  }
  const logs = Array.isArray(parsed?.logs) ? (parsed.logs as unknown[]).map(String) : undefined;
  const text = typeof parsed?.error === "string" ? parsed.error : message;
  const rejected = logs !== undefined || /revert|nonce|authoriz|signature|rc_limit|rc limit|resource|mana|merkle|chain.?id|duplicate|already|invalid|failed to apply/i.test(text);
  if (rejected) {
    return new SponsorRefusal("invalid_transaction", `chain rejected the transaction: ${text}`, logs ? { logs } : undefined);
  }
  return new SponsorRefusal("temporarily_unavailable", `rpc failure: ${text}`);
}

function stripWait(tx: TransactionJson): TransactionJson {
  return {
    ...(tx.id !== undefined && { id: tx.id }),
    ...(tx.header !== undefined && { header: tx.header }),
    ...(tx.operations !== undefined && { operations: tx.operations }),
    ...(tx.signatures !== undefined && { signatures: tx.signatures }),
  };
}

export class SponsorService {
  readonly config: SponsorConfig;
  readonly state: ServiceState;
  readonly deployment: Deployment | undefined;
  readonly signer: Signer | undefined;
  readonly sponsor: string | undefined;
  readonly provider: ProviderInterface | undefined;
  readonly client: ProtocolClient | undefined;
  readonly allowlist: Allowlist | undefined;
  readonly limits: PolicyLimits;
  readonly quota: QuotaStore;
  private readonly options: SponsorServiceOptions;
  private readonly now: () => number;
  private discoveryDoc: Promise<SponsorDiscovery> | undefined;

  constructor(options: SponsorServiceOptions) {
    this.options = options;
    this.config = options.config;
    this.now = options.now ?? Date.now;
    const c = options.config;
    this.limits = {
      version: c.policyVersion,
      maxBytesPerOp: c.maxBytesPerOp,
      maxRcPerOp: c.maxRcPerOp,
      maxOpsPerTx: c.maxOpsPerTx,
      dailyOps: c.dailyOps,
      burstOps: c.burstOps,
      burstWindowSec: c.burstWindowSec,
    };
    this.quota =
      options.quota ??
      new QuotaStore({ path: c.dbPath, limits: { dailyOps: c.dailyOps, burstOps: c.burstOps, burstWindowSec: c.burstWindowSec }, now: this.now });
    this.deployment = options.deployment;
    this.signer = options.signer;
    this.sponsor = options.signer?.getAddress();
    if (!options.deployment) {
      this.state = options.deploymentError ? "invalid_deployment" : "not_deployed";
    } else if (!options.signer) {
      this.state = "no_key";
    } else {
      this.state = "serving";
    }
    if (options.deployment) {
      // The allowlist only needs the deployment; build it even without a key so /healthz can show it.
      this.allowlist = buildAllowlist(options.deployment, c.allowlist);
      this.provider = options.provider ?? new Provider(options.deployment.rpc);
      this.client = new ProtocolClient({ rpc: this.provider, deployment: options.deployment });
    }
  }

  /** Throws `temporarily_unavailable` unless the service has a deployment and a key. */
  private serving(): { deployment: Deployment; signer: Signer; sponsor: string; provider: ProviderInterface; client: ProtocolClient; allowlist: Allowlist } {
    if (this.state !== "serving" || !this.deployment || !this.signer || !this.sponsor || !this.provider || !this.client || !this.allowlist) {
      throw new SponsorRefusal("temporarily_unavailable", stateMessage(this.state, this.options));
    }
    return { deployment: this.deployment, signer: this.signer, sponsor: this.sponsor, provider: this.provider, client: this.client, allowlist: this.allowlist };
  }

  private context(): ValidationContext {
    const { deployment, sponsor, client, allowlist } = this.serving();
    return {
      sponsor,
      chainId: deployment.chainId,
      contracts: client.contracts,
      allowlist,
      limits: { maxBytesPerOp: this.limits.maxBytesPerOp, maxRcPerOp: this.limits.maxRcPerOp, maxOpsPerTx: this.limits.maxOpsPerTx },
    };
  }

  private refuse(error: unknown): never {
    if (error instanceof SponsorRefusal) {
      this.quota.recordRefusal(error.category, this.now());
      throw error;
    }
    throw error;
  }

  status(): StatusReport {
    return {
      ok: this.state === "serving",
      state: this.state,
      message: stateMessage(this.state, this.options),
      version: SPONSOR_VERSION,
      network: this.config.network,
      sponsor: this.sponsor ?? null,
      chainId: this.deployment?.chainId ?? null,
      rpc: this.deployment?.rpc ?? this.config.rpc ?? [],
      deploymentPath: this.options.deploymentPath ?? null,
      endpoint: this.config.publicUrl,
      policy: this.limits,
      allowed: this.allowlist?.describe() ?? [],
    };
  }

  /** Signed discovery document (cached for the life of the process). */
  discovery(): Promise<SponsorDiscovery> {
    const { deployment, signer, sponsor, allowlist } = this.serving();
    if (!this.discoveryDoc) {
      this.discoveryDoc = signSponsorDiscovery(
        {
          version: 1,
          sponsor,
          network: { name: deployment.network, chainId: deployment.chainId, rpc: deployment.rpc },
          policy: discoveryPolicy(allowlist, this.limits),
          endpoint: this.config.publicUrl,
          protocolVersion: deployment.protocolVersion,
          contracts: contractAddresses(deployment),
          service: { name: "@osp/sponsor", version: SPONSOR_VERSION },
        },
        signer,
      );
    }
    return this.discoveryDoc;
  }

  /** `POST /v1/prepare`: an unsigned transaction with payer = sponsor and the payee's next nonce. */
  async prepare(payee: unknown, operations: unknown): Promise<TransactionJson> {
    const { sponsor, provider, client } = this.serving();
    try {
      if (!isAddress(payee)) throw new SponsorRefusal("invalid_transaction", "payee must be a Base58 address");
      if (payee === sponsor) throw new SponsorRefusal("invalid_transaction", "payee must not be the sponsor");
      const validated = validateOperations(operations, payee, this.context());
      let rcLimit = BigInt(this.limits.maxRcPerOp) * BigInt(validated.length);
      let available: bigint;
      try {
        available = BigInt(await provider.getAccountRc(sponsor));
      } catch (error) {
        throw new SponsorRefusal("temporarily_unavailable", `rpc failure while reading sponsor RC: ${(error as Error).message}`);
      }
      if (available < rcLimit) rcLimit = available;
      try {
        const ops: OperationJson[] = validated.map((op) => ({ call_contract: { ...op.operation } }));
        return stripWait(await client.prepare(ops, { payee, payer: sponsor, rcLimit: rcLimit.toString() }));
      } catch (error) {
        throw new SponsorRefusal("temporarily_unavailable", `rpc failure while preparing the transaction: ${(error as Error).message}`);
      }
    } catch (error) {
      this.refuse(error);
    }
  }

  /** `POST /v1/sponsor`: validate, quota-check, co-sign, broadcast, record. */
  async sponsor(input: unknown): Promise<SponsorResponse> {
    const { signer, provider } = this.serving();
    const at = this.now();
    let validated;
    try {
      validated = await validateTransaction(input, this.context());
    } catch (error) {
      this.refuse(error);
    }
    const { payee, operations, transaction } = validated;
    const decision = this.quota.check(payee, operations.length, at);
    if (!decision.ok) {
      this.refuse(new SponsorRefusal("quota_exceeded", decision.message, { retryAfterSec: decision.retryAfterSec }));
    }
    // Never touch operations after the user signature: only append the sponsor signature.
    const signed = await signer.signTransaction({ ...transaction, signatures: [...(transaction.signatures ?? [])] });
    let sent: { transaction: TransactionJson; receipt: TransactionReceipt };
    try {
      sent = await provider.sendTransaction(signed, true);
    } catch (error) {
      this.refuse(classifySendError(error));
    }
    const receipt = sent.receipt;
    const rpcError = (receipt as { rpc_error?: unknown }).rpc_error;
    const reverted = Boolean(receipt.reverted);
    this.quota.recordAccepted(payee, { ops: operations.length, rcUsed: receipt.rc_used, reverted }, at);
    if (rpcError !== undefined) {
      throw new SponsorRefusal("temporarily_unavailable", `broadcast outcome unknown: ${JSON.stringify(rpcError)}`);
    }
    if (reverted) {
      const logs = (receipt.logs ?? []).map(String);
      throw new SponsorRefusal("invalid_transaction", `transaction reverted${logs.length ? `: ${logs.join("; ")}` : ""}`, { logs, receipt });
    }
    return { transaction: stripWait(sent.transaction), receipt };
  }

  utilization(): UtilizationReport {
    return this.quota.utilization(this.now());
  }

  close(): void {
    this.quota.close();
  }
}

export interface ServerOptions extends SponsorServiceOptions {
  logger?: FastifyServerOptions["logger"];
  /** Request body limit in bytes (default 256 KiB). */
  bodyLimit?: number;
}

function categoryFor(status: number): SponsorErrorCategory {
  if (status === 413) return "too_large";
  if (status === 429) return "quota_exceeded";
  if (status >= 500) return "temporarily_unavailable";
  return "invalid_transaction";
}

/** Builds the Fastify app; `app.sponsorService` exposes the service for tests and main. */
export async function createServer(options: ServerOptions): Promise<FastifyInstance & { sponsorService: SponsorService }> {
  const service = new SponsorService(options);
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: options.bodyLimit ?? 256 * 1024 });
  await app.register(cors, { origin: "*", methods: ["GET", "POST", "OPTIONS"] });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SponsorRefusal) {
      const { logs, retryAfterSec, receipt, ...rest } = error.details ?? {};
      if (typeof retryAfterSec === "number") void reply.header("retry-after", String(retryAfterSec));
      void reply.status(error.status).send({
        error: { category: error.category, message: error.message, ...(logs !== undefined && { logs }), ...(retryAfterSec !== undefined && { retryAfterSec }), ...rest },
        ...(receipt !== undefined && { receipt }),
      });
      return;
    }
    const status = typeof error.statusCode === "number" && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) app.log.error(error);
    void reply.status(status).send({ error: { category: categoryFor(status), message: status >= 500 ? "internal error" : error.message } });
  });
  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({ error: { category: "invalid_transaction", message: `no route for ${request.method} ${request.url}` } });
  });

  app.get("/healthz", async (_request, reply) => {
    const status = service.status();
    return reply.status(status.ok ? 200 : 503).send(status);
  });

  app.get("/.well-known/osp-sponsor.json", async (_request, reply) => {
    const doc = await service.discovery();
    return reply.header("cache-control", "public, max-age=300").send(doc);
  });

  app.post("/v1/prepare", async (request) => {
    const body = (request.body ?? {}) as { payee?: unknown; operations?: unknown };
    const transaction = await service.prepare(body.payee, body.operations);
    return { transaction };
  });

  app.post("/v1/sponsor", async (request) => {
    const body = (request.body ?? {}) as { transaction?: unknown };
    return service.sponsor(body.transaction);
  });

  app.get("/v1/utilization", async () => service.utilization());

  app.addHook("onClose", async () => service.close());
  return Object.assign(app, { sponsorService: service });
}
