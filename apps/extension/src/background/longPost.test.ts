import { expect, it, vi } from "vitest";
import { AUDIENCE, ProtocolClient, contentHash, createPostTextResolver, decryptContent, identityFromSeed, parseContentReference, toBase64url } from "@osp/sdk";
import { fixtureDeployment, fakeProvider } from "../../../web/src/testing/fixtures";
import { configureMediaStorage } from "../../../web/src/api/mediaStorage";
import { publishPost, type PublishContext } from "./publish";

it.each([AUDIENCE.EVERYONE, AUDIENCE.FRIENDS])("publishes a long browser-plugin post through R2 references for audience %s", async audience => {
  const me = identityFromSeed(new Uint8Array(32).fill(63)), client = new ProtocolClient({ deployment: fixtureDeployment(), rpc: fakeProvider() });
  const endpoint = "https://sponsor.example/v1/media", objects = new Map<string, Uint8Array>();
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) === endpoint && init?.method === "POST") {
      const body = new Uint8Array(init.body as Uint8Array), hash = toBase64url(contentHash(body));
      const location = `https://media.example/osp/test/identity/${hash}`; objects.set(location, body);
      return new Response(JSON.stringify({ url: location, hash, size: body.length }));
    }
    if (String(url) === endpoint) return new Response(JSON.stringify({ enabled: true, provider: "r2", chainId: client.chainId,
      contract: client.deployment.contracts.identity.address, publicUrl: "https://media.example", maxFileBytes: 26214400 }));
    return new Response(new Uint8Array(objects.get(String(url))!));
  });
  configureMediaStorage(client, endpoint, fetch);
  client.reads.publications.get_library_version = async () => ({ version: 2, content_reference_version: 1 } as never);
  client.reads.publications.get_author_state = async () => ({ value: { next_sequence: "1" } } as never);
  client.reads.relationships.get_audience = async () => ({ value: { epoch: 0 } } as never);
  const submit = vi.spyOn(client, "submit").mockResolvedValue({ transaction: { id: "fixture-only" }, sponsored: true } as never);
  const session = { account: me.account, deviceAddress: me.account, unlockedAt: 1 };
  let savedKey: Uint8Array | undefined;
  const ctx = { client, session, payment: "sponsor-only", sponsorUrls: ["https://sponsor.example"],
    vault: { signers: () => ({ owner: me.signer, device: me.signer }), encryption: () => me.encryption, current: async () => session },
    keys: { lookup: async () => ({ status: "missing" }), put: async (_ref: unknown, key: Uint8Array) => { savedKey = key; } },
    indexer: { configured: true, graph: async () => ({ friends: [] }) },
  } as unknown as PublishContext;
  const text = "A complete plugin story, with a final paragraph.\n".repeat(1700);
  await publishPost({ text, audience, attemptId: "11".repeat(16) }, ctx);
  expect(submit).toHaveBeenCalledOnce();
  const op = submit.mock.calls[0]![0].operations.at(-1)!;
  const args = client.contracts.decodeOperation(op)!.args;
  const reference = parseContentReference(args.envelope as Uint8Array)!;
  expect(reference).toBeDefined(); expect(reference.size).toBeLessThan(4096);
  expect((args.envelope as Uint8Array).length).toBe(44);
  const envelope = [...objects.entries()].find(([url]) => url.endsWith(`/${toBase64url(reference.digest)}`))![1];
  const content = decryptContent({ envelope, ...(savedKey && { epochKey: savedKey, aad: { chainId: client.chainId, author: me.account, audience, epoch: 1, versionNumber: 1 } }) });
  expect((await createPostTextResolver(fetch)(content, audience !== 0)).text).toBe(text);
  expect(objects.size).toBe(2); // Full text and the small, existing publication envelope.
  expect(JSON.stringify(submit.mock.calls[0]![0].operations)).not.toContain(text.slice(0, 100));
});
