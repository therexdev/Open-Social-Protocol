import { expect, it } from "vitest";
import { defaultSettings, resolveSettings, sanitizeSettings } from "./settings";
const env = { network: "harbinger", rpcUrls: [], indexerUrl: "", sponsorUrls: [] };
it("defaults attribution on for fresh and upgraded installs and persists an explicit opt-out", () => {
  expect(defaultSettings().facebookAttribution).toBe(true);
  expect(sanitizeSettings({ facebookAdapter: true }).facebookAttribution).toBe(true);
  expect(sanitizeSettings({ facebookAttribution: false }).facebookAttribution).toBe(false);
});
it("ships service defaults for fresh installs and existing saved empty overrides without environment variables", () => {
  for (const settings of [defaultSettings(env), sanitizeSettings({ network: "harbinger", indexerUrl: "", sponsorUrls: [] }, defaultSettings(env))]) {
    const resolved = resolveSettings(settings, { env });
    expect(resolved.indexerUrl).toBe("https://social-api.usekoinos.com");
    expect(resolved.sponsorUrls).toEqual(["https://social-sponsor.usekoinos.com"]);
    expect(resolved.payment).toBe("sponsor-then-self");
  }
  const mainnet = resolveSettings({ ...defaultSettings(env), network: "mainnet" }, { env });
  expect(mainnet.sponsorUrls).not.toContain("https://social-sponsor.usekoinos.com");
});
it("preserves explicit custom endpoints and payment preferences", () => {
  const resolved = resolveSettings({ ...defaultSettings(env), indexerUrl: "https://custom.test", sponsorUrls: ["https://sponsor.test"], payment: "self-only" }, { env });
  expect(resolved.indexerUrl).toBe("https://custom.test");
  expect(resolved.sponsorUrls).toEqual(["https://sponsor.test"]);
  expect(resolved.payment).toBe("self-only");
});
