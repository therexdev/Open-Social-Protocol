import { buildControl, CONTROL_ATTR, hookSubmit, showToast, type ComposerAdapter } from "./adapter";
import { ComposerAttribution } from "./attribution";
import { watchXPublishedPost } from "./xPublishedPost";
import type { AdapterRuntime } from "./facebookAdapter";
import type { PublishReply } from "../shared/protocol";

const ROOT = "data-osp-x-composer";
const EDITOR = '[contenteditable="true"][data-testid^="tweetTextarea_"]';
const SUBMIT = '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]';
export const xComposerAdapter: ComposerAdapter = {
  name:"x",
  findComposers(doc) {
    const roots = new Set<HTMLElement>();
    for (const editor of doc.querySelectorAll<HTMLElement>(EDITOR)) {
      if (!/^tweetTextarea_\d+$/.test(editor.dataset.testid || "") || editor.closest('[data-osp-feed], [data-testid="DMDrawer"], [hidden], [aria-hidden="true"]')) continue;
      let root=editor.parentElement;
      for(let n=0;root&&n<24;root=root.parentElement,n++) {
        if(root.matches('body, main, [data-testid="primaryColumn"]')) break;
        if(root.querySelector(SUBMIT)) { roots.add(root); break; }
      }
    }
    return [...roots];
  },
  findTextbox: root => root.querySelector<HTMLElement>(EDITOR),
  findSubmitButton: root => root.querySelector<HTMLElement>(SUBMIT),
  findFooter(root) { return root.querySelector<HTMLElement>('[data-testid="toolBar"]') ?? this.findSubmitButton(root); },
};
const enabled = (button: HTMLElement | null) => !!button && !(button as HTMLButtonElement).disabled && button.getAttribute('aria-disabled') !== 'true';

/** Sharing uses the same explicit native Post event as Facebook. Never mutates the editor
 * while typing, never reads DMs, and never sends a host post through a private API. */
