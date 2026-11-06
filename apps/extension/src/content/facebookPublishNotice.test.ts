import { afterEach, expect, it, vi } from 'vitest';
import { FacebookPublishNotice } from './facebookPublishNotice';
let notice: FacebookPublishNotice | undefined;
afterEach(() => { notice?.dispose(); document.body.replaceChildren(); vi.useRealTimers(); });
it('keeps pending status visible, offers completion without reposting, and exposes a real failure', async () => {
  vi.useFakeTimers(); const finish = vi.fn(), close = vi.fn();
  notice = new FacebookPublishNotice(document, finish, close, () => true);
  expect(document.querySelector('progress')?.hidden).toBe(false);
  await vi.advanceTimersByTimeAsync(15001);
  expect(notice.host.textContent).toContain('saved but has not been published');
  const form = document.querySelector('form')!, input = form.querySelector('input')!, button = form.querySelector('button')!;
  expect(form.hidden).toBe(false); input.value = 'https://www.facebook.com/fixture/posts/123';
  form.dispatchEvent(new Event('submit', { cancelable: true })); expect(finish).toHaveBeenCalledExactlyOnceWith(input.value);
  notice.submitting(input.value); form.dispatchEvent(new Event('submit', { cancelable: true })); expect(finish).toHaveBeenCalledTimes(1);
  notice.result('failed', 'The sponsor rejected this publication.'); expect(button.disabled).toBe(false); expect(form.hidden).toBe(false);
  expect(notice.host.textContent).toContain('The sponsor rejected');
  notice.result('published', 'Published with the Facebook link.'); expect(form.hidden).toBe(true); expect(document.querySelector('progress')?.hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(120000); expect(notice.host.isConnected).toBe(true);
  notice.host.querySelector<HTMLButtonElement>('[aria-label="Dismiss Open Social publishing status"]')!.click(); expect(close).toHaveBeenCalledOnce(); expect(notice.host.isConnected).toBe(false);
});
it('ignores page-generated recovery submissions and cancels timers on teardown', async () => {
  vi.useFakeTimers(); const finish = vi.fn(); notice = new FacebookPublishNotice(document, finish, vi.fn());
  notice.recover('Paste the published Facebook link.'); document.querySelector('input')!.value = 'https://www.facebook.com/fixture/posts/123';
  document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); expect(finish).not.toHaveBeenCalled();
  notice.dispose(); await vi.advanceTimersByTimeAsync(20000); expect(document.querySelector('[data-osp-facebook-publish]')).toBeNull();
});
