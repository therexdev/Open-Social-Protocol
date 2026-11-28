// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { InsufficientManaError, SponsorError, TransactionOutcomeUnknownError, identityFromSeed, ProtocolClient } from "@osp/sdk";
import { useUsagePrompt } from "../stores/usagePrompt";
import { useSettings } from "../stores/settings";
import { fakeProvider, fixtureDeployment } from "../testing/fixtures";
import { usageLimitKind, presentUsageLimit } from "./usageLimit";
import { submitAction } from "./submit";
import { useToasts } from "../stores/toasts";
const me = identityFromSeed(new Uint8Array(32).fill(5));
afterEach(() => { useUsagePrompt.setState({ notice: undefined, dismissed: {} }); useToasts.getState().clear(); });
it("separates a daily cap, a shared pool shortage, and an unfunded account", () => {
  expect(usageLimitKind(new SponsorError("quota_exceeded", "Daily sponsored Mana allowance exhausted; it resets at 00:00 UTC"))).toBe("daily");
  expect(usageLimitKind(new SponsorError("temporarily_unavailable", "Sponsor Mana pool is busy or depleted; your daily allowance has not been charged"))).toBe("service");
  expect(usageLimitKind(new InsufficientManaError(me.account))).toBe("account");
});
it("does not mistake burst, offline, per-transaction limits or unknown outcomes for exhausted free usage", () => {
  for (const error of [new SponsorError("quota_exceeded", "burst quota of 180 operations per 60s reached"), new SponsorError("temporarily_unavailable", "sponsor unreachable"), new Error("rc limit exceeded"), new TransactionOutcomeUnknownError({ id: "maybe-sent" }, { id: "maybe-sent", rpc_error: "insufficient mana" } as any), new SponsorError("invalid_transaction", "invalid account nonce")]) expect(usageLimitKind(error)).toBeUndefined();
});
it("opens the limit dialog on a rejected action without broadcasting or changing who pays", async () => {
  const provider = fakeProvider({ rc: { [me.account]: "0" } });
  const client = new ProtocolClient({ rpc: provider, deployment: fixtureDeployment() });
  useSettings.getState().update({ payment: "sponsor-only" });
  const op = await client.ops.relationships.follow({ follower: me.account, target: me.account });
  await expect(submitAction({ client, signer: me.signer, payment: "self-only" }, [op], { label: "Following" })).rejects.toThrow("recharged capacity");
  expect(provider.sent).toHaveLength(0); expect(useSettings.getState().payment).toBe("sponsor-only");
  expect(useUsagePrompt.getState().notice).toMatchObject({ kind: "account", payer: me.signer.getAddress(), chainId: client.chainId, canUseOwnAccount: true });
});
it("never offers an alias as a funding destination and suppresses repeated background prompts", () => {
  const client = new ProtocolClient({ rpc: fakeProvider(), deployment: fixtureDeployment() });
  const alias = identityFromSeed(new Uint8Array(32).fill(6));
  const ctx = { client, signer: alias.signer, payment: "sponsor-only" as const, contentSigner: { account: me.account, signer: me.signer } };
  const error = new SponsorError("quota_exceeded", "Daily sponsored Mana allowance exhausted");
  presentUsageLimit(error, ctx, true);
  expect(useUsagePrompt.getState().notice).toMatchObject({ payer: me.account, canUseOwnAccount: false });
  useUsagePrompt.getState().close(); presentUsageLimit(error, ctx, true);
  expect(useUsagePrompt.getState().notice).toBeUndefined();
  presentUsageLimit(error, ctx, false); expect(useUsagePrompt.getState().notice).toBeTruthy();
});
