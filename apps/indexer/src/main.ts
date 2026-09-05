#!/usr/bin/env node
/**
 * CLI entry point: `node dist/main.js [--rebuild] [--once] [--no-sync] [--network <n>] [--port <p>] [--db <path>]`.
 */
import { loadConfig, type Env } from "./config.js";
import { IndexerDb } from "./db.js";
import { createIndexer } from "./indexer.js";
import { consoleLogger } from "./sync.js";

interface CliArgs {
  rebuild: boolean;
  once: boolean;
  noSync: boolean;
  help: boolean;
  env: Env;
}

const USAGE = `Usage: osp-indexer [options]

Options:
  --rebuild            delete the database and replay the chain from the start height
  --once               sync to the chain head, print the status and exit (no API)
  --no-sync            serve the API from the existing database without syncing
  --network <name>     network (OSP_NETWORK, default harbinger)
  --port <port>        API port (OSP_INDEXER_PORT, default 8787)
  --host <host>        API host (OSP_INDEXER_HOST, default 0.0.0.0)
  --db <path>          SQLite file (OSP_INDEXER_DB, default ./data/indexer-<network>.sqlite)
  --rpc <urls>         comma-separated RPC endpoints (OSP_RPC)
  --start-height <h>   first height to index (OSP_START_HEIGHT)
  -h, --help           this help
`;

export function parseArgs(argv: string[], base: Env = process.env): CliArgs {
  const env: Env = { ...base };
  const args: CliArgs = { rebuild: false, once: false, noSync: false, help: false, env };
  const valueFlags: Record<string, string> = {
    "--network": "OSP_NETWORK",
    "--port": "OSP_INDEXER_PORT",
    "--host": "OSP_INDEXER_HOST",
    "--db": "OSP_INDEXER_DB",
    "--rpc": "OSP_RPC",
    "--start-height": "OSP_START_HEIGHT",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    if (flag === "--rebuild") args.rebuild = true;
    else if (flag === "--once") args.once = true;
    else if (flag === "--no-sync") args.noSync = true;
    else if (flag === "-h" || flag === "--help") args.help = true;
    else if (flag in valueFlags) {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      env[valueFlags[flag]!] = value;
    } else throw new Error(`unknown option ${arg}`);
  }
  return args;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }
  const config = loadConfig(args.env);
  const logger = consoleLogger;

  if (args.rebuild) {
    logger.info(`--rebuild: deleting ${config.dbPath}`);
    IndexerDb.remove(config.dbPath);
  }

  logger.info(`network ${config.network}; database ${config.dbPath}; start height ${config.startHeight}`);
  if (config.deployment) logger.info(`rpc ${config.rpc.join(", ")}`);
  else logger.warn(config.deploymentError ?? "no deployment manifest");

  const indexer = createIndexer({ config, logger });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info(`${signal}: shutting down`);
    await indexer.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  if (args.once) {
    if (!indexer.syncer) throw new Error("--once needs a deployment");
    const result = await indexer.syncer.syncToHead();
    const tip = indexer.db.lastCheckpoint();
    process.stdout.write(
      `${JSON.stringify({ applied: result.applied, rolledBack: result.rolledBack ?? null, indexed: tip ? { height: String(tip.height), id: tip.block_id, stateHash: tip.state_hash } : null })}\n`,
    );
    await indexer.close();
    return;
  }

  if (indexer.syncer && !args.noSync) indexer.syncer.start();
  const address = await indexer.api.listen({ port: config.port, host: config.host });
  logger.info(`API listening on ${address} (status: ${address}/v1/status)`);
}

const isMain = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  main().catch((error) => {
    console.error(`[indexer] fatal: ${(error as Error).message}`);
    process.exit(1);
  });
}
