import { afterEach, expect, it, vi } from "vitest";
import { contentHash, contentReference, contentReferenceUri, encodeContentReference, encodeProfile, identityFromSeed, toBase64url, utf8 } from "@osp/sdk";
import { IndexerDb, KoinosChain, createIndexer, loadConfig, replayProjections } from "./index.js";
import { ChainBuilder, FakeProvider, testDeployment, ospEvent, tx } from "./testing/fake-chain.js";
afterEach(() => vi.unstubAllGlobals());

it("syncs and replays during a hosting outage, then hydrates posts and searchable profiles without changing the ledger checkpoint", async () => {
  const deployment = testDeployment(), builder = new ChainBuilder(deployment);
  const me = identityFromSeed(new Uint8Array(32).fill(81)), bytes = utf8("post envelope bytes"), ref = contentReference(bytes), profile = encodeProfile({ display_name: "Hosted Alice", bio: "Hello" }), profileRef = contentReference(profile), id = new Uint8Array(32).fill(6);
  builder.block([tx([
    ospEvent(deployment, "osp.identity.registered", { account: me.account, encryption_key: me.encryption.publicKey, key_version: 1, profile_hash: contentHash(profile), profile_uri: contentReferenceUri(profileRef), protocol_version: 1, timestamp: String(builder.baseTimestamp) }, [me.account]),
    ospEvent(deployment, "osp.publications.published", { author: me.account, post_id: id, sequence: "1", version_number: 1, content_hash: ref.digest, envelope: encodeContentReference(ref), audience: 0, timestamp: String(builder.baseTimestamp), protocol_version: 1 }, [me.account]),
  ])]);
  const fetchFn = vi.fn().mockRejectedValue(Error("hosting offline")); vi.stubGlobal("fetch", fetchFn);
  const config = loadConfig({ OSP_NETWORK: "test", OSP_INDEXER_DB: ":memory:", OSP_CONTENT_PUBLIC_URL: "https://media.example" }, { deployment });
  const indexer = createIndexer({ config, db: IndexerDb.memory(), chain: new KoinosChain(new FakeProvider(builder), deployment) });
  try {
    await indexer.syncer!.syncToHead();
    const checkpoint = indexer.db.lastCheckpoint();
    expect(fetchFn).not.toHaveBeenCalled();
    const path = `/v1/posts/${toBase64url(id)}`;
    expect((await indexer.api.inject({ method: "GET", url: path })).json().envelope).toBe(toBase64url(encodeContentReference(ref)));
    replayProjections(indexer.db);
    expect(indexer.db.lastCheckpoint()).toEqual(checkpoint);
    fetchFn.mockImplementation(async (url: string) => new Response(new Uint8Array(url.endsWith(toBase64url(ref.digest)) ? bytes : profile)));
    expect((await indexer.api.inject({ method: "GET", url: path })).json()).toMatchObject({ envelope: toBase64url(bytes), contentHash: toBase64url(ref.digest) });
    const people = (await indexer.api.inject({ method: "GET", url: "/v1/people?query=Hosted" })).json();
    expect(people.items).toHaveLength(1);
    expect(people.items[0].profileUri).toBe(`data:application/x-osp-profile;base64,${toBase64url(profile)}`);
    expect(indexer.db.lastCheckpoint()).toEqual(checkpoint);
  } finally { await indexer.close(); }
});