export class XComposerController {
  private entries = new Map<HTMLElement,{editor:ComposerAttribution;unhook:()=>void;manual:boolean}>();
  private attempts = new WeakMap<HTMLElement,{text:string;audience:number;id:string}>();
  private on = false;
  private auto = false;
  private attribution = false;
  private generation = 0;
  private stopped = false;
  private preparing = false;
  private replaying = false;
  private pending?: () => void;
  constructor(private runtime: AdapterRuntime) { void this.refresh(); }
  private optedIn(root:HTMLElement) { return root.querySelector<HTMLInputElement>(`[${CONTROL_ATTR}] input`)?.checked === true; }
  async refresh() {
    const generation=++this.generation;
    try {
      const reply=await this.runtime.sendMessage({type:'adapter.preferences'}) as {ok?:boolean;result?:{xEnabled?:boolean;xAutoCheck?:boolean;xAttribution?:boolean}};
      if(this.stopped||generation!==this.generation||!reply?.ok||typeof reply.result?.xEnabled!=='boolean')return;
      this.on=reply.result.xEnabled;this.auto=reply.result.xAutoCheck!==false;this.attribution=reply.result.xAttribution!==false;
      if(!this.on) { this.clear(); return; }
      this.scan();
      for(const [root,entry] of this.entries) {
        const check=root.querySelector<HTMLInputElement>(`[${CONTROL_ATTR}] input`),select=root.querySelector<HTMLSelectElement>(`[${CONTROL_ATTR}] select`);
        if(!entry.manual&&check&&select){check.checked=this.auto;select.disabled=!this.auto;}
        if(!this.attribution||!this.optedIn(root))entry.editor.sync(false);
      }
    }catch { /* A failed preference read must not enable or silently change sharing. */ }
  }
  scan() {
    if(this.stopped||!this.on)return;
    const roots=new Set(xComposerAdapter.findComposers(this.runtime.document));
    for(const [root,entry] of this.entries)if(!root.isConnected||!roots.has(root)) {entry.unhook();root.querySelector(`[${CONTROL_ATTR}]`)?.remove();root.removeAttribute(ROOT);this.entries.delete(root);}
    for(const root of roots) {
      if(this.entries.has(root)&&root.querySelector(`[${CONTROL_ATTR}]`))continue;
      this.entries.get(root)?.unhook();
      const footer=xComposerAdapter.findFooter(root);if(!footer?.parentElement)continue;
      const control=buildControl(root.ownerDocument);footer.before(control.host);root.setAttribute(ROOT,'');
      control.checkbox.checked=this.auto;control.audience.disabled=!this.auto;
      const entry={editor:new ComposerAttribution(root,xComposerAdapter),unhook:()=>{},manual:false};
      const change=(e:Event)=>{if(!(this.runtime.trustedEvent?.(e)??e.isTrusted))return;entry.manual=true;if(!this.optedIn(root))entry.editor.sync(false);};
      control.checkbox.addEventListener('change',change);
      const unhook=hookSubmit(root,xComposerAdapter,()=>control.host.isConnected?{...control,dialog:root}:null,(text,audience,event)=>this.submit(root,text,audience,event));
      entry.unhook=()=>{unhook();control.checkbox.removeEventListener('change',change);};this.entries.set(root,entry);
    }
  }
  private submit(root:HTMLElement,text:string,audience:number,event:Event) {
    if(this.stopped||this.replaying||!(this.runtime.trustedEvent?.(event)??event.isTrusted))return;
    event.preventDefault();event.stopImmediatePropagation();
    const doc=this.runtime.document;
    if(this.preparing||this.pending){showToast(doc,'Waiting for your previous X post to finish. Your new draft is kept.');return;}
    if(root.querySelectorAll(EDITOR).length!==1){showToast(doc,'Cross-post one X post at a time. Uncheck Open Social to publish a multi-post thread on X.');return;}
    const editor=this.entries.get(root)?.editor;if(!editor)return;
    text=editor.text();if(!text)return;
    let attempt=this.attempts.get(root);
    if(!attempt||attempt.text!==text||attempt.audience!==audience){attempt={text,audience,id:this.runtime.randomAttemptId()};this.attempts.set(root,attempt);}
    const attemptId=attempt.id,generation=this.generation;
    const unchanged=()=>!this.stopped&&this.on&&generation===this.generation&&root.isConnected&&this.optedIn(root)&&editor.text()===text&&root.querySelector<HTMLSelectElement>(`[${CONTROL_ATTR}] select`)?.value===String(audience);
    this.preparing=true;showToast(doc,'Preparing your Open Social copy…',60000);
    void(async()=>{
      try {
        const reply=await this.runtime.sendMessage({type:'crosspost.xPrepare',payload:{text,audience,attemptId,url:this.runtime.location(),submitted:true,userGesture:this.runtime.userGesture?.()??true}}) as {ok?:boolean;result?:PublishReply;error?:{message?:string}};
        if(this.stopped)return;
        if(!reply?.ok||!reply.result?.awaitingX)throw Error(reply?.error?.message||'Open Social did not answer. Unlock Browser connections and try Post again.');
        if(!unchanged())throw Error('Your draft or settings changed. Review it and click Post again.');
        if(this.attribution&&!editor.sync(true,reply.result.profileUrl))throw Error('X did not accept the profile link. Review the message beside the checkbox.');
        // Let native Draft input state and X's own limit/upload validation commit. No fixed
        // character limit is assumed: the same flow works with extended-length accounts.
        await new Promise(resolve=>setTimeout(resolve,150));
        if(!unchanged())throw Error('Your draft or settings changed. Review it and click Post again.');
        const button=xComposerAdapter.findSubmitButton(root);
        if(!enabled(button)) {
          editor.sync(false);
          throw Error('X cannot submit this draft yet. Wait for uploads, shorten the text, or turn off the profile invitation link in Browser connections.');
        }
        this.pending=watchXPublishedPost(doc,text,url=>{
          this.pending=undefined;
          void Promise.resolve(this.runtime.sendMessage({type:'crosspost.xComplete',payload:{attemptId,url}})).then(response=>{
            if(this.stopped)return;
            const r=response as {ok?:boolean;result?:PublishReply;error?:{message?:string}};
            showToast(doc,r?.ok?r.result?.message||'Open Social is confirming your post.':`Open Social needs attention: ${r?.error?.message||'Open Post to check your saved draft.'}`,15000);
          }).catch(()=>{if(!this.stopped)showToast(doc,'Open Post to check your saved X draft before retrying.',15000);});
        },()=>{this.pending=undefined;if(!this.stopped)showToast(doc,'The X post link was not detected. Open Browser tools → Post and paste its published link to finish your saved Open Social draft.',20000);});
        showToast(doc,'Waiting for X’s published post link…',60000);
        this.replaying=true;
        try { button!.click(); } finally { this.replaying=false; }
        this.attempts.delete(root);
      }catch(error){if(!this.stopped)showToast(doc,`Post paused: ${error instanceof Error?error.message:String(error)}`,15000);}
      finally{this.preparing=false;}
    })();
  }
  private clear() {
    this.pending?.();this.pending=undefined;
    for(const [root,entry] of this.entries){entry.editor.sync(false);entry.unhook();root.querySelector(`[${CONTROL_ATTR}]`)?.remove();root.removeAttribute(ROOT);}
    this.entries.clear();
  }
  stop(){this.stopped=true;this.clear();}
}
