import test from "node:test";
import { smokeDeploymentRuntime } from "./deployment-runtime-smoke.ts";

test("release WASM starts and completes the deployment bootstrap through its ABI", async () => {
  await smokeDeploymentRuntime();
});

test("seven release contracts bootstrap without ever executing a token module", async () => {
  await smokeDeploymentRuntime(console.log, true);
});
