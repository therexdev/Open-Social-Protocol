/**
 * ProtocolClient / IndexerClient / SponsorPool built from the resolved settings. Chain reads
 * and writes never bypass @osp/sdk; the indexer is a replaceable convenience.
 */
import { ProtocolClient, SponsorPool, type ProviderInterface } from "@osp/sdk";
import { IndexerClient, type FetchLike } from "../shared/indexer";
import { resolveSettings, settingsSignature, type PaymentPreference, type ResolveOptions, type ResolvedSettings, type Settings } from "../shared/settings";

export interface Clients {
  resolved: ResolvedSettings;
  /** Undefined until a deployment manifest exists for the selected network. */
  protocol?: ProtocolClient;
  indexer: IndexerClient;
}

export interface ClientRegistryOptions extends ResolveOptions {
  loadSettings: () => Promise<Settings>;
  /** A koilib provider (fakes in tests). */
  provider?: ProviderInterface;
  fetch?: FetchLike;
}

export class ClientRegistry {
  private cached: { signature: string; clients: Clients } | undefined;

  constructor(private readonly options: ClientRegistryOptions) {}

  async get(): Promise<Clients> {
    const settings = await this.options.loadSettings();
    const resolved = resolveSettings(settings, this.options);
    const signature = settingsSignature(resolved);
    if (this.cached && this.cached.signature === signature) return this.cached.clients;
    const indexer = new IndexerClient({ baseUrl: resolved.indexerUrl, ...(this.options.fetch && { fetch: this.options.fetch }) });
    let protocol: ProtocolClient | undefined;
    if (resolved.deployment) {
      const sponsors = new SponsorPool(resolved.sponsorUrls, {
        expectedChainId: resolved.deployment.chainId,
        ...(this.options.fetch && { fetch: this.options.fetch as (input: string, init?: RequestInit) => Promise<Response> }),
      });
      const rpc = this.options.provider ?? (resolved.rpcUrls.length > 0 ? resolved.rpcUrls : resolved.deployment.rpc);
      protocol = new ProtocolClient({ rpc, deployment: resolved.deployment, sponsors });
    }
    const clients: Clients = { resolved, ...(protocol && { protocol }), indexer };
    this.cached = { signature, clients };
    return clients;
  }

  invalidate(): void {
    this.cached = undefined;
  }
}

/** `ProtocolClient.submit` options for the payment preference. */
export function submitPaymentOptions(payment: PaymentPreference): { sponsor?: null; selfPayFallback?: boolean } {
  if (payment === "self-only") return { sponsor: null };
  if (payment === "sponsor-only") return { selfPayFallback: false };
  return {};
}

export function requireProtocol(clients: Clients): ProtocolClient {
  if (!clients.protocol) throw new Error(clients.resolved.deploymentMessage ?? "The protocol contracts are not deployed on this network.");
  return clients.protocol;
}
