import { act } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { BrowserPluginPage } from "./BrowserPluginPage";

it("opens install directions without changing the extension's hash route", async () => {
  const original = location.href;
  history.replaceState(null, "", "/#/browser-plugin");
  const box = document.createElement("div"); document.body.append(box); const root = createRoot(box);
  try {
    await act(async () => root.render(<HashRouter><BrowserPluginPage/></HashRouter>));
    const scroll = vi.fn(); box.querySelector<HTMLElement>("#install")!.scrollIntoView = scroll;
    await act(async () => [...box.querySelectorAll("button")].find(b => b.textContent?.includes("How to install"))!.click());
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(location.hash).toBe("#/browser-plugin");
  } finally { await act(async () => root.unmount()); box.remove(); history.replaceState(null, "", original); }
});
