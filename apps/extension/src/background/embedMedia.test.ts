import { describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { contentHash, encryptContent, encryptMedia, fromBase64url, identityFromSeed, musicChunks, photoChunks, toBase64url, wrapMediaKey, type MediaItem, type ProtocolClient } from '@osp/sdk';
import { embeddedMedia } from './embedMedia';
import { toFeedItem, openPost } from './decrypt';
import type { FeedDeps } from './feed';
import type { PostView } from '../shared/indexer';
import type { UnlockedSession } from './vault';

const identity=identityFromSeed(new Uint8Array(32).fill(31));
const id=new Uint8Array(32).fill(8),postId=toBase64url(id),chainId=toBase64url(new Uint8Array(34).fill(5));
const contract=identity.account;
function fixture(options:{private?:boolean;clip?:boolean;poster?:boolean;compressed?:boolean}={}) {
  const plain=options.compressed?new Uint8Array(40000).fill(7):new Uint8Array([1,2,3,4,5]);
  const transport=options.compressed?new Uint8Array(gzipSync(plain)):plain;
  const sealed=options.private?encryptMedia(transport):undefined,stored=sealed?.ciphertext??transport;
  const hash=contentHash(stored),contentKey=new Uint8Array(32).fill(3),epochKey=new Uint8Array(32).fill(4);
  const media:MediaItem={locations:[`${options.clip?'osp-clip':'osp-photo'}://${contract}/${postId}`],mime:options.clip?'video/mp4':'image/png',size:stored.length,content_hash:hash,
    ...(sealed&&{wrapped_key:wrapMediaKey(sealed.key,contentKey,hash),nonce:sealed.nonce})};
  if(options.poster)media.poster={locations:[`osp-photo://${contract}/${postId}`],mime:'image/jpeg',size:stored.length,content_hash:hash,...(sealed&&{wrapped_key:wrapMediaKey(sealed.key,contentKey,hash),nonce:sealed.nonce})};
  const encrypted=encryptContent({content:{text:'Media post',media:[media]},...(options.private&&{epochKey,contentKey,aad:{chainId,author:identity.account,audience:1,epoch:1,versionNumber:1}})});
  const post={postId,author:identity.account,audience:options.private?1:0,epoch:1,versionNumber:1,envelope:toBase64url(encrypted.bytes),contentHash:toBase64url(contentHash(encrypted.bytes)),replyTo:'',audienceId:'',state:0,reactions:{total:0,byType:{}},labels:[]} as unknown as PostView;
  const chunks=options.clip?musicChunks(stored):photoChunks(stored);
  const photo={owner:identity.account,digest:hash,size:stored.length,chunk_hashes:chunks.map(contentHash),received:chunks.length,units:1};
  const record={...photo,clip_kind:2,mime:'video/mp4',duration_ms:15000,encrypted:!!sealed,...(options.compressed&&{gzip_original_size:plain.length})};
  const getPhoto=vi.fn(async()=>({value:photo}));
  const client={chainId,deployment:{contracts:{publications:{address:contract}}},reads:{publications:{
    get_post:async()=>({value:{author:post.author,audience:post.audience,version_count:1,state:0,latest_version:fromBase64url(post.contentHash)}}),
    get_photo:getPhoto,get_music:async()=>({value:record}),get_music_config:async()=>({value:{version:3,enabled:true,max_bytes:10485760}}),
    get_music_chunks:async({index,count}:{index:number;count:number})=>({chunks:chunks.slice(index,index+count)}),get_music_chunk:async({index}:{index:number})=>({data:chunks[index]}),
  }}} as unknown as ProtocolClient;
  const session={account:identity.account,unlockedAt:1} as UnlockedSession;
  const indexer={post:async()=>post,photoChunks:vi.fn(async()=>({chunks:chunks.map(toBase64url)}))};
  const deps={clients:async()=>({protocol:client,indexer,resolved:{indexerUrl:'',chainId}}),session:vi.fn(async()=>session),keys:async()=>({resolve:async()=>epochKey}),vault:{encryption:()=>identity.encryption}} as unknown as FeedDeps;
  return {deps,plain,stored,post,client,indexer,session,media,epochKey,getPhoto};
}
describe('embedded verified media',()=>{
  it('loads and verifies on-chain photos, including private media without disclosing reading keys',async()=>{
    for(const privateMedia of [false,true]) {
      const f=fixture({private:privateMedia});
      const loaded=await embeddedMedia(f.deps,postId,0,false);
      expect(fromBase64url(loaded.data)).toEqual(f.plain);expect(loaded.mime).toBe('image/png');
      const opened=await openPost(f.post,{chainId,chain:f.client,keys:await f.deps.keys(f.session),keySource:f.indexer as never,me:identity});
      const item=toFeedItem(f.post,opened);
      expect(item.media?.[0]?.contentHash).toBe(toBase64url(contentHash(f.stored)));
      expect(item.media?.[0]?.encrypted).toBe(privateMedia);
      expect(JSON.stringify(item)).not.toContain('mediaKey');expect(JSON.stringify(item)).not.toContain('wrapped_key');
    }
  });
  it('rejects altered bytes, invalid indices, and downloads that finish after locking',async()=>{
    const f=fixture({private:true});
    f.indexer.photoChunks.mockResolvedValueOnce({chunks:[toBase64url(new Uint8Array([9,9,9]))]});
    await expect(embeddedMedia(f.deps,postId,0,false)).rejects.toThrow(/chunk/);
    await expect(embeddedMedia(f.deps,postId,7,false)).rejects.toThrow(/Attachment not found/);
    vi.mocked(f.deps.session).mockResolvedValueOnce(f.session).mockResolvedValueOnce(undefined);
    await expect(embeddedMedia(f.deps,postId,0,false)).rejects.toThrow(/session changed/);
  });
  it('loads archived video, decrypts private clips, and restores lossless gzip transport',async()=>{
    for(const options of [{clip:true},{clip:true,private:true},{clip:true,compressed:true}]) {
      const f=fixture(options);expect(fromBase64url((await embeddedMedia(f.deps,postId,0,false)).data)).toEqual(f.plain);
    }
  });
  it('loads a verified small video poster separately from the full clip',async()=>{
    const f=fixture({clip:true,private:true,poster:true});
    const loaded=await embeddedMedia(f.deps,postId,0,true);
    expect(loaded.mime).toBe('image/jpeg');expect(fromBase64url(loaded.data)).toEqual(f.plain);expect(f.getPhoto).toHaveBeenCalledTimes(1);
  });
});
