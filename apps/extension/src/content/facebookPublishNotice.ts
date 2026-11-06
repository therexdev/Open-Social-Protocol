/** Persistent outcome/recovery UI for the Facebook post being cross-posted. */
export class FacebookPublishNotice {
  readonly host: HTMLElement;
  private message: HTMLElement;
  private progress: HTMLProgressElement;
  private form: HTMLFormElement;
  private input: HTMLInputElement;
  private button: HTMLButtonElement;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(doc: Document, finish: (url: string) => void, close: () => void, trusted: (event: Event) => boolean = e => e.isTrusted) {
    doc.querySelector('[data-osp-facebook-publish]')?.remove();
    this.host = doc.createElement('section'); this.host.setAttribute('data-osp-facebook-publish', '');
    this.host.setAttribute('aria-label', 'Open Social publishing status');
    Object.assign(this.host.style, { position: 'fixed', bottom: '16px', right: '16px', zIndex: '2147483647', width: '320px', maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box', background: '#181e30', color: '#fff', padding: '14px', borderRadius: '10px', boxShadow: '0 6px 24px #0005', font: '13px/1.5 system-ui,sans-serif' });
    const heading = doc.createElement('strong'); heading.textContent = 'Open Social';
    const dismiss = doc.createElement('button'); dismiss.type = 'button'; dismiss.textContent = '×'; dismiss.setAttribute('aria-label', 'Dismiss Open Social publishing status');
    Object.assign(dismiss.style, { float: 'right', border: '0', color: '#fff', background: 'transparent', cursor: 'pointer', fontSize: '20px' });
    dismiss.addEventListener('click', e => { if (trusted(e)) { close(); this.dispose(); } });
    this.message = doc.createElement('p'); this.message.setAttribute('role', 'status');
    this.progress = doc.createElement('progress'); this.progress.setAttribute('aria-label', 'Finding the Facebook post link'); this.progress.style.width = '100%';
    this.form = doc.createElement('form'); this.form.hidden = true;
    const label = doc.createElement('label'); label.textContent = 'Published Facebook post link';
    this.input = doc.createElement('input'); this.input.type = 'url'; this.input.required = true; this.input.placeholder = 'https://www.facebook.com/…'; this.input.setAttribute('aria-label', label.textContent);
    Object.assign(this.input.style, { width: '100%', boxSizing: 'border-box', margin: '6px 0', color: '#182030', background: '#fff', border: '1px solid #8595bb', borderRadius: '5px', padding: '8px', font: 'inherit' });
    label.append(this.input);
    this.button = doc.createElement('button'); this.button.type = 'submit'; this.button.textContent = 'Finish Open Social post';
    Object.assign(this.button.style, { color: '#fff', background: '#315dd5', border: '0', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer', font: 'inherit' });
    this.form.addEventListener('submit', e => { e.preventDefault(); if (trusted(e) && !this.button.disabled && this.input.value.trim()) finish(this.input.value.trim()); });
    this.form.append(label, this.button); this.host.append(heading, dismiss, this.message, this.progress, this.form); (doc.body ?? doc.documentElement).append(this.host);
    this.message.textContent = 'Finding your published Facebook link before posting to Open Social…';
    this.timer = setTimeout(() => this.recover('Still looking for the Facebook link. Your Open Social copy is saved but has not been published. You can paste the published post link here to finish it.'), 15_000);
  }
  submitting(url: string) { clearTimeout(this.timer); this.input.value = url; this.button.disabled = true; this.progress.hidden = false; this.message.textContent = 'Facebook link found. Publishing your Open Social copy…'; }
  recover(message: string) { clearTimeout(this.timer); this.progress.hidden = true; this.form.hidden = false; this.button.disabled = false; this.message.textContent = message; }
  result(status: string | undefined, message: string) {
    clearTimeout(this.timer); this.progress.hidden = true; this.message.textContent = message; this.form.hidden = true;
    if (status === 'failed') { this.form.hidden = false; this.button.disabled = false; this.button.textContent = 'Retry Open Social post'; }
  }
  dispose() { clearTimeout(this.timer); this.host.remove(); }
}
