/**
 * Entry point: `OSP_NETWORK=harbinger OSP_SPONSOR_WIF=... npm run sponsor`.
 *
 * Starts even without a deployment manifest or key (reported by `/healthz`), and performs the
 * on-chain registration in the background after listening, without ever crashing on RPC errors.
 */
import { Signer } from "@osp/sdk";
import { ConfigError, loadConfig, readDeployment } from "./config.js";
import { desiredRecord, ensureRegistered } from "./register.js";
import { createServer } from "./server.js";

function log(message: string): void {
  process.stderr.write(`[sponsor] ${message}\n`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const lookup = readDeployment(config);
  let signer: Signer | undefined;
  if (config.wif) {
    try {
      signer = Signer.fromWif(config.wif);
    } catch (error) {
      throw new ConfigError(`OSP_SPONSOR_WIF is not a valid WIF private key: ${(error as Error).message}`);
    }
  }

  const app = await createServer({
    config,
    deployment: lookup.status === "loaded" ? lookup.deployment : undefined,
    deploymentPath: lookup.path,
    deploymentError: lookup.status === "invalid" ? lookup.error : undefined,
    signer,
    logger: { level: process.env.OSP_SPONSOR_LOG_LEVEL ?? "info" },
  });
  const service = app.sponsorService;

  await app.listen({ port: config.port, host: config.host });
  const status = service.status();
  log(`network ${config.network}; listening on http://${config.host}:${config.port}; public URL ${config.publicUrl}`);
  log(`state: ${status.state} - ${status.message}`);
  if (status.sponsor) log(`sponsor (payer) address: ${status.sponsor}`);
  if (status.allowed.length > 0) log(`allowed methods: ${status.allowed.join(", ")}`);
  log(`limits: ${config.dailyOps} ops/day, ${config.burstOps} ops per ${config.burstWindowSec}s, ${config.maxBytesPerOp} bytes/op, ${config.maxRcPerOp} RC/op, ${config.maxOpsPerTx} ops/tx`);

  if (status.state === "serving" && config.register && service.client && service.signer && service.allowlist && service.address) {
    const desired = desiredRecord({ sponsor: service.address, publicUrl: config.publicUrl, allowlist: service.allowlist, limits: service.limits });
    void ensureRegistered({ client: service.client, signer: service.signer, desired, log }).then((result) => {
      log(`on-chain registration: ${result.status}${"error" in result ? ` (${result.error})` : ""}`);
    });
  } else if (status.state === "serving") {
    log("on-chain registration disabled (OSP_SPONSOR_REGISTER=false)");
  }

  const shutdown = (signal: string) => {
    log(`${signal} received, shutting down`);
    app
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        log(`shutdown error: ${(error as Error).message}`);
        process.exit(1);
      });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  log(`fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
