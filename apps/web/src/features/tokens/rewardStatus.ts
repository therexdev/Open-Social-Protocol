import type { PostReward } from "@osp/sdk";

/** A closed voting window is still pending until the contract records settlement. */
export function rewardStatus(reward: Pick<PostReward, "settled" | "reward">, automaticSettlement: boolean, endBlock?: string, block?: string): string {
  if (reward.settled) {
    return reward.reward === "0" ? "Settled with no OSAT payout." : `${reward.reward} OSAT credited to the author.`;
  }
  if (!automaticSettlement) return "Reward pending. This network needs the automatic settlement upgrade.";
  if (!endBlock || !block) return "Reward pending.";
  if (BigInt(block) >= BigInt(endBlock)) return "Voting has closed. Awaiting automatic settlement.";
  return `Voting closes at block ${endBlock}. Eligible OSAT is credited automatically after voting closes.`;
}
