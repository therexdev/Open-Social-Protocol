import { afterEach, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Signer } from "@osp/sdk";
import { PostMarkdown } from "./PostMarkdown";
import { encodeMention } from "../util/mentions";

let root: Root, host: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });
async function render(text: string, embedded = false) {
  host = document.createElement("div"); root = createRoot(host);
  await act(async () => root.render(embedded ? <PostMarkdown text={text} linkBase="https://opensocial.online"/> : <MemoryRouter><PostMarkdown text={text}/></MemoryRouter>));
}
it("renders Markdown blocks, inline formatting, tables and existing social links, keeping code literal", async () => {
  const account = Signer.fromSeed("formatted-mention").getAddress();
  await render(`## A story\n\n**Bold** and *italic* and ~~removed~~.\nSecond line.\n\n- First\n- Second\n\n> A quote\n\n[Source](https://example.com) #Technology ${encodeMention("Alice", account)}\n\n\`#literal https://code.test\`\n\n| A | B |\n| - | - |\n| 1 | 2 |`);
  expect(host.querySelector("h2")?.textContent).toBe("A story");
  expect(host.querySelector("strong")?.textContent).toBe("Bold"); expect(host.querySelector("em")?.textContent).toBe("italic");
  expect(host.querySelectorAll("li")).toHaveLength(2); expect(host.querySelector("blockquote")?.textContent).toContain("A quote");
  expect(host.querySelector("table td")?.textContent).toBe("1");
  expect(host.querySelector(`a[href='/u/${account}']`)?.textContent).toBe("Alice");
  expect(host.querySelector("a[href='/tags/technology']")?.textContent).toBe("#Technology");
  expect(host.querySelector<HTMLAnchorElement>("a[href='https://example.com']")?.rel).toContain("noreferrer");
  expect(host.querySelector("code")?.textContent).toBe("#literal https://code.test"); expect(host.querySelector("code a")).toBeNull();
  expect(host.querySelectorAll("a a")).toHaveLength(0);
});
it("does not execute HTML, dangerous URLs, remote images or nested social links", async () => {
  await render(`<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert) [data](data:text/html,hello) [slash](/\\evil.test) ![remote](https://tracker.test/pixel) [#Tech](https://example.com)`);
  expect(host.querySelector("script,img,iframe,svg")).toBeNull();
  expect([...host.querySelectorAll("a")].every(a => !/^(javascript|data):/.test(a.getAttribute("href")!))).toBe(true);
  expect(host.querySelectorAll("a a")).toHaveLength(0);
  expect(host.querySelector("a[href='https://tracker.test/pixel']")?.textContent).toBe("remote");
});
it("opens social links from the browser plugin on the website without a router", async () => {
  await render("**Hello** #community", true);
  expect(host.querySelector("strong")?.textContent).toBe("Hello");
  expect(host.querySelector("a")?.href).toBe("https://opensocial.online/tags/community");
});
it("keeps portable mention names literal even with brackets, HTML, formatting or entities, and leaves code examples intact", async () => {
  const account = Signer.fromSeed("portable-mention-name").getAddress(), name = 'Alex [Team] **Stars** <img src=x> &amp;';
  const tagged = encodeMention(name, account), example = encodeMention("Alice", account);
  await render(`Hello ${tagged}!\n\n\`${example}\`\n\n\`\`\`text\n${tagged}\n\`\`\``);
  expect(host.querySelector(`a[href='/u/${account}']`)?.textContent).toBe(name);
  expect(host.querySelector("strong,img")).toBeNull();
  expect(host.querySelector("code")?.textContent).toBe(example);
  expect(host.querySelector("pre code")?.textContent?.trim()).toBe(tagged);
});
