import { describe, expect, it } from "vitest";
import { ABIS } from "@osp/proto";
import { ACTOR_FIELDS, Allowlist, PolicyError, actorField, buildAllowlist, defaultAllowlist, discoveryPolicy, parseAllowlist } from "./policy.js";
import { fixtureDeployment } from "./__tests__/helpers.js";

const deployment = fixtureDeployment();

describe("default allowlist", () => {
  it("covers every write method of the four social contracts except the admin setters", () => {
    const entries = defaultAllowlist(deployment);
    const names = entries.map((e) => `${e.contract}.${e.method}`);
    expect(names).toHaveLength(31);
    expect(names).toContain("identity.register");
    expect(names).toContain("relationships.follow");
    expect(names).toContain("publications.publish");
    expect(names).toContain("communities.set_label");
    expect(names).not.toContain("relationships.set_identity_contract");
    expect(names).not.toContain("publications.set_identity_contract");
    expect(names).not.toContain("publications.set_relationships_contract");
    expect(names).not.toContain("communities.set_identity_contract");
    expect(names.some((n) => n.startsWith("sponsorship."))).toBe(false);
    expect(names.some((n) => n.startsWith("registry."))).toBe(false);
    for (const entry of entries) {
      expect(ABIS[entry.contract].methods[entry.method]?.read_only).toBe(false);
      expect(entry.address).toBe(deployment.contracts[entry.contract].address);
    }
  });

  it("indexes by contract address and entry point", () => {
    const allowlist = buildAllowlist(deployment);
    const publish = ABIS.publications.methods.publish!;
    expect(allowlist.has(deployment.contracts.publications.address, publish.entry_point)).toBe(true);
    expect(allowlist.lookup(deployment.contracts.publications.address, publish.entry_point)?.method).toBe("publish");
    expect(allowlist.has(deployment.contracts.publications.address, ABIS.publications.methods.get_post!.entry_point)).toBe(false);
    expect(allowlist.has(deployment.contracts.identity.address, publish.entry_point)).toBe(false);
    expect(allowlist.has(deployment.contracts.sponsorship.address, ABIS.sponsorship.methods.set_sponsor!.entry_point)).toBe(false);
    const discovery = allowlist.toDiscovery();
    expect(discovery).toHaveLength(4);
    const calls = allowlist.toAllowedCalls();
    expect(calls.map((c) => c.contract_id).sort()).toEqual(discovery.map((d) => d.contract).sort());
    expect(calls.every((c) => c.entry_points.length > 0)).toBe(true);
    const policy = discoveryPolicy(allowlist, { version: 2, maxBytesPerOp: 10, maxRcPerOp: "5", maxOpsPerTx: 3, dailyOps: 1, burstOps: 1, burstWindowSec: 1 });
    expect(policy.version).toBe(2);
    expect(policy.perUser).toEqual({ dailyOps: 1, burstOps: 1, burstWindowSec: 1 });
    expect(policy.allowed).toEqual(discovery);
  });
});

describe("allowlist override", () => {
  it("parses contract:method entries and wildcards", () => {
    const entries = parseAllowlist("publications:publish, relationships:follow\nrelationships:follow", deployment);
    expect(entries.map((e) => `${e.contract}.${e.method}`)).toEqual(["publications.publish", "relationships.follow"]);
    const wildcard = parseAllowlist("publications:*", deployment);
    expect(wildcard.map((e) => e.method).sort()).toEqual(["distribute_keys", "publish", "react", "record_cross_post", "set_lifecycle"]);
    const sponsorship = parseAllowlist("sponsorship:set_user_grant", deployment);
    expect(sponsorship[0]?.entryPoint).toBe(ABIS.sponsorship.methods.set_user_grant?.entry_point);
  });

  it("rejects unknown, read-only and malformed entries", () => {
    expect(() => parseAllowlist("", deployment)).toThrow(PolicyError);
    expect(() => parseAllowlist("publications", deployment)).toThrow(/contract:method/);
    expect(() => parseAllowlist("nope:publish", deployment)).toThrow(/unknown contract/);
    expect(() => parseAllowlist("publications:nope", deployment)).toThrow(/no method/);
    expect(() => parseAllowlist("publications:get_post", deployment)).toThrow(/read-only/);
    expect(() => parseAllowlist("publications:publish:extra", deployment)).toThrow(/contract:method/);
  });
});

describe("actor fields", () => {
  it("names the signing account for every default-allowlisted method", () => {
    for (const entry of defaultAllowlist(deployment)) {
      expect(ACTOR_FIELDS[entry.contract]?.[entry.method], `${entry.contract}.${entry.method}`).not.toBeUndefined();
    }
    expect(actorField("publications", "publish", {})).toBe("author");
    expect(actorField("relationships", "accept_friend", {})).toBe("approver");
    expect(actorField("identity", "propose_recovery", {})).toBe("guardian");
    expect(actorField("identity", "execute_recovery", {})).toBeNull();
    expect(actorField("communities", "execute_owner_transfer", {})).toBeNull();
    // fallback for methods without an explicit entry
    expect(actorField("registry", "propose_contract", { name: "x", owner: "1abc" })).toBe("owner");
    expect(actorField("registry", "init", { admin: "1abc" })).toBeNull();
  });

  it("keeps an empty Allowlist harmless", () => {
    const empty = new Allowlist([]);
    expect(empty.has(deployment.contracts.publications.address, 1)).toBe(false);
    expect(empty.toDiscovery()).toEqual([]);
    expect(empty.describe()).toEqual([]);
  });
});
