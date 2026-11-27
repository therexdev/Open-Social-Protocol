import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { PostBody } from "./PostCard";
import type { PostContent } from "../../api/decrypt";

it("keeps long stories compact in the feed and opens their complete text without another post", async () => {
  const text = "A complete chapter. ".repeat(1000) + "The final sentence.";
  const content = { status: "plain", content: { text, media: [] } } as unknown as PostContent;
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  try {
    await act(async () => root.render(<MemoryRouter><PostBody content={content}/></MemoryRouter>));
    expect(host.textContent).not.toContain("The final sentence.");
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Read more")!.click());
    expect(host.querySelector(".post-text")!.textContent).toBe(text);
    await act(async () => root.render(<MemoryRouter><PostBody content={content} expanded/></MemoryRouter>));
    expect(host.querySelector(".post-text")!.textContent).toBe(text);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
