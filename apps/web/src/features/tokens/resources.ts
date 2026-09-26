import type { TokenAccount } from "@osp/sdk";

/** Interpret exact v2 fields without combining separately rounded legacy fields. */
export function tokenResources(account?: TokenAccount) {
  const v2 = Number(account?.resource_version ?? 0) === 2;
  const ready = account ? BigInt(v2 ? account.transferable ?? "0" : account.balance) : 0n;
  const precision = BigInt(v2 ? account?.ticks_per_unit || "144000" : "1000");
  if (precision <= 0n) throw new Error("Invalid token resource precision");
  const free = BigInt(v2 ? account?.free_ticks ?? "0" : account?.free_credits ?? "0");
  const paid = BigInt(v2 ? account?.token_ticks ?? "0" : account?.token_credits ?? "0");
  return { v2, ready, precision, free, paid, actions: (free + paid) / precision };
}

/** Never display a rounded-up whole action before the chain makes it usable. */
export function capacityLabel(ticks: bigint, precision: bigint): string {
  const thousandths = ticks * 1000n / precision;
  return `${thousandths / 1000n}.${(thousandths % 1000n).toString().padStart(3, "0")}`;
}
