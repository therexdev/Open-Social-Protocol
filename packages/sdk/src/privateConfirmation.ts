/** Testnet transport policy. Real-value networks retain full irreversibility. */
export function privateConfirmationDepth(network: string): number {
  return network === "harbinger" ? 3 : 0;
}

export function privateConfirmationHeight(
  head: { head_topology?: { height: string }; last_irreversible_block: string },
  depth: number,
): bigint {
  const irreversible = BigInt(head.last_irreversible_block);
  if (!depth || !head.head_topology) return irreversible;
  const included = BigInt(head.head_topology.height) - BigInt(depth - 1);
  return included > irreversible ? included : irreversible;
}
