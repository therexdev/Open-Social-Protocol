import { describe, expect, it, vi } from "vitest";
import { CAPABILITY, ProtocolContracts, addressToString, parseKeyPackageSet, encode, fromHex, identityFromSeed, toBase64url, type PollView } from "@osp/sdk";
import { createTestBackground, type TestBackground } from "../test/support";
import type { FeedItem, Reply, StoredCrossPost } from "../shared/protocol";

async function setup(audience=0, host: "facebook" | "x" = "facebook") {
  const t=createTestBackground({indexer:true,sponsor:false,origins:[host === 'x' ? 'https://x.com/*' : 'https://www.facebook.com/*']});
  const passphrase='correct horse battery';
  const {account}=await t.call<{account:string}>('vault.create',{passphrase});
  await t.call('device.authorize',{passphrase,keepOwnerSeed:true});
  await t.call('settings.update',{patch:{payment:'self-only'}});
  const draft=await t.call<{record:StoredCrossPost}>('crosspost.create',{text:'A verified test post',audience,adapter:'sidepanel'});
  const done=await t.call<{record:StoredCrossPost}>('crosspost.confirm',{attemptId:draft.record.attemptId});
  const postId=toBase64url(fromHex(done.record.postId!));
  const post=t.state.posts.find(p=>p.postId===postId)!;
  if(audience===0)post.author=identityFromSeed(new Uint8Array(32).fill(77)).account;
  await t.call('adapter.enable',{adapter:host});
  await t.call('settings.update',{patch:{feedInsertion:true}});
  const content=t.chrome._contentSender(host === 'x' ? 'https://x.com/home' : 'https://www.facebook.com/');
  const frame={...t.chrome._extensionSender('src/embed/index.html#post='+postId),frameId:2,tab:content.tab};
  const send=<T=unknown>(type:string,payload:unknown,sender:chrome.runtime.MessageSender=frame)=>t.chrome._dispatch({type,payload},sender) as Promise<Reply<T>>;
  const action={postId,version:post.contentHash,userGesture:true};
  return {t,account,post,postId,frame,content,send,action};
}
const result=<T>(r:Reply<T>)=>{if(!r.ok)throw Error(r.error.message);return r.result;};
function readOverride(t:TestBackground, method:string, value:()=>unknown) {
  const original=t.provider.readContract.bind(t.provider), contracts=new ProtocolContracts(t.deployment);
  vi.spyOn(t.provider,'readContract').mockImplementation(async op=>{
    const decoded=contracts.decodeOperation(op);
    return decoded?.method===method?{logs:'',result:toBase64url(encode(`${decoded.contract}.${method}_result`,value() as Record<string,unknown>))}:original(op);
  });
}

