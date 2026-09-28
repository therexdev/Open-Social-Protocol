import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { MessagesPage } from "./MessagesPage";
const mocks = vi.hoisted(() => ({
  value: {
    service: { enable: vi.fn(), sync: vi.fn(), send: vi.fn() },
    snapshot: {
      enabled: false,
      registered: false,
      chats: [] as any[],
      pending: 0,
      error: "",
    },
  },
}));
vi.mock("./PrivateMessagingProvider", () => ({
  usePrivateMessaging: () => mocks.value,
}));
vi.mock("../session", () => ({ useCanAct: () => ({ ok: true }) }));
let root: Root, container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  mocks.value.snapshot = {
    enabled: false,
    registered: false,
    chats: [],
    pending: 0,
    error: "",
  };
});
async function mount() {
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MemoryRouter>
        <MessagesPage />
      </MemoryRouter>,
    ),
  );
}
it("explains seed recovery does not restore chat history before enabling", async () => {
  await mount();
  expect(container.textContent).toContain("cannot restore these messages");
  const button = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Enable private messages"),
  )!;
  await act(async () => button.click());
  expect(mocks.value.service.enable).toHaveBeenCalled();
});
it("shows pending local messages and keeps them visible while delivery continues", async () => {
  mocks.value.snapshot = {
    enabled: true,
    registered: true,
    pending: 1,
    error: "",
    chats: [
      {
        id: "chat",
        peer: "1AWc6UmnBoavsW2a4m33N61tPuEeFX5b9U",
        status: "ready",
        createdAt: 1,
        messages: [
          {
            id: "m1",
            text: "Saved before sending",
            mine: true,
            state: "sending",
            timestamp: 1,
          },
        ],
      },
    ],
  };
  await mount();
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".private-chat-choice")!.click(),
  );
  expect(container.textContent).toContain("Saved before sending");
  expect(container.textContent).toContain("Sending…");
  expect(container.textContent).toContain("You can leave this page");
});
