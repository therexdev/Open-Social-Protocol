import { expect, it, vi } from "vitest";
import { RELATIONSHIP_STATUS as status } from "@osp/sdk";
import { threadFriends } from "./replyAudience";
const fixture = (friends: string[], proposed = friends) => {
  const get_relationship = vi.fn(async ({ a, b }:{a:string;b:string}) => ({value: {status: a === "author" && friends.includes(b) ? status.ACTIVE : status.INACTIVE}}));
  const chain = { reads: { relationships: { get_audience: async () => ({ value: { epoch: 3 } }), get_relationship } } };
  const graph = vi.fn(async () => ({ friends: proposed.map(account => ({account})) }));
  return { chain, graph };
};
it("encrypts thread replies for verified friends of the original author only", async () => {
  const {chain,graph} = fixture(["me", "alice"],["alice","stranger","alice","me"]);
  expect(await threadFriends(chain as never,{graph} as never,"author","me")).toEqual({epoch:3,selected:["author","alice"]});
  expect(graph).toHaveBeenCalledWith("author");
});
it("rejects removed readers and oversized key lists", async () => {
  const {chain,graph} = fixture(["alice"],["former"]);
  await expect(threadFriends(chain as never,{graph} as never,"author","former")).rejects.toThrow(/current friends/);
  const big = fixture(Array.from({length:52},(_,i)=>"reader"+i));
  await expect(threadFriends(big.chain as never,{graph:big.graph} as never,"author","author")).rejects.toThrow(/50/);
});
