// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ProtocolClient, identityFromSeed } from "@osp/sdk";
import { fakeProvider, fixtureDeployment } from "../testing/fixtures";
import { useToasts } from "../stores/toasts";
import { ActionError, NO_SPONSOR_MESSAGE, paymentBlocker, submitAction } from "./submit";

const me = identityFromSeed(new Uint8Array(32).fill(7));

describe("submitAction payment preference", () => {
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
