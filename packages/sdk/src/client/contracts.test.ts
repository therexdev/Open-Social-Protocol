import { describe, expect, it, vi } from "vitest";
import { ProtocolContracts } from "./contracts.js";
import { fakeProvider, fixtureDeployment } from "../testing/fixtures.js";

describe("empty contract read results", () => {
  it.each([{}, { result: "" }])("decodes default values from a successful %j response", async response => {
    const provider = fakeProvider();
    provider.readContract = vi.fn(async () => response as any);
    const deployment = fixtureDeployment();
    const contracts = new ProtocolContracts(deployment, provider);
    const account = deployment.contracts.identity.address;
    expect(await contracts.reads.messaging.get_private_devices({ account })).toEqual({ values: [] });
    expect(await contracts.reads.messaging.get_private_units({ account })).toEqual({ units: "0" });
    expect(await contracts.reads.relationships.is_blocked({ actor: account, target: account })).toEqual({ value: false });
    expect(await contracts.reads.identity.get_identity({ account })).toEqual({});
    expect(await contracts.reads.messaging.get_private_channel({ a: account, b: account })).toEqual({});
  });

  it("does not turn a failed RPC or malformed response into a valid empty directory", async () => {
    const provider = fakeProvider();
    const deployment = fixtureDeployment();
    const contracts = new ProtocolContracts(deployment, provider);
    const args = { account: deployment.contracts.identity.address };
    provider.readContract = vi.fn().mockRejectedValue(new Error("RPC unavailable"));
    await expect(contracts.reads.messaging.get_private_devices(args)).rejects.toThrow("RPC unavailable");
    for (const reply of [null, undefined, [], { result: null }, { result: 17 }]) {
      provider.readContract = vi.fn().mockResolvedValue(reply);
      await expect(contracts.reads.messaging.get_private_devices(args)).rejects.toThrow("invalid response");
    }
    provider.readContract = vi.fn().mockResolvedValue({ result: "Cg==" });
    await expect(contracts.reads.messaging.get_private_devices(args)).rejects.toThrow("cannot decode");
  });
});
