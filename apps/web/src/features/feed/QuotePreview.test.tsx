import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { QuotePreview } from './QuotePreview';
const mocks=vi.hoisted(()=>({post:vi.fn(),open:vi.fn()}));
vi.mock('../../api/services',()=>{const services={indexer:{post:mocks.post}};return {useServices:()=>services,useOptionalServices:()=>undefined};});
vi.mock('./usePostContent',()=>({usePostContent:mocks.open}));
vi.mock('../profile/useProfileName',()=>({useProfileName:()=> 'Original author'}));
let root:ReturnType<typeof createRoot>,box:HTMLDivElement;
afterEach(async()=>{await act(async()=>root?.unmount());box?.remove();vi.clearAllMocks();});
const quote={postId:'a'.repeat(43),version:'original-version'};
async function render(){box=document.createElement('div');document.body.append(box);root=createRoot(box);await act(async()=>root.render(<MemoryRouter><QuotePreview quote={quote}/></MemoryRouter>));}
it('opens the verified shared revision and bounds nested shares to a link',async()=>{
 const version={contentHash:quote.version,versionNumber:1};
 mocks.post.mockResolvedValue({postId:quote.postId,author:'source',audience:0,state:0,versions:[version],contentHash:'new-version',quotePostId:'nested',createdAt:'1700000000000'});
 mocks.open.mockReturnValue({status:'plain',content:{text:'Original **bold** source',media:[]}});
 await render();expect(mocks.open).toHaveBeenCalledWith(expect.anything(),version);expect(box.querySelector('strong')?.textContent).toBe('bold');
 expect(box.textContent).toContain('Edited since this was shared');expect(box.textContent).toContain('View the earlier shared post');expect(mocks.post).toHaveBeenCalledOnce();
});
it.each([{audience:1,state:0},{audience:0,state:2},{audience:0,state:0,collectionId:'private-group'}])('does not open a private, group or removed source (%j)',async extra=>{
 mocks.post.mockResolvedValue({postId:quote.postId,...extra});await render();expect(box.textContent).toContain('unavailable');expect(mocks.open).not.toHaveBeenCalled();
});
