import type { Deployment } from "./common.ts";

/** Published discovery configuration is authoritative over a resume checkpoint. */
export function deploymentServiceEndpoints(published: Deployment | null, checkpoint: Deployment | null) {
  return {
    indexers: published?.indexers ?? checkpoint?.indexers ?? [],
    sponsors: published?.sponsors ?? checkpoint?.sponsors ?? [],
  };
}
