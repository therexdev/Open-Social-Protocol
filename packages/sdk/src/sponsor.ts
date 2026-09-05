/**
 * Mana sponsor client (spec section 10, docs/sponsor-api.md).
 *
 * The user signs as payee, the sponsor validates and co-signs as payer, then broadcasts.
 * Refusals are typed (`SponsorError.category`) so clients can fall back to another sponsor
 * or self-pay without changing identity.
 */
import { Signer } from "koilib";
import type { OperationJson, SignerInterface, TransactionJson, TransactionReceipt } from "koilib";
import { sha256 } from "@noble/hashes/sha2.js";
import { SPONSOR_ERROR_CATEGORIES, type SponsorErrorCategory } from "./constants.js";
import { canonicalJson, fromBase64url, toBase64url, utf8 } from "./encoding.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SponsorPolicy {
  version: number;
  allowed: Array<{ contract: string; entryPoints: number[] }>;
  maxBytesPerOp: number;
  maxRcPerOp: string;
  perUser: { dailyOps: number; burstOps: number; burstWindowSec: number };
  [extra: string]: unknown;
}

/** Discovery document before signing. */
export interface UnsignedSponsorDiscovery {
  version: number;
  /** Sponsor (payer) address. */
  sponsor: string;
  network: { chainId: string; rpc: string[]; [extra: string]: unknown };
  policy: SponsorPolicy;
  [extra: string]: unknown;
}

/** `GET /.well-known/osp-sponsor.json` */
export interface SponsorDiscovery extends UnsignedSponsorDiscovery {
  /** base64url secp256k1 signature over sha256(canonical JSON without `signature`). */
  signature: string;
}

export interface SponsorResult {
  transaction: TransactionJson;
  receipt: TransactionReceipt;
}

export class SponsorError extends Error {
  override name = "SponsorError";
  readonly category: SponsorErrorCategory;
  readonly status: number | undefined;
  readonly endpoint: string | undefined;

  constructor(category: SponsorErrorCategory, message: string, options: { status?: number; endpoint?: string; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.category = category;
    this.status = options.status;
    this.endpoint = options.endpoint;
  }
}

function isCategory(value: unknown): value is SponsorErrorCategory {
  return typeof value === "string" && (SPONSOR_ERROR_CATEGORIES as readonly string[]).includes(value);
}

function categoryForStatus(status: number): SponsorErrorCategory {
  if (status === 429) return "quota_exceeded";
  if (status === 413) return "too_large";
  if (status === 403) return "method_not_allowed";
  if (status >= 500 || status === 408) return "temporarily_unavailable";
  return "invalid_transaction";
}

/** sha256 of the canonical JSON of a discovery document without its signature. */
export function sponsorDiscoveryHash(doc: UnsignedSponsorDiscovery | SponsorDiscovery): Uint8Array {
  const { signature: _signature, ...unsigned } = doc as SponsorDiscovery;
  return sha256(utf8(canonicalJson(unsigned)));
}

/** Signs a discovery document with the sponsor key (used by sponsor services). */
export async function signSponsorDiscovery(doc: UnsignedSponsorDiscovery, signer: SignerInterface): Promise<SponsorDiscovery> {
  const signature = await signer.signHash(sponsorDiscoveryHash(doc));
  return { ...doc, signature: toBase64url(signature) };
}

/** Verifies a discovery document's signature against its `sponsor` address. */
export function verifySponsorDiscovery(doc: SponsorDiscovery): { valid: boolean; signer?: string } {
  if (typeof doc.signature !== "string" || typeof doc.sponsor !== "string") return { valid: false };
  try {
    const signer = Signer.recoverAddress(sponsorDiscoveryHash(doc), fromBase64url(doc.signature));
    return { valid: signer === doc.sponsor, signer };
  } catch {
    return { valid: false };
  }
}

export interface SponsorClientOptions {
  /** Base URL, e.g. `https://sponsor.example.org`. */
  endpoint: string;
  /** Injected fetch (tests, custom transports). Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /** When set, discovery documents for a different chain are refused (`chain_mismatch`). */
  expectedChainId?: string;
  /** Per-request timeout; default 30 s. */
  timeoutMs?: number;
}

export class SponsorClient {
  readonly endpoint: string;
  private readonly fetchFn: FetchLike;
  private readonly expectedChainId: string | undefined;
  private readonly timeoutMs: number;
  private discovery: SponsorDiscovery | undefined;

  constructor(options: SponsorClientOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    const fetchFn = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchFn) throw new SponsorError("temporarily_unavailable", "no fetch implementation available", { endpoint: this.endpoint });
    this.fetchFn = fetchFn;
    this.expectedChainId = options.expectedChainId;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /** The sponsor address, once discovered. */
  get address(): string | undefined {
    return this.discovery?.sponsor;
  }

  /** The cached discovery document, if any. */
  get policy(): SponsorDiscovery | undefined {
    return this.discovery;
  }

