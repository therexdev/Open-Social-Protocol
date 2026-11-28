(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom does not implement scrolling; route behavior is tested through navigation state.
if (typeof window !== "undefined") window.scrollTo = () => {};

// Rich editors measure selections; jsdom has no layout engine.
if (typeof Range !== "undefined") {
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
}
if (typeof requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0) as unknown as number;
  globalThis.cancelAnimationFrame = handle => clearTimeout(handle);
}
