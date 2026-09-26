import { describe, expect, it } from "vitest";
import { identityFromSeed, toBase64url } from "@osp/sdk";
import { IndexerDb, KoinosChain, createIndexer, loadConfig, replayProjections } from "./index.js";
import { ChainBuilder, FakeProvider, testDeployment, ospEvent, tx } from "./testing/fake-chain.js";
import { promotions, postEconomy } from "./queries.js";
const alice=identityFromSeed(new Uint8Array(32).fill(21)),bob=identityFromSeed(new Uint8Array(32).fill(22));
const id=new Uint8Array(32).fill(7), version=new Uint8Array(32).fill(8);
describe("economy projections",()=>{
  it("replays votes, reserves, settlements and campaigns deterministically; hides invalid placements",async()=>{
    const deployment=testDeployment(),builder=new ChainBuilder(deployment),when=String(builder.baseTimestamp);
    const epoch={id:"1",start_block:"1",end_block:"144001",budget:"100",total_score:"500",total_weight:"1",post_count:"1",settled_count:"0",paid:"0"};
    const reward={post_id:id,version,author:bob.account,epoch:"1",up:"1",down:"0",score:"500",settled:false,reward:"0"};
    const promo={post_id:id,version,author:bob.account,nonce:"1",slot:0,start_block:"1",end_block:"2401",interval:"1200",opportunities:2,burned:"2",cancelled:false};
    builder.block([tx([
      ospEvent(deployment,"osp.publications.published",{author:bob.account,post_id:id,content_hash:version,previous_version:new Uint8Array(),version_number:1,sequence:"0",audience:0,audience_id:new Uint8Array(),epoch:0,envelope:new Uint8Array([1]),media:[],reply_to:new Uint8Array(),idempotency_key:new Uint8Array([1]),protocol_version:1,timestamp:when},[bob.account]),
      ospEvent(deployment,"osp.token.economy_activated",{value:{version:1,activation_block:"1",period_blocks:"144000",period_budget:"100"}},[]),
      ospEvent(deployment,"osp.token.voted",{actor:alice.account,value:reward,vote:{direction:1,weight:"1",block:"1"},epoch,timestamp:when},[alice.account,bob.account]),
      ospEvent(deployment,"osp.token.promotion_changed",{value:promo,timestamp:when},[bob.account]),
    ])]);
    const config=loadConfig({OSP_NETWORK:"test",OSP_INDEXER_DB:":memory:"},{deployment});
    const indexer=createIndexer({config,db:IndexerDb.memory(),chain:new KoinosChain(new FakeProvider(builder),deployment)});
    try {
      await indexer.syncer!.syncToHead();
      const before=postEconomy(indexer.db,toBase64url(id),alice.account);
      expect(before.reward?.up).toBe("1"); expect(before.vote?.direction).toBe(1); expect(before.promotion?.nonce).toBe("1");
      const activity=(await indexer.api.inject({method:"GET",url:`/v1/token/${bob.account}/activity`})).json();
      expect(activity.items.some((a:{kind:string})=>a.kind==="osp.token.voted")).toBe(true);
      replayProjections(indexer.db);
      expect(postEconomy(indexer.db,toBase64url(id),alice.account)).toEqual(before);
      expect(promotions(indexer.db,alice.account)).toHaveLength(1);
      expect(promotions(indexer.db,alice.account,"friends")).toEqual([]);
      expect(promotions(indexer.db,bob.account,"friends")).toHaveLength(1);
      indexer.db.run("INSERT INTO blocks_list VALUES (?,?,?)",bob.account,alice.account,"1");
      expect(promotions(indexer.db,alice.account)).toEqual([]); // Author blocked viewer: both directions are respected.
      replayProjections(indexer.db);
      for (const mutation of ["state=2","audience=1","content_hash='edited'"]) {
        indexer.db.run(`UPDATE posts SET ${mutation} WHERE post_id=?`,toBase64url(id));
        expect(promotions(indexer.db,alice.account)).toEqual([]);
        replayProjections(indexer.db);
      }
      indexer.db.run("UPDATE token_promotions SET data_json=json_set(data_json,'$.cancelled',json('true'))");
      expect(promotions(indexer.db,alice.account)).toEqual([]);
      replayProjections(indexer.db);
      const status=(await indexer.api.inject({method:"GET",url:"/v1/status"})).json();
      expect(status.features.tokenEconomy).toBe(1);
      expect((await indexer.api.inject({method:"GET",url:"/v1/promotions?scope=invalid"})).statusCode).toBe(400);
      builder.block([tx([ospEvent(deployment,"osp.token.reward_settled",{actor:alice.account,value:{...reward,settled:true,reward:"100"},epoch:{...epoch,settled_count:"1",paid:"100"},timestamp:when},[alice.account,bob.account])])]);
      await indexer.syncer!.syncToHead();
      expect(postEconomy(indexer.db,toBase64url(id)).reward?.settled).toBe(true);
      replayProjections(indexer.db);
      expect(postEconomy(indexer.db,toBase64url(id)).reward?.reward).toBe("100");
    } finally { await indexer.close(); }
  });
});
