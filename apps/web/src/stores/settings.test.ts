import { describe, expect, it } from "vitest";
import { createSettingsStore, resolveSettings, SETTINGS_KEY } from "./settings";
import { buildDeploymentRegistry } from "../config";
import { memoryStringStorage } from "../util/webStorage";
import { fixtureDeployment } from "../testing/fixtures";

const env = { network: "harbinger", rpcUrls: [], indexerUrl: "", sponsorUrls: [] };

describe("settings store", () => {
  it("persists overrides to storage and restores them", () => {
    const storage = memoryStringStorage();
    const store = createSettingsStore({ storage, env });
    expect(store.getState().network).toBe("harbinger");
    store.getState().update({ indexerUrl: "https://indexer.example.org/", sponsorUrls: ["https://sponsor.example.org"], payment: "self-only" });
    const raw = storage.getItem(SETTINGS_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toMatchObject({ indexerUrl: "https://indexer.example.org/", payment: "self-only" });
    const restored = createSettingsStore({ storage, env });
    expect(restored.getState().sponsorUrls).toEqual(["https://sponsor.example.org"]);
    expect(restored.getState().payment).toBe("self-only");
    restored.getState().reset();
    expect(restored.getState().indexerUrl).toBe("");
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!).indexerUrl).toBe("");
  });

  it("ignores corrupted storage", () => {
    const storage = memoryStringStorage();
    storage.setItem(SETTINGS_KEY, "{not json");
    const store = createSettingsStore({ storage, env });
    expect(store.getState().network).toBe("harbinger");
    storage.setItem(SETTINGS_KEY, JSON.stringify({ network: 5, payment: "bogus", rpcUrls: "x" }));
    const again = createSettingsStore({ storage, env });
    expect(again.getState().network).toBe("harbinger");
    expect(again.getState().payment).toBe("sponsor-then-self");
    expect(again.getState().rpcUrls).toEqual([]);
  });

  it("reports the not-deployed state when no manifest exists for the network", () => {
    const store = createSettingsStore({ storage: memoryStringStorage(), env });
    const resolved = resolveSettings(store.getState(), { deployments: {}, deploymentErrors: {}, env });
    expect(resolved.deployed).toBe(false);
    expect(resolved.deployment).toBeUndefined();
    expect(resolved.deploymentMessage).toContain("not deployed on harbinger");
    expect(resolved.rpcUrls).toEqual(["https://harbinger-api.koinos.io", "https://api.harbinger.koinos.pro"]);
    expect(resolved.indexerUrl).toBe("");
  });

  it("selects the deployment for the network and applies defaults and overrides", () => {
    const deployment = { ...fixtureDeployment("harbinger"), indexers: ["https://indexer.test/"], sponsors: ["https://sponsor.test"] };
    const store = createSettingsStore({ storage: memoryStringStorage(), env });
    const defaults = resolveSettings(store.getState(), { deployments: { harbinger: deployment }, env });
    expect(defaults.deployed).toBe(true);
    expect(defaults.chainId).toBe(deployment.chainId);
    expect(defaults.rpcUrls).toEqual(deployment.rpc);
    expect(defaults.indexerUrl).toBe("https://indexer.test");
    expect(defaults.sponsorUrls).toEqual(["https://sponsor.test"]);
    store.getState().update({ rpcUrls: ["https://my-node.test"], indexerUrl: "https://my-indexer.test", sponsorUrls: [] });
    const withEnv = resolveSettings(store.getState(), { deployments: { harbinger: deployment }, env: { ...env, sponsorUrls: ["https://env-sponsor.test"] } });
    expect(withEnv.rpcUrls).toEqual(["https://my-node.test"]);
    expect(withEnv.indexerUrl).toBe("https://my-indexer.test");
    expect(withEnv.sponsorUrls).toEqual(["https://env-sponsor.test"]);
    store.getState().update({ network: "localnet" });
    const other = resolveSettings(store.getState(), { deployments: { harbinger: deployment }, env });
    expect(other.deployed).toBe(false);
    expect(other.deploymentMessage).toContain("localnet");
  });

  it("builds the registry from glob results and reports invalid manifests", () => {
    const registry = buildDeploymentRegistry({
      "../../../deployments/harbinger.json": fixtureDeployment("harbinger"),
      "../../../deployments/broken.json": { network: "broken" },
    });
    expect(Object.keys(registry.deployments)).toEqual(["harbinger"]);
    expect(registry.errors.broken).toContain("chainId");
    const resolved = resolveSettings({ ...createSettingsStore({ storage: memoryStringStorage(), env }).getState(), network: "broken" }, { deployments: registry.deployments, deploymentErrors: registry.errors, env });
    expect(resolved.deployed).toBe(false);
    expect(resolved.deploymentMessage).toContain("invalid");
  });
});
