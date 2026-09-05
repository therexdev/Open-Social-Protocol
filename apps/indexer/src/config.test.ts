import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULTS, IndexerDb, computeStateHash, createIndexer, decodeCursor, encodeCursor, loadConfig } from "./index.js";
import { parseArgs } from "./main.js";
import { testDeployment } from "./testing/fake-chain.js";

describe("loadConfig", () => {
  it("falls back to not-deployed mode when the manifest is missing", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "osp-indexer-cfg-"));
    try {
      const config = loadConfig({ OSP_NETWORK: "harbinger" }, { deploymentsDir: dir });
      expect(config.deployment).toBeUndefined();
      expect(config.deploymentError).toContain(path.join(dir, "harbinger.json"));
      expect(config.rpc).toEqual(["https://harbinger-api.koinos.io", "https://api.harbinger.koinos.pro"]);
      expect(config.dbPath).toBe(path.join("data", "indexer-harbinger.sqlite"));
      expect(config.port).toBe(DEFAULTS.port);
      expect(config.startHeight).toBe(1);
      expect(config.pollIntervalMs).toBe(DEFAULTS.pollIntervalMs);
      expect(config.batchSize).toBe(DEFAULTS.batchSize);
      expect(config.reversibleWindow).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads a manifest and applies environment overrides", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "osp-indexer-cfg-"));
    try {
      const deployment = testDeployment(4242);
      writeFileSync(path.join(dir, "test.json"), JSON.stringify(deployment));
      const config = loadConfig(
        {
          OSP_NETWORK: "test",
          OSP_RPC: "http://a.invalid, http://b.invalid",
          OSP_INDEXER_DB: "/tmp/x.sqlite",
          OSP_INDEXER_PORT: "9999",
          OSP_INDEXER_HOST: "127.0.0.1",
          OSP_POLL_INTERVAL_MS: "10",
          OSP_BATCH_SIZE: "7",
          OSP_REVERSIBLE_WINDOW: "60",
        },
        { deploymentsDir: dir },
      );
      expect(config.deployment?.contracts.identity.address).toBe(deployment.contracts.identity.address);
      expect(config.rpc).toEqual(["http://a.invalid", "http://b.invalid"]);
      expect(config.dbPath).toBe("/tmp/x.sqlite");
      expect(config.port).toBe(9999);
      expect(config.host).toBe("127.0.0.1");
      expect(config.pollIntervalMs).toBe(10);
      expect(config.batchSize).toBe(7);
      expect(config.reversibleWindow).toBe(60);
      expect(config.startHeight).toBe(4242);
      expect(loadConfig({ OSP_NETWORK: "test", OSP_START_HEIGHT: "10" }, { deploymentsDir: dir }).startHeight).toBe(10);
      writeFileSync(path.join(dir, "broken.json"), "{ not json");
      expect(loadConfig({ OSP_NETWORK: "broken" }, { deploymentsDir: dir }).deploymentError).toMatch(/invalid deployment manifest/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid numbers", () => {
    expect(() => loadConfig({ OSP_BATCH_SIZE: "zero" }, { deployment: testDeployment() })).toThrow(/OSP_BATCH_SIZE/);
    expect(() => loadConfig({ OSP_INDEXER_PORT: "-1" }, { deployment: testDeployment() })).toThrow(/OSP_INDEXER_PORT/);
  });
});

describe("not deployed mode", () => {
  it("serves healthy=false and 503 on data routes", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "osp-indexer-nd-"));
    try {
      const config = loadConfig({ OSP_NETWORK: "harbinger", OSP_INDEXER_DB: ":memory:" }, { deploymentsDir: dir });
      const indexer = createIndexer({ config, db: IndexerDb.memory() });
      expect(indexer.syncer).toBeUndefined();
      const status = await indexer.api.inject({ method: "GET", url: "/v1/status" });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({ network: "harbinger", healthy: false, deployed: false, chainId: null, contracts: null, head: null, indexed: null });
      expect(status.json().message).toMatch(/deployment manifest not found/);
      const feed = await indexer.api.inject({ method: "GET", url: "/v1/feed" });
      expect(feed.statusCode).toBe(503);
      expect(feed.json().error.code).toBe("not_deployed");
      const health = await indexer.api.inject({ method: "GET", url: "/health" });
      expect(health.statusCode).toBe(503);
      await indexer.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("helpers", () => {
  it("round-trips cursors and rejects malformed ones", () => {
    const cursor = encodeCursor([112, 3, 1]);
    expect(decodeCursor(cursor)).toEqual([112, 3, 1]);
    expect(decodeCursor("!!")).toBeUndefined();
    expect(decodeCursor(Buffer.from("1:2").toString("base64url"))).toBeUndefined();
    expect(decodeCursor(Buffer.from("a:b:c").toString("base64url"))).toBeUndefined();
  });

  it("computes a chained state hash", () => {
    const events = [{ height: "1", blockId: "0x1", txIndex: 0, txId: "0xt", sequence: 0, contract: "identity", name: "osp.identity.registered", data: { account: "1abc" }, impacted: ["1abc"] }];
    const first = computeStateHash(undefined, events);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(computeStateHash(undefined, events)).toBe(first);
    expect(computeStateHash(first, [])).not.toBe(first);
    expect(computeStateHash(undefined, [{ ...events[0]!, data: { account: "1abd" } }])).not.toBe(first);
  });

  it("parses CLI arguments into environment overrides", () => {
    const args = parseArgs(["--rebuild", "--network", "localnet", "--port=1234", "--once"], {});
    expect(args.rebuild).toBe(true);
    expect(args.once).toBe(true);
    expect(args.env).toEqual({ OSP_NETWORK: "localnet", OSP_INDEXER_PORT: "1234" });
    expect(() => parseArgs(["--bogus"], {})).toThrow(/unknown option/);
  });

  it("migrates a fresh database and refuses newer schemas", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "osp-indexer-db-"));
    try {
      const file = path.join(dir, "x.sqlite");
      const db = new IndexerDb(file);
      expect(db.schemaVersion).toBe(1);
      db.setMeta("schema_version", "99");
      db.close();
      expect(() => new IndexerDb(file)).toThrow(/newer than this indexer supports/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