  /** Fetches and verifies `/.well-known/osp-sponsor.json` (cached unless `force`). */
  async discover(force = false): Promise<SponsorDiscovery> {
    if (this.discovery && !force) return this.discovery;
    const doc = (await this.request("GET", "/.well-known/osp-sponsor.json")) as SponsorDiscovery;
    if (!doc || typeof doc !== "object" || typeof doc.sponsor !== "string") {
      throw new SponsorError("invalid_signature", "malformed discovery document", { endpoint: this.endpoint });
    }
    const verification = verifySponsorDiscovery(doc);
    if (!verification.valid) {
      throw new SponsorError("invalid_signature", "discovery document signature does not match the sponsor address", {
        endpoint: this.endpoint,
      });
    }
    if (this.expectedChainId && doc.network?.chainId !== this.expectedChainId) {
      throw new SponsorError("chain_mismatch", `sponsor serves chain ${String(doc.network?.chainId)}`, { endpoint: this.endpoint });
    }
    this.discovery = doc;
    return doc;
  }

  /** `POST /v1/prepare`: an unsigned transaction with the sponsor as payer and a fresh payee nonce. */
  async prepare(payee: string, operations: OperationJson[]): Promise<TransactionJson> {
    const body = (await this.request("POST", "/v1/prepare", { payee, operations })) as { transaction?: TransactionJson };
    const transaction = body?.transaction ?? (body as TransactionJson);
    if (!transaction || typeof transaction !== "object" || !transaction.header) {
      throw new SponsorError("invalid_transaction", "sponsor returned no transaction", { endpoint: this.endpoint });
    }
    return transaction;
  }

  /** `POST /v1/sponsor`: validates, co-signs and broadcasts a payee-signed transaction. */
  async sponsor(transaction: TransactionJson): Promise<SponsorResult> {
    const body = (await this.request("POST", "/v1/sponsor", { transaction })) as Partial<SponsorResult>;
    if (!body?.transaction || !body.receipt) {
      throw new SponsorError("invalid_transaction", "sponsor returned no transaction/receipt", { endpoint: this.endpoint });
    }
    return { transaction: body.transaction, receipt: body.receipt };
  }

  /** `GET /v1/utilization` (aggregate counters). */
  async utilization(): Promise<Record<string, unknown>> {
    return (await this.request("GET", "/v1/utilization")) as Record<string, unknown>;
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const url = `${this.endpoint}${path}`;
    const init: RequestInit = {
      method,
      headers: { accept: "application/json", ...(body !== undefined && { "content-type": "application/json" }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    };
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      init.signal = AbortSignal.timeout(this.timeoutMs);
    }
    let response: Response;
    try {
      response = await this.fetchFn(url, init);
    } catch (error) {
      throw new SponsorError("temporarily_unavailable", `sponsor ${this.endpoint} unreachable: ${(error as Error).message}`, {
        endpoint: this.endpoint,
        cause: error,
      });
    }
    let payload: unknown = undefined;
    const text = await response.text();
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        if (response.ok) {
          throw new SponsorError("temporarily_unavailable", "sponsor returned invalid JSON", { status: response.status, endpoint: this.endpoint });
        }
      }
    }
    const errorBody = (payload as { error?: { category?: unknown; message?: unknown } } | undefined)?.error;
    if (!response.ok || errorBody) {
      const category = isCategory(errorBody?.category) ? errorBody.category : categoryForStatus(response.status);
      const message = typeof errorBody?.message === "string" ? errorBody.message : `sponsor responded ${response.status}`;
      throw new SponsorError(category, message, { status: response.status, endpoint: this.endpoint });
    }
    return payload;
  }
}

export interface SponsorRefusal {
  endpoint: string;
  error: SponsorError;
}

export type PoolAttempt<T> =
  | { ok: true; value: T; sponsor: SponsorClient; refusals: SponsorRefusal[] }
  | { ok: false; refusals: SponsorRefusal[] };

/** An ordered list of sponsors; `tryEach` runs an attempt against each until one accepts. */
export class SponsorPool {
  readonly sponsors: SponsorClient[];

  constructor(sponsors: Array<SponsorClient | string>, options: Omit<SponsorClientOptions, "endpoint"> = {}) {
    this.sponsors = sponsors.map((s) => (typeof s === "string" ? new SponsorClient({ ...options, endpoint: s }) : s));
  }

  /**
   * Runs `attempt` against each sponsor in order. A SponsorError moves on to the next sponsor;
   * any other error propagates. `ok: false` means every sponsor refused (self-pay next).
   */
  async tryEach<T>(attempt: (sponsor: SponsorClient) => Promise<T>): Promise<PoolAttempt<T>> {
    const refusals: SponsorRefusal[] = [];
    for (const sponsor of this.sponsors) {
      try {
        const value = await attempt(sponsor);
        return { ok: true, value, sponsor, refusals };
      } catch (error) {
        if (error instanceof SponsorError) {
          refusals.push({ endpoint: sponsor.endpoint, error });
          continue;
        }
        throw error;
      }
    }
    return { ok: false, refusals };
  }
}
