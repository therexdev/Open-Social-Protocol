/**
 * Wires configuration, storage, chain access, the sync loop and the HTTP API together.
 */
import type { FastifyInstance } from "fastify";
import { KoinosChain, createProvider, type ChainSource } from "./chain.js";
import type { IndexerConfig } from "./config.js";
import { IndexerDb } from "./db.js";
import { buildApi } from "./api.js";
import { Syncer, silentLogger, type Logger } from "./sync.js";

export interface IndexerOptions {
  config: IndexerConfig;
  /** Storage (default: the configured database file). */
  db?: IndexerDb;
  /** Chain source (default: koilib Provider over the configured RPC list). */
  chain?: ChainSource;
  logger?: Logger;
  /** Fastify request logging. */
  httpLogger?: boolean;
}

export interface Indexer {
  config: IndexerConfig;
  db: IndexerDb;
  chain?: ChainSource;
  syncer?: Syncer;
  api: FastifyInstance;
  /** Stops the sync loop, closes the API and the database. */
  close(): Promise<void>;
}

/** Creates an indexer. In "not deployed" mode there is no chain source and no syncer. */
export function createIndexer(options: IndexerOptions): Indexer {
  const { config } = options;
  const logger = options.logger ?? silentLogger;
  const db = options.db ?? new IndexerDb(config.dbPath);
  let chain = options.chain;
  let syncer: Syncer | undefined;
  if (config.deployment) {
    if (!chain) {
      try {
        chain = new KoinosChain(createProvider(config.rpc), config.deployment);
      } catch (error) {
        logger.error(`cannot create chain provider: ${(error as Error).message}`);
      }
    }
    if (chain) {
      syncer = new Syncer({
        db,
        chain,
        startHeight: config.startHeight,
        chainId: config.deployment.chainId,
        batchSize: config.batchSize,
        pollIntervalMs: config.pollIntervalMs,
        ...(config.reversibleWindow !== undefined && { reversibleWindow: config.reversibleWindow }),
        logger,
      });
    }
  } else {
    logger.warn(`not deployed: ${config.deploymentError ?? "no deployment manifest"} (API serves healthy=false)`);
  }
  const api = buildApi({ db, config, ...(syncer && { syncer }), logger: options.httpLogger ?? false });
  return {
    config,
    db,
    ...(chain && { chain }),
    ...(syncer && { syncer }),
    api,
    async close() {
      if (syncer) await syncer.stop();
      await api.close();
      db.close();
    },
  };
}
