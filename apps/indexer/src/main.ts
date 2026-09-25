#!/usr/bin/env node
// PM2 imports this entry point through its own launcher, so argv[1] need not be this file.
import { main } from "./cli.js";

main().catch((error) => {
  console.error(`[indexer] fatal: ${(error as Error).message}`);
  process.exit(1);
});
