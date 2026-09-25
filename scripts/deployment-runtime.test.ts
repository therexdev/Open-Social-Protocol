import test from "node:test";
import { smokeDeploymentRuntime } from "./deployment-runtime-smoke.ts";

test("release WASM starts and completes the deployment bootstrap through its ABI", async () => {
  await smokeDeploymentRuntime();
});