describe.each(['facebook','x'] as const)('inline %s actions',host=>{
  it('binds signing to a granted card, displayed thread, version, user activation and device permissions',async()=>{
    const {t,send,content,frame,action,account}=await setup(0,host);
    const p={...action,reaction:2,remove:false}, count=t.state.broadcasts.length;
    expect((await send('embed.react',p,content)).ok).toBe(false);
    expect((await send('embed.react',p,{...frame,frameId:0})).ok).toBe(false);
    expect((await send('embed.react',p,{...frame,tab:{...frame.tab!,url:'https://other.test/'}})).ok).toBe(false);
    expect((await send('embed.react',{...p,postId:toBase64url(new Uint8Array(32).fill(3))})).ok).toBe(false);
    expect((await send('embed.react',{...p,version:toBase64url(new Uint8Array(32).fill(4))})).ok).toBe(false);
    expect((await send('embed.react',{...p,userGesture:false})).ok).toBe(false);
    expect((await send('embed.react',{...p,actor:'other'})).ok).toBe(false);
    const device=[...t.state.devices.values()][0]!, bits=device.capabilities;device.capabilities&=~CAPABILITY.REACT;
    expect((await send('embed.react',p)).ok).toBe(false);device.capabilities=bits;
    expect(t.state.broadcasts).toHaveLength(count);
    result(await send('embed.react',p));
    expect(t.state.broadcasts.at(-1)!.ops[0]).toMatchObject({method:'react',args:{actor:account,device:device.device,reaction:2,remove:false}});
    result(await send('embed.react',{...p,reaction:5}));
    result(await send('embed.react',{...p,reaction:5,remove:true}));
    expect(t.state.broadcasts.at(-1)!.ops[0]!.args.remove).toBe(true);
    for(const type of ['vault.export','economy.promote','settings.update','crosspost.confirm'])expect((await send(type,{})).ok).toBe(false);
    await t.call('vault.lock');expect((await send('embed.react',p)).ok).toBe(false);
  });
  it('casts weighted up/down votes in place with the actor and current version fixed by the worker',async()=>{
    const {t,send,action,account}=await setup(0,host);
    result(await send('embed.vote',{...action,direction:2,weight:'3'}));
    const op=t.state.broadcasts.at(-1)!.ops[0]!;
    expect(op).toMatchObject({method:'vote',args:{actor:account,direction:2,weight:'3'}});
    expect(toBase64url(op.args.version as Uint8Array)).toBe(action.version);
    expect((await send('embed.vote',{...action,direction:1,weight:'0'})).ok).toBe(false);
    expect((await send('embed.vote',{...action,direction:1,weight:'1',burnAmount:'100'})).ok).toBe(false);
    [...t.state.devices.values()][0]!.capabilities&=~CAPABILITY.SUPPORT;
    const count=t.state.broadcasts.length;expect((await send('embed.vote',{...action,direction:1,weight:'1'})).ok).toBe(false);expect(t.state.broadcasts).toHaveLength(count);
  });
  it('answers and changes a poll without submitting a reward vote, and rejects closed polls',async()=>{
    const {t,send,action}=await setup(0,host);
    let view:PollView={now:String(t.now.value),value:{definition:{question:'Pick one',options:['One','Two'],closes_at:String(t.now.value+50000)},counts:[0,0],participants:0,engagement_participants:0,engagement_milli:'0'}};
    readOverride(t,'get_poll',()=>view);
    result(await send('embed.poll',{...action,option:0}));
    expect(t.state.broadcasts.at(-1)!.ops.map(op=>op.method)).toEqual(['answer_poll']);
    view={...view,ballot:{option:0}};
    result(await send('embed.poll',{...action,option:1}));
    expect(t.state.broadcasts.at(-1)!.ops[0]!.args.option).toBe(1);
    const count=t.state.broadcasts.length;view.now=String(t.now.value+50001);
    expect((await send('embed.poll',{...action,option:0})).ok).toBe(false);expect(t.state.broadcasts).toHaveLength(count);
  });
  it('publishes comments and nested replies inline, and reconciles retries without duplicates',async()=>{
    const {t,send,action,postId}=await setup(0,host);
    const p={...action,text:'A comment from the feed',attemptId:'11'.repeat(16)};
    const first=result(await send<{postId:string}>('embed.comment',p));
    const count=t.state.broadcasts.length;
    expect(result(await send('embed.comment',p))).toMatchObject({postId:first.postId,confirmed:true});
    expect(result(await send('embed.comment',{...p,attemptId:'12'.repeat(16)}))).toMatchObject({postId:first.postId,confirmed:true});
    expect(t.state.broadcasts).toHaveLength(count);
    const page=result(await send<{items:FeedItem[]}>('embed.replies',{postId}));
    expect(page.items[0]).toMatchObject({postId:first.postId,replyTo:postId,text:p.text});
    const nested=result(await send<{postId:string}>('embed.comment',{...p,targetId:first.postId,version:page.items[0]!.contentHash,text:'Nested reply',attemptId:'13'.repeat(16)}));
    expect(result(await send<{items:FeedItem[]}>('embed.replies',{postId,targetId:first.postId})).items[0]?.postId).toBe(nested.postId);
    expect((await send('embed.react',{...action,targetId:toBase64url(new Uint8Array(32).fill(9)),reaction:1,remove:false})).ok).toBe(false);
    expect((await send('embed.comment',{...p,text:'中'.repeat(3000),attemptId:'14'.repeat(16)})).ok).toBe(false);
  });
  it('encrypts private comments for the thread readers, not the commenter’s entire friends audience',async()=>{
    const {t,send,action,postId,account}=await setup(1,host);
    const friend=identityFromSeed(new Uint8Array(32).fill(44)),stranger=identityFromSeed(new Uint8Array(32).fill(45));
    t.state.registerIdentity(friend.account,friend.encryption.publicKey);t.state.registerIdentity(stranger.account,stranger.encryption.publicKey);
    t.state.befriend(account,friend.account);t.indexer.extraFriends.push(stranger.account);
    const submitted=result(await send<{postId:string}>('embed.comment',{...action,text:'Private reply content',attemptId:'22'.repeat(16)}));
    const recipients=t.state.broadcasts.at(-1)!.ops.filter(op=>op.method==='distribute_keys').flatMap(op=>parseKeyPackageSet(op.args.packages as Uint8Array).keys.map(key=>addressToString(key.recipient)));
    expect(new Set(recipients)).toEqual(new Set([account,friend.account]));
    const op=t.state.broadcasts.at(-1)!.ops.find(op=>op.method==='publish')!;
    expect(op.args.audience).toBe(2);expect(toBase64url(op.args.reply_parent_version as Uint8Array)).toBe(action.version);
    expect(toBase64url(op.args.reply_to as Uint8Array)).toBe(postId);
    expect(new TextDecoder().decode(op.args.envelope as Uint8Array)).not.toContain('Private reply content');
    const page=result(await send<{items:FeedItem[]}>('embed.replies',{postId}));
    expect(page.items[0]).toMatchObject({postId:submitted.postId,status:'decrypted',text:'Private reply content'});
    await t.call('vault.lock');expect((await send('embed.replies',{postId})).ok).toBe(false);
  });
  it('reconciles a comment after a lost confirmation without broadcasting it again',async()=>{
    const {t,send,action}=await setup(0,host);
    vi.spyOn(t.provider,'wait').mockRejectedValueOnce(Error('Confirmation connection lost'));
    const p={...action,text:'Only one copy after a timeout',attemptId:'31'.repeat(16)};
    expect((await send('embed.comment',p)).ok).toBe(false);
    const count=t.state.broadcasts.length;
    expect(result(await send('embed.comment',{...p,attemptId:'32'.repeat(16)}))).toMatchObject({confirmed:true});
    expect(t.state.broadcasts).toHaveLength(count);
  });
  it('does not submit a second action while another submission is in progress',async()=>{
    const {t,send,action}=await setup(0,host);
    const original=t.provider.sendTransaction.bind(t.provider);let release!:()=>void;
    vi.spyOn(t.provider,'sendTransaction').mockImplementation(async(...args)=>{await new Promise<void>(r=>release=r);return original(...args);});
    const first=send('embed.react',{...action,reaction:1,remove:false});
    await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
    expect((await send('embed.react',{...action,reaction:2,remove:false})).ok).toBe(false);
    release();result(await first);
  });
});
