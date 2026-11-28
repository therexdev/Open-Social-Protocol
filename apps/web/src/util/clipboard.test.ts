import { afterEach, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();Reflect.deleteProperty(document,'execCommand');document.body.replaceChildren();});
it('uses the async clipboard when available',async()=>{
 const writeText=vi.fn().mockResolvedValue(undefined);vi.stubGlobal('navigator',{clipboard:{writeText}});
 await copyText('https://opensocial.online/post/original');expect(writeText).toHaveBeenCalledWith('https://opensocial.online/post/original');expect(document.querySelector('textarea')).toBeNull();
});
it('copies through selection if an embedding page denies the async clipboard and restores focus',async()=>{
 const button=document.createElement('button');document.body.append(button);button.focus();
 vi.stubGlobal('navigator',{clipboard:{writeText:vi.fn().mockRejectedValue(Error('Write permission denied'))}});
 const copy=vi.fn(()=>{expect((document.activeElement as HTMLTextAreaElement).value).toBe('canonical link');return true;});
 Object.defineProperty(document,'execCommand',{configurable:true,value:copy});
 await copyText('canonical link');expect(copy).toHaveBeenCalledWith('copy');expect(document.querySelector('textarea')).toBeNull();expect(document.activeElement).toBe(button);
});
it('reports failure without claiming success when neither copy path works',async()=>{
 vi.stubGlobal('navigator',{});Object.defineProperty(document,'execCommand',{configurable:true,value:()=>false});
 await expect(copyText('link')).rejects.toThrow('could not copy');expect(document.querySelector('textarea')).toBeNull();
});
