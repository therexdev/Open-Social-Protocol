import { Icon } from "../../../web/src/components/Icon";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import type { PollView } from "@osp/sdk";
import type { FeedItem, FeedPage } from "../shared/protocol";
import type { EconomyInspection } from "../sidepanel/Economy";
import { tokenResources } from "../../../web/src/features/tokens/resources";
import { audienceName, formatTime, safeHttpUrl, shortAddress } from "../shared/format";
import { rpc } from "../shared/rpc";
import { CardMedia } from "./Media";
import { Avatar } from "./Avatar";

const SITE = "https://opensocial.online";
type View = { enabled: boolean; item?: FeedItem };
const reactions = [{code:1,label:'Love',icon:'❤️'},{code:2,label:'Happy',icon:'😊'},{code:3,label:'Sad',icon:'😢'},{code:4,label:'Worried',icon:'😟'},{code:5,label:'Surprised',icon:'😮'}];
// Facebook cannot synthesize an event inside this extension origin. No postMessage
// listener accepts actions; keyboard activation still produces trusted clicks.
const gesture = (event: SyntheticEvent) => event.isTrusted && navigator.userActivation?.isActive !== false;
const attemptId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');

export function PostCard({ item, rootId = item.postId, compact = false, depth = 0 }: { item: FeedItem; rootId?: string; compact?: boolean; depth?: number }) {
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const working=useRef(false);
  const [reaction,setReaction]=useState<number>(),[reactionOpen,setReactionOpen]=useState(false);
  const reactionBox=useRef<HTMLDivElement>(null);
  const [poll,setPoll]=useState<PollView|undefined>(item.pollView),[selected,setSelected]=useState<number>();
  const [direction,setDirection]=useState<number>(),[economy,setEconomy]=useState<EconomyInspection>(),[weight,setWeight]=useState('1');
  const [comments,setComments]=useState(false),[replying,setReplying]=useState(false),[replies,setReplies]=useState<FeedItem[]>([]);
  const [cursor,setCursor]=useState<string|null>(),[loadingReplies,setLoadingReplies]=useState(false),[text,setText]=useState('');
  const [added,setAdded]=useState(0),[expanded,setExpanded]=useState(false),[clock,setClock]=useState(Date.now());
  const initialReplyCount=useRef(item.replyCount),copy=useRef<HTMLParagraphElement>(null);
  const [overflowing,setOverflowing]=useState(false);
  const draft=useRef<{id:string;text:string}|undefined>(undefined);
  const name=item.authorName?.trim()||shortAddress(item.author), readable=['plain','decrypted'].includes(item.status);
  const target={postId:rootId,targetId:item.postId}, action={...target,version:item.contentHash,userGesture:true};
  const selectedReaction=reaction??item.viewerReaction??(item.liked?1:0), choice=reactions.find(r=>r.code===selectedReaction);
  const reactionCount=Math.max(0,item.reactions+(reaction===undefined?0:Number(!!reaction)-Number(!!item.viewerReaction||!!item.liked)));
  const reward=economy?.view??item.economy;
  const currentPoll=poll?.value??item.poll, answer=selected??poll?.ballot?.option;
  const closed=!!currentPoll&&Math.max(clock,Number(poll?.now??0))>=Number(currentPoll.definition.closes_at);
  useEffect(()=>{setPoll(item.pollView);},[item.pollView]);
  useEffect(()=>{if(!currentPoll)return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[!!currentPoll]);
  useEffect(()=>{
    const node=copy.current;if(!node||expanded)return;
    const measure=()=>setOverflowing(node.scrollHeight>node.clientHeight+1);
    const observer=new ResizeObserver(measure);observer.observe(node);measure();return()=>observer.disconnect();
  },[item.text,currentPoll?.definition.question,expanded]);
  useEffect(()=>{
    if(!reactionOpen)return;
    const dismiss=(e:Event)=>{if(!reactionBox.current?.contains(e.target as Node))setReactionOpen(false);};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setReactionOpen(false);};
    document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape);};
  },[reactionOpen]);
  const perform=async(task:()=>Promise<void>)=>{
    if(working.current)return;working.current=true;setBusy(true);setError('');setMessage('');
    try{await task();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{working.current=false;setBusy(false);}
  };
  const vote=async(value:number)=>{
    setDirection(value);setEconomy(undefined);setError('');
    try{setEconomy(await rpc<EconomyInspection>('embed.inspect',target));}catch(e){setError((e as Error).message);}
  };
  const loadReplies=async(more=false)=>{
    if(loadingReplies)return;setLoadingReplies(true);setError('');
    try{const page=await rpc<FeedPage>('embed.replies',{...target,...(more&&cursor?{cursor}:{})});setReplies(old=>{const all=more?[...old,...page.items]:page.items;return [...new Map(all.map(p=>[p.postId,p])).values()];});setCursor(page.nextCursor);}
    catch(e){setError((e as Error).message);}finally{setLoadingReplies(false);}
  };
  const confirmVote=(event:SyntheticEvent)=>{
    if(!gesture(event)||!economy||!direction)return;
    void perform(async()=>{const current=await rpc<EconomyInspection>('embed.vote',{...action,version:economy.version,direction,weight});setEconomy(current);setDirection(undefined);setMessage('Vote confirmed.');});
  };
  const submitReply=(event:SyntheticEvent)=>{
    event.preventDefault();if(!gesture(event)||!text.trim())return;
    const body=text.trim();if(!draft.current||draft.current.text!==body)draft.current={id:attemptId(),text:body};
    const id=draft.current.id;
    void perform(async()=>{
      await rpc('embed.comment',{...action,text:body,attemptId:id});
      setText('');draft.current=undefined;setAdded(n=>n+1);setMessage('Comment confirmed. It may take a moment to appear.');setComments(true);setReplying(false);await loadReplies();
    });
  };
  const capacity=tokenResources(economy?.account), available=capacity.paid/capacity.precision;
  const voteClosed=!!economy?.view?.reward&&(economy.view.reward.settled||economy.view.reward.version!==economy.version)||!!economy?.view?.epoch&&BigInt(economy.view.block)>=BigInt(economy.view.epoch.end_block);
  const canVote=!!economy?.policy&&economy.active&&economy.canVote&&!economy.own&&!economy.view?.vote&&!voteClosed;
  const validWeight=/^[1-9]\d{0,6}$/.test(weight)&&BigInt(weight)<=available&&BigInt(weight)<=BigInt(economy?.policy?.max_vote_weight??0);
  return <article className={`social-card${compact?' comment-card':''}`} aria-label={`Post by ${name}`}>
    <header className="card-header">
      <a className="card-avatar" href={`${SITE}/u/${encodeURIComponent(item.author)}`} target="_blank" rel="noopener noreferrer" aria-label={`${name}'s profile`}><Avatar name={name} postId={rootId} targetId={item.postId} hash={item.authorAvatarHash}/></a>
      <div className="card-heading"><a className="card-author" href={`${SITE}/u/${encodeURIComponent(item.author)}`} target="_blank" rel="noopener noreferrer">{name}</a>
        <div className="card-meta"><time title={new Date(Number(item.createdAt)).toLocaleString()}>{formatTime(item.createdAt)}</time>{item.versionNumber>1&&' · edited'}<span aria-hidden="true"> · </span><span title={audienceName(item.audience)}><Icon name={item.audience===0?'globe':'lock'} size={12}/></span><span>{audienceName(item.audience)}</span></div>
      </div>
      <a className="card-source" href={`${SITE}/post/${encodeURIComponent(item.postId)}`} target="_blank" rel="noopener noreferrer" title="View original on Open Social"><span className="source-dot"/>Open Social <span aria-hidden="true">↗</span></a>
    </header>
    {item.labels.length>0&&<div className="card-labels">{item.labels.map(l=><span key={`${l.communityId}-${l.label}`} title={l.reason}>{l.label}</span>)}</div>}
    {readable?<>
      {item.text&&<div className="card-copy"><p ref={copy} className={!expanded?'clamped':''}>{currentPoll?.definition.question??item.text}</p>{(overflowing||expanded)&&<button className="text-button" onClick={()=>setExpanded(!expanded)}>{expanded?'See less':'See more'}</button>}</div>}
      {currentPoll&&<section className="card-poll" aria-label="Poll">
        {!item.text&&<p>{currentPoll.definition.question}</p>}
        <fieldset disabled={busy||closed||!item.viewer||!poll?.value}><legend>Choose an answer</legend>
          {currentPoll.definition.options.map((option,i)=>{const count=currentPoll.counts[i]??0, percent=currentPoll.participants?Math.round(count*100/currentPoll.participants):0;return <label className="poll-option" key={i}>
            <span className="poll-progress" style={{width:`${percent}%`}}/><input type="radio" name={`poll-${item.postId}`} checked={answer===i} onChange={()=>setSelected(i)}/><span>{option}</span><strong>{percent}%</strong>
          </label>;})}
        </fieldset>
        <div className="poll-bottom"><span>{currentPoll.participants} answers · {closed?'Closed':`Closes ${new Date(Number(currentPoll.definition.closes_at)).toLocaleString()}`}</span>
          {!closed&&<button className="primary" disabled={busy||answer===undefined||answer===poll?.ballot?.option||!item.viewer||!poll?.value} onClick={e=>{if(!gesture(e))return;void perform(async()=>{const result=await rpc<{pollView:PollView}>('embed.poll',{...action,option:answer});setPoll(result.pollView);setSelected(undefined);setMessage('Answer recorded. Your upvote or downvote is unchanged.');});}}>{poll?.ballot?'Change answer':'Vote in poll'}</button>}
        </div><p className="card-hint">Answers are public. Poll participation is separate from upvotes and downvotes.</p>
      </section>}
      {!!item.media?.length&&<div className="card-attachments">{item.media.map((media,i)=><CardMedia key={`${i}:${media.contentHash}:${media.locations?.[0]}`} postId={rootId} targetId={item.postId} index={i} media={media}/>)}</div>}
      {safeHttpUrl(item.externalRef)&&<a className="card-link" href={item.externalRef} target="_blank" rel="noopener noreferrer">{item.externalRef}</a>}
    </>:<p className="card-state">{item.message||({tombstone:'This post was deleted by its author.',hidden:'The author hid this post.',unavailable:'This post is unavailable.'} as Record<string,string>)[item.status]||'Unlock Open Social to read this post.'}</p>}
    {item.promoted&&<p className="card-hint paid-label">Promoted · paid for by the author</p>}
    {readable&&<>
      <div className="card-counts"><span>{reactionCount>0?<><span aria-hidden="true">{choice?.icon||'❤️'}</span> {reactionCount} {reactionCount===1?'reaction':'reactions'}</>:''}</span><button className="text-button" onClick={()=>{setComments(!comments);if(!comments)void loadReplies();}}>{Math.max(item.replyCount,initialReplyCount.current+added)} comments</button></div>
      <div className="card-actions">
        {item.audience===0&&item.author!==item.viewer&&<><button disabled={busy} className={reward?.vote?.direction===1?'selected':''} aria-label="Upvote" title="Upvote" onClick={()=>void vote(1)}><Icon name="up" size={19}/><span>{reward?.reward?.up||''}</span></button>
          <button disabled={busy} className={reward?.vote?.direction===2?'selected':''} aria-label="Downvote" title="Downvote" onClick={()=>void vote(2)}><Icon name="down" size={19}/><span>{reward?.reward?.down||''}</span></button></>}
        <div className="card-reactions" ref={reactionBox}><button disabled={busy} aria-label={choice?`Change reaction, ${choice.label}`:'React'} title="React" aria-expanded={reactionOpen} onClick={()=>setReactionOpen(!reactionOpen)}>{choice?<span className="reaction-emoji">{choice.icon}</span>:<Icon name="heart" size={19}/>}</button>
          {reactionOpen&&<div className="reaction-bubble" role="group" aria-label="Choose a reaction">{reactions.map(r=><button key={r.code} type="button" title={r.label} aria-label={r.code===selectedReaction?`Remove ${r.label} reaction`:r.label} aria-pressed={r.code===selectedReaction} disabled={busy} onClick={e=>{if(!gesture(e))return;setReactionOpen(false);void perform(async()=>{const result=await rpc<{reaction:number}>('embed.react',{...action,reaction:r.code,remove:selectedReaction===r.code});setReaction(result.reaction);});}}>{r.icon}</button>)}</div>}
        </div>
        <button disabled={busy||depth>=8} aria-label={compact?'Reply':'Comment'} title={compact?'Reply':'Comment'} onClick={()=>{setReplying(!replying);setComments(true);if(!comments)void loadReplies();}}><Icon name="message" size={19}/></button>
      </div>
    </>}
    {direction!==undefined&&<section className="inline-panel" aria-label="Confirm reward vote"><div className="panel-heading"><strong>{direction===1?'Upvote':'Downvote'}</strong><button className="close-button" aria-label="Close voting" onClick={()=>setDirection(undefined)}>×</button></div>
      {!economy&&!error?<p><span className="spinner"/>Checking voting capacity…</p>:economy?.view?.vote?<p>You already cast a {economy.view.vote.direction===1?'upvote':'downvote'} with weight {economy.view.vote.weight}. Votes are final.</p>:voteClosed?<p>This post's reward voting window is closed.</p>:economy&&!canVote?<p>{!economy.policy?'Reward voting is not enabled on this network.':!economy.canVote?'Renew this browser’s voting permission in Browser tools.':'This post is not eligible for reward voting.'}</p>:canVote&&<>
        <label className="weight-label">Weight <input type="number" min="1" max={economy!.policy!.max_vote_weight} step="1" value={weight} disabled={busy} onChange={e=>setWeight(e.target.value)}/><span>{available.toString()} available</span></label>
        <p className="card-hint">This vote is final. It uses OSAT voting capacity, which recharges. {direction===2?'Downvotes affect pending author rewards.':''}</p>
        <button className="primary" disabled={busy||!validWeight} onClick={confirmVote}>{busy?'Submitting…':`Confirm ${direction===1?'upvote':'downvote'}`}</button>
      </>}
    </section>}
    {busy&&<p className="card-status" role="status"><span className="spinner"/>Confirming on the network…</p>}
    {message&&<p className="card-status" role="status">{message}</p>}{error&&<p className="card-error" role="alert">{error}</p>}
    {replying&&<form className="comment-form" onSubmit={submitReply}><label className="sr-only" htmlFor={`reply-${item.postId}`}>Write a comment</label><textarea id={`reply-${item.postId}`} placeholder={compact?'Write a reply…':'Write a comment…'} value={text} spellCheck maxLength={3000} disabled={busy} onChange={e=>setText(e.target.value)}/>
      <div className="comment-form-bottom"><span>{item.audience===0?'Public comment':'Encrypted for this thread’s readers'}</span><button className="primary" type="submit" disabled={busy||!text.trim()}>{busy?'Posting…':compact?'Post reply':'Post comment'}</button></div></form>}
    {comments&&<section className="card-comments" aria-label="Comments">
      {replies.map(reply=><PostCard key={`${reply.postId}:${reply.contentHash}:${reply.status}:${reply.viewer}`} item={reply} rootId={rootId} compact depth={depth+1}/>)}
      {loadingReplies?<p className="card-hint" role="status"><span className="spinner"/>Loading comments…</p>:<div className="comments-controls">{!replies.length&&<span className="card-hint">{added?'Your comment is confirming in the feed.':'No comments yet.'}</span>}<button className="text-button" onClick={()=>void loadReplies(!!cursor)}>{cursor?'Load more comments':'Refresh comments'}</button></div>}
    </section>}
  </article>;
}

