import { afterEach, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { RichText } from "./RichText";
import { Signer } from "@osp/sdk";
import { encodeMention } from "../util/mentions";

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

it("renders readable mentions as links to exact accounts and escapes profile labels", async () => {
  container = document.createElement("div"); root = createRoot(container);
  const account = Signer.fromSeed("rich-text-mention").getAddress();
  const name = '<img src=x onerror=alert(1)> [Team]';
  await act(async () => root.render(<MemoryRouter><RichText text={`Hello ${encodeMention(name, account)}!`}/></MemoryRouter>));
  expect(container.textContent).toBe(`Hello @${name}!`);
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("a")?.getAttribute("href")).toBe(`/u/${account}`);
  expect(container.querySelector("a")?.title).toBe(account);
});
