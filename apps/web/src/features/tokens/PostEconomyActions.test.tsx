import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toBase64url } from "@osp/sdk";
import type { PostView } from "../../api/indexer";
const h=vi.hoisted(()=>({me:{account:"alice"},policy:{version:1,max_vote_weight:"1000",promotion_price:"1",promotion_slots:32,max_opportunities:5,promotion_interval:"1200"},getPost:vi.fn(),getAccount:vi.fn(),getBoard:vi.fn(),vote:vi.fn(),promote:vi.fn(),settle:vi.fn(),submit:vi.fn()}));
vi.mock("../session",()=>({useMe:()=>h.me,useCanAct:()=>({ok:true}),useSubmitContext:()=>({client:{ops:{token:{vote:h.vote,promote:h.promote,settle_reward:h.settle}}},signer:{getAddress:()=>h.me.account},payment:"sponsor-only"})}));
vi.mock("../../api/services",()=>{const protocol={reads:{token:{get_post_economy:h.getPost,get_account:h.getAccount,get_promotions:h.getBoard}}};return {useServices:()=>({protocol})};});
vi.mock("./EconomyContext",()=>({useEconomy:()=>({version:1,policy:h.policy})}));
vi.mock("../../tx/submit",()=>({submitAction:h.submit,humanizeError:(e:Error)=>e.message}));
import { PostEconomyActions } from "./PostEconomyActions";
let root:Root|undefined,container:HTMLDivElement;
const id=new Uint8Array(32).fill(1),version=new Uint8Array(32).fill(2);
const post={postId:toBase64url(id),contentHash:toBase64url(version),author:"bob",audience:0,state:0} as PostView;
async function render(p=post){container=document.createElement("div");document.body.append(container);root=createRoot(container);await act(async()=>{root!.render(<PostEconomyActions post={p}/>);});}
async function click(label:string){const button=[...container.querySelectorAll("button")].find(b=>b.textContent?.includes(label));expect(button).toBeTruthy();await act(async()=>{button!.click();});}
function ready(n="10"){return {value:{balance:n,resource_version:2,token_ticks:(BigInt(n)*144000n).toString(),free_ticks:"14400000",ticks_per_unit:"144000",transferable:n,locked:"0",free_credits:"100000",token_credits:"10000",updated_at:"0"}};}
beforeEach(()=>{vi.clearAllMocks();h.me.account="alice";h.getPost.mockResolvedValue({block:"100"});h.getAccount.mockResolvedValue(ready());h.getBoard.mockResolvedValue({values:[],block:"100"});h.vote.mockResolvedValue({vote:true});h.promote.mockResolvedValue({promote:true});h.settle.mockResolvedValue({settle:true});h.submit.mockResolvedValue({});});
afterEach(async()=>{await act(async()=>root?.unmount());container?.remove();});
describe("token action controls",()=>{
  it("free activity cannot enable a paid vote",async()=>{
    h.getAccount.mockResolvedValue(ready("0"));await render();await click("Upvote");
    expect(container.textContent).toContain("0 paid vote capacity");
    expect([...container.querySelectorAll("button")].find(b=>b.textContent?.includes("Confirm upvote"))?.disabled).toBe(true);
    expect(h.submit).not.toHaveBeenCalled();
  });
  it("submits explicit weight, direction and displayed content version only after confirmation",async()=>{
    await render();await click("Downvote");expect(h.submit).not.toHaveBeenCalled();
    await act(async()=>{container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
    expect(h.vote).toHaveBeenCalledWith({actor:"alice",post_id:id,version,direction:2,weight:"1"});
    expect(h.submit).toHaveBeenCalledTimes(1);
  });
  it("reconciles an existing ballot instead of offering another paid vote",async()=>{
    h.getPost.mockResolvedValue({block:"100",vote:{direction:1,weight:"3",block:"99"}});await render();await click("Upvote");
    expect(container.textContent).toContain("upvote used 3 paid capacity");expect(container.querySelector("form")).toBeNull();
  });
  it("closes the vote panel while confirmation runs and keeps a later failure visible",async()=>{
    let reject!: (error:Error)=>void;
    h.submit.mockReturnValue(new Promise((_resolve,fail)=>{reject=fail;}));
    await render();await click("Upvote");
    await act(async()=>{container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
    expect(container.querySelector(".economy-panel")).toBeNull();
    expect(container.textContent).toContain("Saving… You can keep browsing.");
    expect(h.submit.mock.calls[0]?.[2]).toMatchObject({quietProgress:true});
    await act(async()=>{reject(new Error("Network rejected this vote"));});
    expect(container.textContent).toContain("Network rejected this vote");
    expect(container.textContent).not.toContain("Saving…");
  });
  it("binds a promotion to its exact burn amount, version, free slot and next nonce",async()=>{
    h.me.account="bob";h.getPost.mockResolvedValue({block:"100",promotion:{nonce:"7",end_block:"50",cancelled:false}});
    h.getBoard.mockResolvedValue({block:"100",values:[{slot:0,end_block:"200",cancelled:false}]});
    await render();await click("Promote");expect(h.submit).not.toHaveBeenCalled();
    await act(async()=>{container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
    expect(h.promote).toHaveBeenCalledWith({actor:"bob",post_id:id,version,nonce:"8",slot:1,opportunities:1,burn_amount:"1"});
    expect(h.submit).toHaveBeenCalledTimes(1);
  });
  it("shows slot contention without sending or burning",async()=>{
    h.me.account="bob";h.getBoard.mockResolvedValue({block:"100",values:Array.from({length:32},(_,slot)=>({slot,end_block:"200",cancelled:false}))});
    await render();await click("Promote");
    await act(async()=>{container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
    expect(container.textContent).toContain("All promotion slots are occupied");expect(h.submit).not.toHaveBeenCalled();
  });
});
