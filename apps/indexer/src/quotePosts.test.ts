import { expect, it } from "vitest";
import { toBase64url } from "@osp/sdk";
import { IndexerDb, KoinosChain, createIndexer, loadConfig, replayProjections } from "./index.js";
import { ChainBuilder, FakeProvider, testDeployment, ospEvent, tx } from "./testing/fake-chain.js";

it("projects immutable share correlation through edits, replay and source deletion without treating it as a comment", async () => {
  const deployment=testDeployment(), builder=new ChainBuilder(deployment);
  const source=new Uint8Array(32).fill(3), share=new Uint8Array(32).fill(4), original=new Uint8Array(32).fill(5);
  const author=deployment.contracts.identity.address, sharer=deployment.contracts.publications.address;
  const published=(post_id:Uint8Array,who:string,version:number,extra:Record<string,unknown>={})=>ospEvent(deployment,'osp.publications.published',{
    author:who,post_id,sequence:'1',version_number:version,content_hash:version===1?original:new Uint8Array(32).fill(8),envelope:new Uint8Array([1]),audience:0,timestamp:String(builder.baseTimestamp),protocol_version:1,...extra
  },[who]);
  builder.block([tx([published(source,author,1),published(share,sharer,1,{quote_post_id:source,quote_version:original})])]);
  builder.block([tx([published(share,sharer,2,{quote_post_id:source,quote_version:original})])]);
  builder.block([tx([ospEvent(deployment,'osp.publications.lifecycle',{author,post_id:source,version:original,state:2,timestamp:String(builder.baseTimestamp)},[author])])]);
  const config=loadConfig({OSP_NETWORK:'test',OSP_INDEXER_DB:':memory:'},{deployment});
  const indexer=createIndexer({config,db:IndexerDb.memory(),chain:new KoinosChain(new FakeProvider(builder),deployment)});
  try {
    await indexer.syncer!.syncToHead();
    const path=`/v1/posts/${toBase64url(share)}`;
    const before=(await indexer.api.inject({method:'GET',url:path})).json();
    expect(before).toMatchObject({postId:toBase64url(share),quotePostId:toBase64url(source),quoteVersion:toBase64url(original),versionNumber:2,replyTo:''});
    const feed=(await indexer.api.inject({method:'GET',url:'/v1/feed?scope=public'})).json();
    expect(feed.items.map((p:{postId:string})=>p.postId)).toContain(toBase64url(share));
    expect((await indexer.api.inject({method:'GET',url:`/v1/posts/${toBase64url(source)}`})).json()).toMatchObject({replyCount:0,state:2});
    const checkpoint=indexer.db.lastCheckpoint(); replayProjections(indexer.db);
    expect((await indexer.api.inject({method:'GET',url:path})).json()).toEqual(before);
    expect(indexer.db.lastCheckpoint()).toEqual(checkpoint);
    expect(indexer.db.schemaVersion).toBe(9);
  } finally {await indexer.close();}
});

it("upgrades an existing schema 8 database in place without losing a post or its sync checkpoint",async()=>{
  const {mkdtempSync,rmSync}=await import('node:fs'),os=await import('node:os'),path=await import('node:path'),{DatabaseSync}=await import('node:sqlite');
  const dir=mkdtempSync(path.join(os.tmpdir(),'osp-quote-migration-')),file=path.join(dir,'indexer.sqlite');
  try{
    const deployment=testDeployment(),builder=new ChainBuilder(deployment),id=new Uint8Array(32).fill(91),author=deployment.contracts.identity.address;
    builder.block([tx([ospEvent(deployment,'osp.publications.published',{author,post_id:id,sequence:'1',version_number:1,content_hash:new Uint8Array(32).fill(92),envelope:new Uint8Array([1]),audience:0,timestamp:String(builder.baseTimestamp),protocol_version:1},[author])])]);
    const indexer=createIndexer({config:loadConfig({OSP_NETWORK:'test',OSP_INDEXER_DB:file},{deployment}),db:new IndexerDb(file),chain:new KoinosChain(new FakeProvider(builder),deployment)});
    await indexer.syncer!.syncToHead();const checkpoint=indexer.db.lastCheckpoint();await indexer.close();
    // Recreate the exact pre-upgrade posts schema while keeping its persisted data.
    const legacy=new DatabaseSync(file);
    legacy.exec("DROP INDEX posts_quote; ALTER TABLE posts DROP COLUMN quote_post_id; ALTER TABLE posts DROP COLUMN quote_version; UPDATE meta SET value='8' WHERE key='schema_version';");legacy.close();
    const upgraded=new IndexerDb(file);
    try{expect(upgraded.schemaVersion).toBe(9);expect(upgraded.lastCheckpoint()).toEqual(checkpoint);expect(upgraded.get('SELECT author,quote_post_id,quote_version FROM posts WHERE post_id=?',toBase64url(id))).toEqual({author,quote_post_id:'',quote_version:''});}finally{upgraded.close();}
  }finally{rmSync(dir,{recursive:true,force:true});}
});
