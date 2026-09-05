import { describe, expect, it } from "vitest";
import { ABIS } from "@osp/proto";
import { ProtocolClient, Signer, encode, type SponsorRecord } from "@osp/sdk";
import { buildAllowlist } from "./policy.js";
import { desiredRecord, ensureRegistered, recordMatches } from "./register.js";
import { fakeProvider, fixtureDeployment, type FakeProviderOptions } from "./__tests__/helpers.js";

const deployment = fixtureDeployment();
const sponsorSigner = Signer.fromSeed("osp-sponsor-register-test");
const sponsor = sponsorSigner.getAddress();
const allowlist = buildAllowlist(deployment);
const limits = { version: 3, maxBytesPerOp: 6144, maxRcPerOp: "200000000", maxOpsPerTx: 4, dailyOps: 200, burstOps: 20, burstWindowSec: 60 };
const desired = desiredRecord({ sponsor, publicUrl: "https://sponsor.example.org/", allowlist, limits });

function onChain(overrides: Partial<SponsorRecord> = {}): SponsorRecord {
  return {
    sponsor,
    endpoint: "https://sponsor.example.org",
    policy_uri: "https://sponsor.example.org/.well-known/osp-sponsor.json",
    policy_version: 3,
    allowed: allowlist.toAllowedCalls(),
    max_rc_per_op: "200000000",
    max_ops_per_user_per_day: 200,
    max_bytes_per_op: 6144,
    active: true,
    registered_at: "1000",
    updated_at: "2000",
    ...overrides,
  };
}

function setup(options: FakeProviderOptions = {}) {
  const provider = fakeProvider({ rc: { [sponsor]: "900000000" }, ...options });
  const client = new ProtocolClient({ rpc: provider, deployment });
  const logs: string[] = [];
  return { provider, client, logs, log: (m: string) => logs.push(m) };
}

const getSponsorEntryPoint = ABIS.sponsorship.methods.get_sponsor!.entry_point;

describe("desiredRecord / recordMatches", () => {
  it("describes the policy for set_sponsor", () => {
    expect(desired.sponsor).toBe(sponsor);
    expect(desired.endpoint).toBe("https://sponsor.example.org");
    expect(desired.policy_uri).toBe("https://sponsor.example.org/.well-known/osp-sponsor.json");
    expect(desired.policy_version).toBe(3);
    expect(desired.allowed).toHaveLength(4);
    expect(desired.max_rc_per_op).toBe("200000000");
    expect(desired.max_ops_per_user_per_day).toBe(200);
    expect(desired.max_bytes_per_op).toBe(6144);
    expect(desired.active).toBe(true);
  });

  it("compares the on-chain record ignoring timestamps and ordering", () => {
    expect(recordMatches(undefined, desired)).toBe(false);
    expect(recordMatches(onChain(), desired)).toBe(true);
    const reordered = onChain({ allowed: [...allowlist.toAllowedCalls()].reverse().map((c) => ({ ...c, entry_points: [...c.entry_points].reverse() })) });
    expect(recordMatches(reordered, desired)).toBe(true);
    expect(recordMatches(onChain({ endpoint: "https://other.example.org" }), desired)).toBe(false);
    expect(recordMatches(onChain({ policy_version: 2 }), desired)).toBe(false);
    expect(recordMatches(onChain({ active: false }), desired)).toBe(false);
    expect(recordMatches(onChain({ max_rc_per_op: "1" }), desired)).toBe(false);
    expect(recordMatches(onChain({ allowed: allowlist.toAllowedCalls().slice(1) }), desired)).toBe(false);
  });
});

describe("ensureRegistered", () => {
  it("does nothing when the on-chain record already matches", async () => {
    const { client, provider, log } = setup({
      onRead: (op) => (op.entry_point === getSponsorEntryPoint ? encode("sponsorship.get_sponsor_result", { value: onChain() }) : undefined),
    });
    const result = await ensureRegistered({ client, signer: sponsorSigner, desired, log });
    expect(result).toEqual({ status: "unchanged", sponsor });
    expect(provider.sent).toHaveLength(0);
  });

  it("submits a self-paid set_sponsor when the record is missing or stale", async () => {
    const { client, provider, logs, log } = setup({ onSend: () => ({ rc_used: "4321" }) });
    const result = await ensureRegistered({ client, signer: sponsorSigner, desired, log });
    expect(result.status).toBe("registered");
    if (result.status === "registered") expect(result.rcUsed).toBe("4321");
    expect(provider.sent).toHaveLength(1);
    const sent = provider.sent[0]!;
    expect(sent.broadcast).toBe(true);
    expect(sent.transaction.header?.payer).toBe(sponsor);
    expect(sent.transaction.header?.payee).toBeUndefined();
    expect(await Signer.recoverAddresses(sent.transaction)).toEqual([sponsor]);
    const decoded = client.contracts.decodeOperation(sent.transaction.operations![0]!);
    expect(decoded?.contract).toBe("sponsorship");
    expect(decoded?.method).toBe("set_sponsor");
    expect(decoded?.args.endpoint).toBe("https://sponsor.example.org");
    expect(decoded?.args.policy_version).toBe(3);
    expect((decoded?.args.allowed as unknown[]).length).toBe(4);
    expect(logs.some((l) => /creating on-chain sponsor record/.test(l))).toBe(true);

    // stale record -> update
    const stale = setup({
      onRead: (op) => (op.entry_point === getSponsorEntryPoint ? encode("sponsorship.get_sponsor_result", { value: onChain({ policy_version: 1 }) }) : undefined),
    });
    const updated = await ensureRegistered({ client: stale.client, signer: sponsorSigner, desired, log: stale.log });
    expect(updated.status).toBe("registered");
    expect(stale.logs.some((l) => /updating on-chain sponsor record/.test(l))).toBe(true);
  });

  it("reports reverted registrations and unreachable RPCs without throwing", async () => {
    const reverted = setup({ onSend: () => ({ reverted: true, logs: ["endpoint must use https"] }) });
    const result = await ensureRegistered({ client: reverted.client, signer: sponsorSigner, desired, log: reverted.log });
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.error).toMatch(/endpoint must use https/);

    const provider = fakeProvider();
    provider.readContract = async () => {
      throw new Error("fetch failed: ENOTFOUND harbinger-api.koinos.io");
    };
    const client = new ProtocolClient({ rpc: provider, deployment });
    const logs: string[] = [];
    const down = await ensureRegistered({ client, signer: sponsorSigner, desired, log: (m) => logs.push(m) });
    expect(down.status).toBe("failed");
    if (down.status === "failed") expect(down.error).toMatch(/ENOTFOUND/);
    expect(logs.some((l) => /registration skipped/.test(l))).toBe(true);
    expect(provider.sent).toHaveLength(0);
  });
});
