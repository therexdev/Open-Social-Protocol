/** Copy from a trusted click, including isolated feed frames where the async
 * Clipboard API can be denied by the embedding page's permission policy. */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  } catch { /* Try the browser's user-initiated selection-copy path. */ }
  const focused = document.activeElement as HTMLElement | null;
  const selection = document.getSelection(), ranges: Range[] = [];
  if (selection) for (let i = 0; i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i).cloneRange());
  const field = document.createElement("textarea");
  field.value = text; field.readOnly = true;
  field.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.append(field);
  try {
    field.focus({ preventScroll: true }); field.select();
    if (!document.execCommand?.("copy")) throw Error("The browser could not copy this link.");
  } finally {
    field.remove();
    focused?.focus({ preventScroll: true });
    if (selection) { selection.removeAllRanges(); for (const range of ranges) selection.addRange(range); }
  }
}
