import { useEffect, useRef, useState } from "react";
import { fromBase64url } from "@osp/sdk";
import type { EmbeddedMedia, FeedMedia } from "../shared/protocol";
import { rpc } from "../shared/rpc";
import { safeHttpUrl } from "../shared/format";

export function CardMedia({ postId, targetId, index, media }: { postId: string; targetId: string; index: number; media: FeedMedia }) {
  const host = useRef<HTMLDivElement>(null);
  const [visible,setVisible] = useState(false), [play,setPlay] = useState(false), [retry,setRetry] = useState(0);
  const [url,setUrl] = useState(""), [poster,setPoster] = useState(""), [error,setError] = useState("");
  const source = media.locations?.[0] ?? "", mime=media.mime ?? "";
  const archived = /^(osp-photo|osp-clip|osp-music|ipfs):\/\//.test(source);
  const video=mime.startsWith("video/"), audio=mime.startsWith("audio/"), photo=mime.startsWith("image/");
  const external=archived ? undefined : safeHttpUrl(source);
  useEffect(()=>{
    if(!host.current || typeof IntersectionObserver==='undefined'){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'150px'});
    observer.observe(host.current);return()=>observer.disconnect();
  },[]);
  const identity=JSON.stringify([source,media.contentHash,media.poster]);
  useEffect(()=>{
    if(!visible || !archived || !media.poster) return;
    let alive=true, objectUrl="";
    void rpc<EmbeddedMedia>('embed.media',{postId,targetId,index,poster:true}).then(result=>{
      if(!alive)return;
      objectUrl=URL.createObjectURL(new Blob([new Uint8Array(fromBase64url(result.data))],{type:result.mime}));setPoster(objectUrl);
    }).catch(()=>{ /* A missing poster must still allow explicit playback. */ });
    return()=>{alive=false;if(objectUrl)URL.revokeObjectURL(objectUrl);setPoster("");};
  },[postId,targetId,index,identity,visible,retry]);
  useEffect(()=>{
    if(!visible || !archived || (audio&&!play) || (video&&media.poster&&!play))return;
    let alive=true, objectUrl="";setError("");setUrl("");
    void rpc<EmbeddedMedia>('embed.media',{postId,targetId,index,poster:false}).then(result=>{
      if(!alive)return;
      objectUrl=URL.createObjectURL(new Blob([new Uint8Array(fromBase64url(result.data))],{type:result.mime}));setUrl(objectUrl);
    }).catch(e=>{if(alive)setError(e.message);});
    return()=>{alive=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[postId,targetId,index,identity,visible,play,retry]);
  const displayed=archived?url:external;
  const loading=visible&&archived&&!displayed&&!error&&(photo||play||video&&!media.poster);
  return <div ref={host} className={`card-media ${video?'card-video':audio?'card-audio':'card-photo'}`}>
    {displayed&&photo ? <img src={displayed} alt={media.alt_text||'Attached photo'} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setError('This photo could not be displayed.')}/>
      : displayed&&video ? <video src={displayed} poster={poster||undefined} controls playsInline preload="metadata" autoPlay={play} aria-label={media.alt_text||'Video'} onLoadedData={e=>{if(!play&&e.currentTarget.currentTime===0)e.currentTarget.currentTime=0.01;}} onError={()=>setError('This video could not be played.')}/>
      : displayed&&audio ? <audio src={displayed} controls preload="metadata" autoPlay={play} aria-label={media.alt_text||'Audio recording'} onError={()=>setError('This recording could not be played.')}/>
      : video||audio ? <div className="media-preview">
        {poster&&<img src={poster} alt={media.alt_text||'Video preview'}/>}
        <button className="media-play" type="button" disabled={loading} onClick={()=>setPlay(true)} aria-label={video?'Play video':'Play audio'}>
          {loading?<span className="spinner"/>:<span aria-hidden="true">▶</span>}{loading?'Loading…':video?'Play video':'Play audio'}
        </button>
      </div> : loading ? <div className="media-loading" role="status"><span className="spinner"/>Loading photo…</div>
      : external ? <a href={external} target="_blank" rel="noopener noreferrer">{media.alt_text||'Attachment'}</a> : <p className="card-hint">Attachment unavailable</p>}
    {error&&<p className="card-error" role="alert">{error} <button type="button" onClick={()=>{setError('');setRetry(n=>n+1);}}>Retry</button></p>}
  </div>;
}
