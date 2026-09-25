import { test, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";

test("starts the status API when a process manager imports the entry point", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "osp-indexer-launch-"));
  const entry = new URL("./main.ts", import.meta.url).href;
  // Like PM2's launcher, this imports main without naming it in process.argv[1].
  const child = spawn(process.execPath, ["--experimental-sqlite", "--import", "tsx", "--input-type=module", "-e", `await import(${JSON.stringify(entry)})`], {
    env: { ...process.env, OSP_DEPLOYMENT: path.join(dir, "missing.json"), OSP_INDEXER_DB: path.join(dir, "indexer.sqlite"), OSP_INDEXER_HOST: "127.0.0.1", OSP_INDEXER_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stopped = once(child, "exit");
  let output = "";
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`indexer never listened: ${output}`)), 10_000);
      const capture = (data: Buffer) => {
        output += data.toString();
        const match = /API listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
        if (match) { clearTimeout(timeout); resolve(match[1]!); }
      };
      child.stdout.on("data", capture);
      child.stderr.on("data", capture);
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.once("exit", code => { clearTimeout(timeout); reject(new Error(`indexer exited ${code}: ${output}`)); });
    });
    const response = await fetch(`${url}/v1/status`);
    const status = await response.json() as { healthy: boolean };
    expect(status.healthy).toBe(false);
    expect(output).toContain("deployment manifest not found");
  } finally {
    child.kill("SIGTERM");
    await stopped;
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);
