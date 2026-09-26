import assert from "node:assert/strict";
import test from "node:test";
import type { Deployment } from "./common.ts";
import { deploymentServiceEndpoints } from "./deployment-services.ts";
const config = (indexers: string[], sponsors: string[]) => ({ indexers, sponsors } as Deployment);
test("a token upgrade preserves published services over an older empty checkpoint", () => {
  const published = config(["https://social-api.usekoinos.com"], ["https://social-sponsor.usekoinos.com"]);
  assert.deepEqual(deploymentServiceEndpoints(published, config([], [])), { indexers: published.indexers, sponsors: published.sponsors });
});
test("initial deployment resumes services while explicit published removal stays authoritative", () => {
  const checkpoint = config(["https://indexer.test"], ["https://sponsor.test"]);
  assert.deepEqual(deploymentServiceEndpoints(null, checkpoint), checkpoint);
  assert.deepEqual(deploymentServiceEndpoints(config([], []), checkpoint), { indexers: [], sponsors: [] });
});
