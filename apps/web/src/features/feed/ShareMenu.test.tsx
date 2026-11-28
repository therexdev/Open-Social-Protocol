import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { PostView } from '../../api/indexer';
import { ShareMenu, postPermalink } from './ShareMenu';
let root:ReturnType<typeof createRoot>,box:HTMLDivElement;
afterEach(async()=>{await act(async()=>root?.unmount());box?.remove();vi.unstubAllGlobals();});
const id='a'.repeat(43),version='b'.repeat(43);
async function render(canQuote=true){box=document.createElement('div');document.body.append(box);root=createRoot(box);await act(async()=>root.render(<MemoryRouter><ShareMenu post={{postId:id,contentHash:version} as PostView} canQuote={canQuote}/></MemoryRouter>));await act(async()=>box.querySelector<HTMLButtonElement>('button')!.click());}
it('offers an attributed quote composer and copies the canonical website permalink from any client',async()=>{
 const writeText=vi.fn().mockResolvedValue(undefined);vi.stubGlobal('navigator',{clipboard:{writeText}});
 await render();const link=document.querySelector<HTMLAnchorElement>('.share-menu a')!;
 expect(link.getAttribute('href')).toBe(`/compose?quote=${id}&version=${version}`);
 await act(async()=>document.querySelector<HTMLButtonElement>('.share-menu button')!.click());
 expect(writeText).toHaveBeenCalledWith(postPermalink(id));expect(box.textContent).toContain('Link copied');expect(document.querySelector('.share-menu')).toBeNull();
});
it('allows copying a private link but cannot make an attributed public quote of it',async()=>{
 await render(false);expect(document.querySelector('.share-menu a')).toBeNull();expect(document.querySelector('.share-menu')?.textContent).toContain('Copy Link');
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(document.querySelector('.share-menu')).toBeNull();expect(document.activeElement).toBe(box.querySelector('button'));
});
