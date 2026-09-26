import { afterEach, describe, expect, it, vi } from "vitest";
import { IndexerClient, type ProfileSummary } from "./indexer";
import { buildProfileDocument } from "./profiles";
const profile = (account: string, name: string): ProfileSummary => ({ account, owner: account, profileUri: buildProfileDocument({ display_name: name }).uri, profileHash: "", encryptionKey: "", keyVersion: 1, registeredAt: "0", updatedAt: "0" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.useRealTimers());
describe("nickname search transport", () => {
  it("uses native search without reading the entire directory", async () => {
    const fetch = vi.fn(async (_url: string) => json({ items: [profile("1A", "Ana")] }));
    const client = new IndexerClient({ baseUrl: "https://test.invalid", fetch });
    expect((await client.searchPeople("Ana"))[0]?.account).toBe("1A");
    expect(fetch.mock.calls.length).toBe(1);
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/v1/people?query=Ana");
  });
  it("searches current public profile names on legacy servers and refreshes cached names", async () => {
    vi.useFakeTimers();
    let name = "Ana María";
    const fetch = vi.fn(async (url: string) => url.includes("/v1/people") ? json({ error: { code: "not_found", message: "Not found" } }, 404) : json({ items: [profile("1A", name), profile("1B", "Other")] }));
    const client = new IndexerClient({ baseUrl: "https://test.invalid", fetch });
    expect((await client.searchPeople("MARIA")).map(x => x.account)).toEqual(["1A"]);
    expect((await client.searchPeople("ana")).map(x => x.account)).toEqual(["1A"]);
    expect(fetch).toHaveBeenCalledTimes(2);
    name = "New Nickname";
    vi.advanceTimersByTime(30_001);
    expect(await client.searchPeople("maria")).toEqual([]);
    expect((await client.searchPeople("new nick")).map(x => x.account)).toEqual(["1A"]);
  });
  it("partitions a full legacy page and finds people beyond the first 100", async () => {
    const page = Array.from({ length: 100 }, (_, i) => profile(`1A${i}`, "First page"));
    const fetch = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/v1/people") return json({}, 404);
      const prefix = u.searchParams.get("query") ?? "";
      expect(prefix).toMatch(/^[1-9A-HJ-NP-Za-km-z]*$/);
      if (!prefix) return json({ items: page });
      return json({ items: prefix === "2" ? [profile("2Z", "Beyond the first page")] : [] });
    });
    const client = new IndexerClient({ baseUrl: "https://test.invalid", fetch });
    expect((await client.searchPeople("beyond")).map(x => x.account)).toEqual(["2Z"]);
    expect(fetch.mock.calls.length).toBeGreaterThan(20);
  });
  it("does not hide real server errors behind a fallback or cache failures forever", async () => {
    const fetch = vi.fn(async () => json({ error: { code: "offline", message: "Server unavailable" } }, 503));
    const client = new IndexerClient({ baseUrl: "https://test.invalid", fetch });
    await expect(client.searchPeople("Ana")).rejects.toThrow("Server unavailable");
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(client.searchPeople("x".repeat(65))).rejects.toThrow("64");
  });
});
