import { useRef, type TouchEvent } from "react";
/** Horizontal intent only. Forms, controls, browser edge gestures and vertical scrolling win. */
export function useSwipeTabs(onSwipe: (direction: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number; time: number } | undefined>(undefined);
  return {
    onTouchStart(event: TouchEvent) {
      start.current = undefined;
      const target = event.target;
      if (!(target instanceof Element) || target.closest("input,textarea,select,button,a,dialog,[contenteditable],[data-no-swipe]")) return;
      if (event.touches.length !== 1) return;
      const touch = event.touches[0]!;
      if (touch.clientX < 24 || touch.clientX > window.innerWidth - 24) return;
      start.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
      event.stopPropagation();
    },
    onTouchCancel() { start.current = undefined; },
    onTouchEnd(event: TouchEvent) {
      const began = start.current;
      start.current = undefined;
      if (!began || event.changedTouches.length !== 1) return;
      event.stopPropagation();
      const touch = event.changedTouches[0]!;
      const dx = touch.clientX - began.x;
      const dy = touch.clientY - began.y;
      if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 2 || Math.abs(dy) > 48 || Date.now() - began.time > 800) return;
      onSwipe(dx < 0 ? 1 : -1);
    },
  };
}
