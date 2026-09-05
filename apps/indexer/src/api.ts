/**
 * INDEXER API v1 (Fastify 5 + @fastify/cors). See README.md, "API reference".
 *
 * Conventions: JSON everywhere; addresses Base58; bytes base64url; uint64 (heights, timestamps,
 * nonces, sequences) decimal strings; cursors opaque; CORS open to every origin; errors are
 * `{ error: { code, message } }` with 400 / 404 / 503.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { isAddress } from "@osp/sdk";
import type { IndexerConfig } from "./config.js";
import type { IndexerDb } from "./db.js";
import * as q from "./queries.js";
import type { Syncer } from "./sync.js";

export interface ApiOptions {
  db: IndexerDb;
  config: IndexerConfig;
  syncer?: Syncer;
  /** Fastify logger (default off). */
  logger?: boolean;
}

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly status: 400 | 404 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Query = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function param(request: FastifyRequest, name: string): string {
  const params = request.params as Record<string, string | undefined>;
  return params[name] ?? "";
}

function query(request: FastifyRequest, name: string): string | undefined {
  const value = one((request.query as Query)[name]);
  return value === undefined || value === "" ? undefined : value;
}

export function parseAddress(value: string | undefined, name: string, required = true): string | undefined {
  if (value === undefined) {
    if (required) throw new ApiError(400, "invalid_request", `${name} is required`);
    return undefined;
  }
  if (!isAddress(value)) throw new ApiError(400, "invalid_address", `${name} is not a valid Koinos address`);
  return value;
}

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export function parseBase64url(value: string | undefined, name: string, required = true): string | undefined {
  if (value === undefined) {
    if (required) throw new ApiError(400, "invalid_request", `${name} is required`);
    return undefined;
  }
  if (value.length > 512 || !BASE64URL.test(value)) throw new ApiError(400, "invalid_request", `${name} must be base64url`);
  return value;
}

export function parseLimit(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, "invalid_request", "limit must be a positive integer");
  return Math.min(n, max);
}

export function parseInteger(value: string | undefined, name: string, min = 0): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new ApiError(400, "invalid_request", `${name} must be a non-negative integer`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min) throw new ApiError(400, "invalid_request", `${name} must be an integer >= ${min}`);
  return n;
}

export function parseCursor(value: string | undefined): q.PositionCursor | undefined {
  if (value === undefined) return undefined;
  const cursor = q.decodeCursor(value);
  if (!cursor) throw new ApiError(400, "invalid_cursor", "cursor is not valid");
  return cursor;
}

function sendError(reply: FastifyReply, error: ApiError): FastifyReply {
  return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
}

/** Builds the `/v1/status` document. */
export function statusView(options: ApiOptions): Record<string, unknown> {
  const { config, db, syncer } = options;
  const deployment = config.deployment;
  const indexed = db.lastCheckpoint();
  const head = syncer?.state.head;
  const lag = head && indexed ? Math.max(0, head.height - indexed.height) : undefined;
  let healthy = false;
  if (deployment) {
    if (syncer) {
      healthy = head !== undefined && indexed !== undefined && syncer.state.lastError === undefined && (lag ?? 0) <= 2 * syncer.batchSize;
    } else {
      healthy = indexed !== undefined;
    }
  }
  const contracts: Record<string, string> | null = deployment
    ? Object.fromEntries(Object.entries(deployment.contracts).map(([name, entry]) => [name, entry.address]))
    : null;
  return {
    network: config.network,
    chainId: deployment?.chainId ?? null,
    contracts,
    head: head ? { height: String(head.height), id: head.id } : null,
    lastIrreversible: head ? String(head.lastIrreversible) : null,
    indexed: indexed ? { height: String(indexed.height), id: indexed.block_id, stateHash: indexed.state_hash } : null,
    startHeight: String(config.startHeight),
    healthy,
    version: config.version,
    deployed: deployment !== undefined,
    ...(config.deploymentError && { message: config.deploymentError }),
    sync: {
      running: syncer?.state.running ?? false,
      lastSyncAt: syncer?.state.lastSyncAt ?? null,
      lastError: syncer?.state.lastError ?? null,
      lag: lag ?? null,
      rollbacks: syncer?.state.rollbacks ?? 0,
    },
    rpc: config.rpc,
  };
}

