import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ZoomableImage } from "./ZoomableImage";

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); document.body.style.overflow = ""; vi.restoreAllMocks(); });

it("opens outside clipped content, uses the original URL, and closes with X while restoring focus and scroll", async () => {
  const parentClick = vi.fn();
  await act(async () => root.render(<div onClick={parentClick}><ZoomableImage src="blob:original" alt="Landscape"/></div>));
  const trigger = container.querySelector("button")!; trigger.focus(); document.body.style.overflow = "auto";
  await act(async () => trigger.click());
  const dialog = document.body.querySelector("dialog")!;
  expect(dialog.parentElement).toBe(document.body);
  expect(dialog.open).toBe(true);
  expect(dialog.querySelector("img")?.src).toBe("blob:original");
  expect(document.body.style.overflow).toBe("hidden");
  expect(parentClick).not.toHaveBeenCalled();
  await act(async () => dialog.querySelector("button")!.click());
  expect(document.body.querySelector("dialog")).toBeNull();
  expect(document.body.style.overflow).toBe("auto");
  expect(document.activeElement).toBe(trigger);
  expect(parentClick).not.toHaveBeenCalled();
});

it("closes with Escape, native cancel, or the backdrop, and keeps image clicks open", async () => {
  await act(async () => root.render(<ZoomableImage src="blob:photo" alt="Profile banner"/>));
  for (const action of ["escape", "cancel", "backdrop"]) {
    await act(async () => container.querySelector("button")!.click());
    const dialog = document.body.querySelector("dialog")!;
    await act(async () => dialog.querySelector("img")!.click());
    expect(document.body.querySelector("dialog")).toBe(dialog);
    await act(async () => {
      if (action === "escape") dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else if (action === "cancel") dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
      else dialog.click();
    });
    expect(document.body.querySelector("dialog")).toBeNull();
  }
});

it("drops an open viewer when its source changes or disappears", async () => {
  await act(async () => root.render(<ZoomableImage src="blob:first"/>));
  await act(async () => container.querySelector("button")!.click());
  await act(async () => root.render(<ZoomableImage src="blob:second"/>));
  expect(document.body.querySelector("dialog")).toBeNull();
  await act(async () => container.querySelector("button")!.click());
  await act(async () => root.render(null));
  expect(document.body.querySelector("dialog")).toBeNull();
  expect(document.body.style.overflow).toBe("");
});
