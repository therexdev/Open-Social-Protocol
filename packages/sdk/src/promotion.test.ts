import { describe, it, expect } from "vitest";
import { eligiblePromotion, insertPromotions, promotionKey, type PromotionCandidate } from "./promotion.js";
import { toBase64url } from "./encoding.js";
import type { Promotion } from "./client/types.js";
const id = new Uint8Array(32).fill(1), version = new Uint8Array(32).fill(2);
const post: PromotionCandidate = {postId:toBase64url(id),contentHash:toBase64url(version),author:"author",audience:0,state:0};
const campaign: Promotion = {post_id:id,version,author:"author",nonce:"1",slot:0,start_block:"100",end_block:"2500",interval:"1200",opportunities:2,burned:"2",cancelled:false};
describe("canonical promotion placement", () => {
  it("accepts the exact public version only during its purchased window", () => {
    expect(eligiblePromotion(post,[campaign],100n)?.promoted).toEqual({nonce:"1",opportunity:"0"});
    expect(eligiblePromotion(post,[campaign],1300n)?.promoted?.opportunity).toBe("1");
    for (const block of [99n,2500n]) expect(eligiblePromotion(post,[campaign],block)).toBeUndefined();
    for (const patch of [{audience:1},{state:2},{author:"other"},{contentHash:"changed"}]) expect(eligiblePromotion({...post,...patch},[campaign],101n)).toBeUndefined();
    expect(eligiblePromotion(post,[{...campaign,cancelled:true}],101n)).toBeUndefined();
    expect(eligiblePromotion(post,[campaign],101n,["author"])).toBeUndefined();
  });
  it("preserves organic order, bounds frequency and deduplicates paid/organic posts", () => {
    const organic = Array.from({length:25},(_,i)=>({...post,postId:`organic-${i}`}));
    const promoted = eligiblePromotion(post,[campaign],100n)!;
    const candidates = [promoted,{...promoted,postId:"promo-2"},{...promoted,postId:"promo-3"}];
    const mixed = insertPromotions(organic,candidates,new Set());
    expect(mixed.filter(p=>!p.promoted)).toEqual(organic);
    expect(mixed.filter(p=>p.promoted)).toHaveLength(2);
    expect(mixed[3]).toEqual(promoted); expect(mixed[14]?.postId).toBe("promo-2");
    expect(insertPromotions([post,...organic],candidates,new Set()).filter(p=>p.postId===post.postId)).toHaveLength(1);
    expect(insertPromotions(organic,[promoted],new Set([promotionKey(promoted)]))).toEqual(organic);
    expect(promotionKey({...promoted,promoted:{nonce:"1",opportunity:"1"}})).not.toBe(promotionKey(promoted));
  });
});
