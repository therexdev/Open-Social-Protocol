import { afterEach, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { RichText } from "./RichText";

let root: Root, container: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); });
it("renders safe external links and internal hashtag links without interpreting HTML", async () => {
  container = document.createElement("div"); root = createRoot(container);
  const text = '<img src=x onerror=alert(1)> https://example.org/#anchor #Friends javascript:alert(1)';
  await act(async () => root.render(<MemoryRouter><RichText text={text}/></MemoryRouter>));
  expect(container.textContent).toBe(text);
  expect(container.querySelector("img")).toBeNull();
  const links = container.querySelectorAll("a");
  expect(links).toHaveLength(2);
  expect(links[0]?.href).toBe("https://example.org/#anchor");
  expect(links[0]?.target).toBe("_blank");
  expect(links[0]?.rel).toContain("noreferrer");
  expect(links[1]?.getAttribute("href")).toBe("/tags/friends");
});
