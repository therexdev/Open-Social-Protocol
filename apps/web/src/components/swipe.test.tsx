import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useSwipeTabs } from "./useSwipeTabs";
import { Tabs } from "./ui";
let root: Root;
let box: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); box?.remove(); });
async function mount(node: React.ReactNode) { box = document.createElement("div"); document.body.append(box); root = createRoot(box); await act(async () => root.render(node)); }
function touch(target: Element, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, { touches: { value: [{ clientX: x, clientY: y }] }, changedTouches: { value: [{ clientX: x, clientY: y }] } });
  target.dispatchEvent(event);
}
it("swipes only on deliberate horizontal gestures, not controls, vertical scrolls or browser edges", async () => {
  const change = vi.fn();
  function View() { return <section {...useSwipeTabs(change)}><input/><p>Feed</p></section>; }
  await mount(<View/>);
  const target = box.querySelector("p")!;
  await act(async () => { touch(target, "touchstart", 250, 100); touch(target, "touchend", 100, 112); });
  expect(change).toHaveBeenLastCalledWith(1);
  await act(async () => { touch(target, "touchstart", 100, 100); touch(target, "touchend", 240, 105); });
  expect(change).toHaveBeenLastCalledWith(-1);
  await act(async () => {
    touch(target, "touchstart", 250, 100); touch(target, "touchend", 110, 280);
    touch(target, "touchstart", 4, 100); touch(target, "touchend", 150, 100);
    touch(box.querySelector("input")!, "touchstart", 250, 100); touch(box.querySelector("input")!, "touchend", 100, 100);
    touch(target, "touchstart", 250, 100); touch(target, "touchcancel", 250, 100); touch(target, "touchend", 100, 100);
  });
  expect(change).toHaveBeenCalledTimes(2);
});
it("supports arrow-key navigation and moves keyboard focus with the selected tab", async () => {
  const change = vi.fn();
  await mount(<Tabs label="Feed" value="public" options={[{ value: "public", label: "Everyone" }, { value: "friends", label: "Friends" }]} onChange={change}/>);
  const buttons = box.querySelectorAll("button");
  await act(async () => buttons[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(change).toHaveBeenCalledWith("friends");
  expect(document.activeElement).toBe(buttons[1]);
});
