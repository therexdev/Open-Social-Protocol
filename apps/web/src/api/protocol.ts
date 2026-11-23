/**
 * ProtocolClient construction from the resolved settings (RPC failover list, deployment,
 * sponsor pool). Chain writes and reads never bypass @osp/sdk.
 */
import { ProtocolClient, SponsorPool, type ProviderInterface } from "@osp/sdk";
import type { ResolvedSettings } from "../stores/settings";
import { configureMediaStorage } from "./mediaStorage";
import { configureMusicGateway } from "../features/music/musicGateway";

export interface CreateProtocolOptions {
  /** A koilib provider (fakes in tests). */
  provider?: ProviderInterface;
  fetch?: typeof fetch;
}

export function createProtocolClient(resolved: ResolvedSettings, options: CreateProtocolOptions = {}): ProtocolClient | undefined {
  if (!resolved.deployment) return undefined;
  const rpc = options.provider ?? (resolved.rpcUrls.length > 0 ? resolved.rpcUrls : resolved.deployment.rpc);
  const sponsors = new SponsorPool(resolved.sponsorUrls, {
    expectedChainId: resolved.deployment.chainId,
    ...(options.fetch && { fetch: options.fetch as (input: string, init?: RequestInit) => Promise<Response> }),
  });
  const client = new ProtocolClient({ rpc, deployment: resolved.deployment, sponsors });
  configureMusicGateway(client, resolved.indexerUrl, options.fetch);
  if (resolved.network === "harbinger")
    configureMediaStorage(client, resolved.mediaUploadUrl || `${(resolved.deployment.sponsors?.[0] ?? resolved.sponsorUrls[0])?.replace(/\/+$/, "") ?? ""}/v1/media`, options.fetch);
  return client;
}
