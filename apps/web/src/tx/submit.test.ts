// @vitest-environment node
import { describe, expect, it } from "vitest";
import { InsufficientManaError, ProtocolClient, SponsorError, identityFromSeed } from "@osp/sdk";
import { fakeProvider, fixtureDeployment } from "../testing/fixtures";
import { useToasts } from "../stores/toasts";
import { ActionError, NO_SPONSOR_MESSAGE, humanizeError, paymentBlocker, submitAction, withAccountSubmission, type SubmitContext } from "./submit";

const me = identityFromSeed(new Uint8Array(32).fill(7));

describe("background sharing and user transaction ordering", () => {
  it("queues a user action behind key sharing for the same account, even after an endpoint change", async () => {
    const provider = fakeProvider();
    const client = new ProtocolClient({ rpc: provider, deployment: fixtureDeployment() });
    const ctx: SubmitContext = { client, signer: me.signer, payment: "self-only" };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const background = withAccountSubmission(ctx, async () => { started(); await blocked; });
    await ready;
    const operation = await client.ops.relationships.follow({ follower: me.account, target: me.account });
    const nextClient = new ProtocolClient({ rpc: provider, deployment: fixtureDeployment() });
    const userAction = submitAction({ ...ctx, client: nextClient }, [operation], { label: "Following" });
    await Promise.resolve();
    expect(provider.sent).toHaveLength(0);
    release();
    await Promise.all([background, userAction]);
    expect(provider.sent).toHaveLength(1);
  });

  it("does not leave user actions blocked when background sharing fails", async () => {
    const provider = fakeProvider();
    const client = new ProtocolClient({ rpc: provider, deployment: fixtureDeployment() });
    const ctx: SubmitContext = { client, signer: me.signer, payment: "self-only" };
    await expect(withAccountSubmission(ctx, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    const operation = await client.ops.relationships.follow({ follower: me.account, target: me.account });
    await submitAction(ctx, [operation], { label: "Following" });
    expect(provider.sent).toHaveLength(1);
  });
});

describe("submitAction payment preference", () => {
  it("explains a stale friend removal instead of suggesting a network change", () => {
    const error = new SponsorError("invalid_transaction", "transaction reverted: not friends");
    expect(humanizeError(error)).toContain("no longer friends");
    expect(humanizeError(error)).not.toContain("Check the network");
  });
  it("explains a sponsor refusal instead of hiding it behind a zero-Mana RPC error", () => {
    const error = new InsufficientManaError(me.account, [{
      endpoint: "https://sponsor.test", error: new SponsorError("quota_exceeded", "daily allowance exhausted"),
    }]);
    expect(humanizeError(error)).toContain("free allowance from the sponsor is used up");
    expect(humanizeError(error)).toContain("also has no Mana");
  });

  it("stops an unfunded self-payment before it reaches the RPC", async () => {
    const provider = fakeProvider({ rc: { [me.account]: "0" } });
    const client = new ProtocolClient({ rpc: provider, deployment: fixtureDeployment() });
    const operation = await client.ops.relationships.follow({ follower: me.account, target: me.account });
    await expect(submitAction({ client, signer: me.signer, payment: "self-only" }, [operation], { label: "Following" })).rejects.toThrow("no Mana available");
    expect(provider.sent).toHaveLength(0);
    expect(useToasts.getState().toasts.some((t) => t.message?.includes("Add a funded sponsor"))).toBe(true);
  });

  it("refuses to self-pay under 'sponsors only' when no sponsor is configured", async () => {
    const provider = fakeProvider();
    const client = new ProtocolClient({ rpc: provider, deployment: fixtureDeployment() });
    const op = await client.ops.relationships.follow({ follower: me.account, target: me.account });
    await expect(submitAction({ client, signer: me.signer, payment: "sponsor-only" }, [op], { label: "Following" })).rejects.toThrow(ActionError);
    await expect(submitAction({ client, signer: me.signer, payment: "sponsor-only" }, [op], { label: "Following" })).rejects.toThrow(NO_SPONSOR_MESSAGE);
    expect(provider.sent).toHaveLength(0);
    expect(useToasts.getState().toasts.some((t) => t.message === NO_SPONSOR_MESSAGE)).toBe(true);
    // the other preferences still submit (self-pay through the fake node)
    const result = await submitAction({ client, signer: me.signer, payment: "sponsor-then-self" }, [op], { label: "Following" });
    expect(result.sponsored).toBe(false);
    expect(provider.sent).toHaveLength(1);
  });

  it("explains the blocker for the UI", () => {
    expect(paymentBlocker("sponsor-only", 0)).toBe(NO_SPONSOR_MESSAGE);
    expect(paymentBlocker("sponsor-only", 1)).toBeUndefined();
    expect(paymentBlocker("sponsor-then-self", 0)).toBeUndefined();
    expect(paymentBlocker("self-only", 0)).toBeUndefined();
  });
});