export function EmbeddedPost() {
  const [view,setView]=useState<View>(),[error,setError]=useState<string>();
  useEffect(()=>{
    let alive=true,busy=false,generation=0,onscreen=true;
    const postId=new URLSearchParams(location.hash.slice(1)).get('post')||'';
    const load=async()=>{
      if(busy||!onscreen||document.visibilityState==='hidden')return;busy=true;const request=generation;
      try{const result=await rpc<View>('embed.post',{postId});if(alive&&request===generation){setView(result);setError(undefined);}}
      catch{if(alive&&request===generation){setView(undefined);setError('Could not load this post. Retrying…');}}
      finally{busy=false;if(alive&&request!==generation)void load();}
    };
    const changed=(changes:Record<string,unknown>,area:string)=>{
      if(area==='session'&&'osp.session' in changes){
        const change=changes['osp.session'] as {oldValue?:Record<string,unknown>;newValue?:Record<string,unknown>};
        const a=change.oldValue,b=change.newValue;
        if(a&&b&&['account','unlockedAt','deviceAddress','keyVersion','encryptionSecret'].every(key=>a[key]===b[key]))return;
        generation++;setView(undefined);void load();
      }else if(area==='local'&&('osp.settings' in changes||'osp.vault' in changes)){generation++;setView(undefined);void load();}
    };
    chrome.storage.onChanged.addListener(changed);
    const visibility=typeof IntersectionObserver==='function'?new IntersectionObserver(([entry])=>{onscreen=entry?.isIntersecting??true;if(onscreen)void load();}):undefined;
    visibility?.observe(document.getElementById('root')!);
    const timer=setInterval(()=>void load(),30000),visible=()=>void load();
    document.addEventListener('visibilitychange',visible);void load();
    return()=>{alive=false;clearInterval(timer);visibility?.disconnect();chrome.storage.onChanged.removeListener(changed);document.removeEventListener('visibilitychange',visible);};
  },[]);
  useEffect(()=>{
    const host=new URLSearchParams(location.hash.slice(1)).get('host')||(document.referrer?new URL(document.referrer).origin:'');
    if(!['https://www.facebook.com','https://web.facebook.com'].includes(host))return;
    const resize=()=>parent.postMessage({type:'osp.card.height',height:document.getElementById('root')!.getBoundingClientRect().height},host);
    const observer=new ResizeObserver(resize);observer.observe(document.getElementById('root')!);resize();return()=>observer.disconnect();
  },[]);
  if(error)return <article className="social-card"><p className="card-state">{error}</p></article>;
  if(!view)return <article className="social-card"><p className="card-state"><span className="spinner"/>Opening Open Social post…</p></article>;
  if(!view.enabled)return <article className="social-card"><p className="card-state">Open Social feed is disabled.</p></article>;
  return view.item?<PostCard key={`${view.item.postId}:${view.item.contentHash}:${view.item.status}:${view.item.viewer}`} item={view.item}/>:<article className="social-card"><p className="card-state">This post is no longer available.</p></article>;
}
