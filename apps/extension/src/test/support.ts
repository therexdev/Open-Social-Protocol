/**
 * Shared fakes for background tests: a fixture deployment, a fake koilib provider that answers
 * the reads the extension performs, and a `createBackground` wired to in-memory storage.
 */
import { ABIS } from "@osp/proto";
import { ProtocolContracts, encode, toHex, type Deployment, type ProtoObject } from "@osp/sdk";
import type { CallContractOperationJson, TransactionJson, TransactionReceipt } from "koilib";
import { deterministicRng, fakeProvider, fixtureDeployment, type FakeProvider } from "../../../../packages/sdk/src/testing/fixtures";
import { createBackground, type BackgroundOptions } from "../background/app";
import { memoryArea } from "../shared/storage";
import { createChromeMock, type ChromeMock } from "./chromeMock";

export const TEST_KDF = { N: 2 ** 10, r: 8, p: 1 };
export const RUNTIME_ID = "osp-test-extension";

export interface ChainState {
  registered: Set<string>;
  devices: Map<string, { device: string; capabilities: number; expires_at: string; device_epoch: number; revoked: boolean }>;
  nextSequence: Record<string, string>;
  postsByKey: Map<string, Uint8Array>;
  audienceEpoch: Record<string, number>;
  /** Called for each broadcast; return a partial receipt (rpc_error to simulate a timeout) or throw. */
  onSend?: (tx: TransactionJson, decoded: Array<{ contract: string; method: string; args: ProtoObject }>) => Partial<TransactionReceipt> | undefined;
}

export function chainState(): ChainState {
  return { registered: new Set(), devices: new Map(), nextSequence: {}, postsByKey: new Map(), audienceEpoch: {} };
}

/** A fake provider whose read_contract answers come from `state` and whose broadcasts update it. */
export function fakeChain(deployment: Deployment, state: ChainState): FakeProvider {
  const contracts = new ProtocolContracts(deployment);
  const entry = (name: keyof typeof ABIS, method: string) => ABIS[name].methods[method]!.entry_point;
  const onRead = (op: CallContractOperationJson): Uint8Array | undefined => {
    const decoded = contracts.decodeOperation(op);
    if (!decoded) return undefined;
    const args = decoded.args;
    switch (decoded.method) {
      case "get_identity": {
        const account = args.account as string;
        if (!state.registered.has(account)) return encode("identity.get_identity_result", {});
        return encode("identity.get_identity_result", { value: { account, owner: account, encryption_key: new Uint8Array(32), key_version: 1, protocol_version: 1, device_epoch: 0, registered_at: "1", updated_at: "1" } });
      }
      case "get_device": {
        const device = state.devices.get(`${args.account}|${args.device}`);
        if (!device) return encode("identity.get_device_result", {});
        return encode("identity.get_device_result", { value: { account: args.account, ...device, label: "test", authorized_at: "1" } });
      }
      case "get_author_state":
        return encode("publications.get_author_state_result", { value: { next_sequence: state.nextSequence[args.author as string] ?? "1", last_publish_at: "0", post_count: "0" } });
      case "get_post_by_idempotency_key": {
        const post = state.postsByKey.get(`${args.author}|${toHex(args.idempotency_key as Uint8Array)}`);
        return post ? encode("publications.get_post_by_idempotency_key_result", { value: { post_id: post } }) : encode("publications.get_post_by_idempotency_key_result", {});
      }
      case "get_audience":
        return encode("relationships.get_audience_result", { value: { epoch: state.audienceEpoch[args.account as string] ?? 0, updated_at: "0" } });
      default:
        return undefined;
    }
  };
  const provider = fakeProvider({
    onRead,
    onSend: (tx, broadcast) => {
      const decoded = (tx.operations ?? []).map((op) => contracts.decodeOperation(op)).filter((d): d is NonNullable<typeof d> => d !== undefined);
      const extra = state.onSend?.(tx, decoded);
      if (extra?.rpc_error !== undefined || extra?.reverted) return extra;
      if (!broadcast) return extra;
      for (const d of decoded) {
        if (d.method === "register") state.registered.add(d.args.account as string);
        if (d.method === "authorize_device") {
          state.devices.set(`${d.args.account}|${d.args.device}`, { device: d.args.device as string, capabilities: d.args.capabilities as number, expires_at: String(d.args.expires_at), device_epoch: 0, revoked: false });
        }
        if (d.method === "publish") {
          const author = d.args.author as string;
          state.postsByKey.set(`${author}|${toHex(d.args.idempotency_key as Uint8Array)}`, d.args.post_id as Uint8Array);
          state.nextSequence[author] = String(BigInt(d.args.sequence as string) + 1n);
        }
      }
      return extra;
    },
  });
  void entry;
  return provider;
}

export interface TestBackground {
  chrome: ChromeMock;
  provider: FakeProvider;
  state: ChainState;
  deployment: Deployment;
  background: ReturnType<typeof createBackground>;
  local: ReturnType<typeof memoryArea>;
  session: ReturnType<typeof memoryArea>;
  /** Sends a message as an extension page and unwraps the reply (throws on error replies). */
  call<T = unknown>(type: string, payload?: unknown): Promise<T>;
  now: { value: number };
}

export function createTestBackground(options: Partial<BackgroundOptions> & { origins?: string[]; deployed?: boolean; fetch?: BackgroundOptions["fetch"] } = {}): TestBackground {
  const chromeMock = createChromeMock({ id: RUNTIME_ID, origins: options.origins ?? [] });
  const deployment = fixtureDeployment();
  const state = chainState();
  const provider = fakeChain(deployment, state);
  const local = memoryArea();
  const session = memoryArea();
  const now = { value: 1_800_000_000_000 };
  let attempt = 0;
  const attemptRng = deterministicRng("attempts");
  const background = createBackground({
    local,
    session,
    runtimeId: RUNTIME_ID,
    api: chromeMock as unknown as typeof chrome,
    provider,
    kdf: TEST_KDF,
    now: () => now.value,
    deployments: options.deployed === false ? {} : { fixture: deployment },
    deploymentErrors: {},
    env: { network: "fixture", rpcUrls: [], indexerUrl: "", sponsorUrls: [] },
    attemptId: () => {
      attempt += 1;
      return toHex(attemptRng(16));
    },
    fetch: options.fetch ?? (async () => new Response(JSON.stringify({ error: { code: "not_found", message: "no indexer in tests" } }), { status: 404 })),
    ...options,
  });
  chromeMock.runtime.onMessage.addListener(background.router.listener);
  return {
    chrome: chromeMock,
    provider,
    state,
    deployment,
    background,
    local,
    session,
    now,
    async call<T>(type: string, payload?: unknown): Promise<T> {
      const reply = (await chromeMock._dispatch({ type, payload }, chromeMock._extensionSender())) as { ok: boolean; result?: T; error?: { code: string; message: string } };
      if (!reply.ok) throw new Error(`${reply.error?.code}: ${reply.error?.message}`);
      return reply.result as T;
    },
  };
}
