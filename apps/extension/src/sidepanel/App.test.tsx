import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { App } from "./App";
import { createVaultStore } from "../../../web/src/vault/store";
import { memoryStorage } from "../../../web/src/vault/storage";
import { unsupportedPasskey } from "../../../web/src/vault/passkey";
import { IndexerClient } from "../../../web/src/api/indexer";
import { useAccount } from "../../../web/src/stores/account";
import { usePanel } from "./store";

vi.mock("../shared/rpc",()=>({rpc:async(type:string)=>type==="vault.status"?{status:"empty",deviceAuthorized:false,network:{deployed:false}}:type==="crosspost.list"?{items:[]}:undefined}));
it("runs native composer modes, groups and messages in one panel, with account gates and no website frame",async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});window.scrollTo=()=>{};
  const vault=createVaultStore({storage:memoryStorage(),passkey:unsupportedPasskey,kdf:{N:1024,r:8,p:1}});
  await vault.getState().init();await vault.getState().create("correct horse battery");
  const box=document.createElement("div");document.body.append(box);const root=createRoot(box);
  const navigate=async(label:string)=>act(async()=>{Array.from(box.querySelectorAll<HTMLAnchorElement>(".client-nav a")).find(a=>a.textContent===label)!.click();});
  try {
    await act(async()=>{root.render(<MemoryRouter initialEntries={["/compose"]}><App vault={vault} services={resolved=>({resolved:{...resolved,deployed:false,indexerUrl:"",sponsorUrls:[]},indexer:new IndexerClient({baseUrl:""})})}/></MemoryRouter>);});
    expect(box.querySelector("iframe")).toBeNull();
    expect(Array.from(box.querySelectorAll(".client-nav a")).map(a=>a.textContent)).toEqual(["Feed","Post","Groups","Messages","Friends","Profile"]);
    expect(box.textContent).not.toContain("Open in tab");
    expect(box.querySelector("textarea[placeholder='Write a post…']")||box.querySelector("textarea")).toBeTruthy();
    for(const label of ["Post","Voice","Video"])expect(Array.from(box.querySelectorAll("button")).some(b=>b.textContent===label)).toBe(true);
    await navigate("Groups");expect(box.textContent).toContain("Your groups");
    await navigate("Messages");expect(box.textContent).toContain("Messages");
    await navigate("Post");expect(box.textContent).toContain("Create a post");
    await navigate("Groups");await act(async()=>vault.getState().lock());
    expect(box.textContent).toContain("Unlock your account");expect(box.textContent).not.toContain("Your groups");
  } finally {await act(async()=>root.unmount());box.remove();useAccount.getState().reset();usePanel.setState({status:undefined,loading:true});}
});