export function buildApi(options: ApiOptions): FastifyInstance {
  const { db, config } = options;
  const app = Fastify({ logger: options.logger ?? false });

  app.register(cors, { origin: "*", methods: ["GET", "HEAD", "OPTIONS"] });

  app.setNotFoundHandler((request, reply) => {
    void request;
    sendError(reply, new ApiError(404, "not_found", "route not found"));
  });
  app.setErrorHandler((error: unknown, request, reply) => {
    void request;
    if (error instanceof ApiError) {
      sendError(reply, error);
      return;
    }
    const err = error as Error & { statusCode?: number };
    const status = err.statusCode;
    if (status === 400 || status === 404) {
      sendError(reply, new ApiError(status, status === 400 ? "invalid_request" : "not_found", err.message));
      return;
    }
    app.log.error(err);
    reply.status(500).send({ error: { code: "internal_error", message: "internal error" } });
  });

  app.get("/", async () => ({ name: "@osp/indexer", version: config.version, api: "v1", status: "/v1/status" }));
  app.get("/health", async (request, reply) => {
    void request;
    const status = statusView(options);
    return reply.status(status.healthy ? 200 : 503).send({ healthy: status.healthy });
  });

  app.get("/v1/status", async () => statusView(options));

  // Every data route requires a deployment.
  app.addHook("onRequest", async (request, reply) => {
    if (config.deployment) return;
    if (!request.url.startsWith("/v1/") || request.url.startsWith("/v1/status")) return;
    sendError(reply, new ApiError(503, "not_deployed", config.deploymentError ?? `no deployment manifest for network ${config.network}`));
  });

  app.get("/v1/profiles", async (request) => {
    const search = query(request, "query") ?? "";
    if (search.length > 64 || !/^[1-9A-HJ-NP-Za-km-z]*$/.test(search)) {
      throw new ApiError(400, "invalid_request", "query must be a Base58 address prefix");
    }
    const limit = parseLimit(query(request, "limit"), 20, 100);
    return { items: q.searchProfiles(db, search, limit) };
  });

  app.get("/v1/profiles/:account", async (request, reply) => {
    const account = parseAddress(param(request, "account"), "account")!;
    const profile = q.getProfile(db, account);
    if (!profile) return sendError(reply, new ApiError(404, "not_found", "identity not registered"));
    return profile;
  });

  app.get("/v1/graph/:account", async (request) => {
    const account = parseAddress(param(request, "account"), "account")!;
    return q.getGraph(db, account);
  });

  app.get("/v1/feed", async (request) => {
    const viewer = parseAddress(query(request, "viewer"), "viewer", false);
    const scopeRaw = query(request, "scope") ?? "public";
    if (scopeRaw !== "public" && scopeRaw !== "friends" && scopeRaw !== "all") {
      throw new ApiError(400, "invalid_request", "scope must be public, friends or all");
    }
    if (scopeRaw === "friends" && !viewer) throw new ApiError(400, "invalid_request", "viewer is required for scope=friends");
    return q.feed(db, {
      ...(viewer && { viewer }),
      scope: scopeRaw,
      ...(query(request, "cursor") !== undefined && { cursor: parseCursor(query(request, "cursor")) }),
      limit: parseLimit(query(request, "limit"), 20, 100),
    });
  });

  app.get("/v1/accounts/:account/posts", async (request) => {
    const account = parseAddress(param(request, "account"), "account")!;
    const viewer = parseAddress(query(request, "viewer"), "viewer", false);
    return q.accountPosts(db, account, parseCursor(query(request, "cursor")), parseLimit(query(request, "limit"), 20, 100), viewer);
  });

  app.get("/v1/posts/:postId", async (request, reply) => {
    const postId = parseBase64url(param(request, "postId"), "postId")!;
    const viewer = parseAddress(query(request, "viewer"), "viewer", false);
    const post = q.getPost(db, postId, viewer);
    if (!post) return sendError(reply, new ApiError(404, "not_found", "post not found"));
    return post;
  });

  app.get("/v1/posts/:postId/replies", async (request, reply) => {
    const postId = parseBase64url(param(request, "postId"), "postId")!;
    if (!q.postExists(db, postId)) return sendError(reply, new ApiError(404, "not_found", "post not found"));
    const viewer = parseAddress(query(request, "viewer"), "viewer", false);
    return q.replies(db, postId, parseCursor(query(request, "cursor")), parseLimit(query(request, "limit"), 20, 100), viewer);
  });

  app.get("/v1/notifications/:account", async (request) => {
    const account = parseAddress(param(request, "account"), "account")!;
    const since = parseInteger(query(request, "since"), "since");
    return q.notifications(db, account, since, parseLimit(query(request, "limit"), 50, 200));
  });

  app.get("/v1/keys/:account", async (request) => {
    const account = parseAddress(param(request, "account"), "account")!;
    const author = parseAddress(query(request, "author"), "author", false);
    const audienceId = parseBase64url(query(request, "audienceId"), "audienceId", false);
    const epoch = parseInteger(query(request, "epoch"), "epoch");
    const limit = parseLimit(query(request, "limit"), 500, 2000);
    return {
      items: q.keysFor(db, account, {
        ...(author && { author }),
        ...(audienceId !== undefined && { audienceId }),
        ...(epoch !== undefined && { epoch }),
        limit,
      }),
    };
  });

  app.get("/v1/audiences/:author", async (request) => {
    const author = parseAddress(param(request, "author"), "author")!;
    const audienceId = parseBase64url(query(request, "audienceId"), "audienceId", false) ?? "";
    return q.audienceView(db, author, audienceId);
  });

  app.get("/v1/communities/:id", async (request, reply) => {
    const id = parseBase64url(param(request, "id"), "id")!;
    const community = q.getCommunity(db, id);
    if (!community) return sendError(reply, new ApiError(404, "not_found", "community not found"));
    return community;
  });

  app.get("/v1/labels", async (request) => {
    const postId = parseBase64url(query(request, "postId"), "postId", false);
    const communityId = parseBase64url(query(request, "communityId"), "communityId", false);
    if (postId === undefined && communityId === undefined) throw new ApiError(400, "invalid_request", "postId or communityId is required");
    const limit = parseLimit(query(request, "limit"), 100, 500);
    return { items: q.labelsQuery(db, { ...(postId !== undefined && { postId }), ...(communityId !== undefined && { communityId }) }, limit) };
  });

  app.get("/v1/sponsors", async () => ({ items: q.sponsors(db) }));

  app.get("/v1/registry", async () => ({ items: q.registryEntries(db) }));

  app.get("/v1/events", async (request) => {
    const fromHeight = parseInteger(query(request, "fromHeight"), "fromHeight") ?? config.startHeight;
    const limit = parseLimit(query(request, "limit"), 100, 1000);
    return q.eventsFrom(db, fromHeight, limit);
  });

  app.get("/v1/conformance/state-hash", async (request, reply) => {
    const height = parseInteger(query(request, "height"), "height");
    const view = q.stateHashAt(db, height);
    if (!view) return sendError(reply, new ApiError(404, "not_found", height === undefined ? "nothing indexed yet" : `height ${height} is not indexed`));
    return view;
  });

  return app;
}
