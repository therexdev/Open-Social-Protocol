import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";
import { createVaultStore } from "./vault/store";
import { memoryStorage } from "./vault/storage";
import { unsupportedPasskey } from "./vault/passkey";

const kdf = { N: 1024, r: 8, p: 1 };
let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function render(path: string, vault = createVaultStore({ storage: memoryStorage(), kdf, passkey: unsupportedPasskey })) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <App vault={vault} />
      </MemoryRouter>,
    );
  });
  // let the vault init resolve
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return { vault, container: container! };
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
});

describe("App", () => {
  it("routes a fresh visitor to onboarding and shows the not-deployed banner", async () => {
    const { container } = await render("/");
    expect(container.textContent).toContain("Welcome to Open Social");
    expect(container.textContent).toContain("Create an account");
    expect(container.textContent).toContain("Protocol contracts are not deployed on harbinger yet");
    expect(container.querySelector("nav[aria-label='Primary']")).not.toBeNull();
  });

  it("renders settings without an account and the unlock screen when locked", async () => {
    const { container } = await render("/settings");
    expect(container.textContent).toContain("Network and endpoints");
    expect(container.textContent).toContain("About and decentralization");
    const vault = createVaultStore({ storage: memoryStorage(), kdf, passkey: unsupportedPasskey });
    await vault.getState().init();
    await vault.getState().create("correct horse battery");
    vault.getState().lock();
    await act(async () => {
      root?.unmount();
    });
    container.remove();
    const locked = await render("/compose", vault);
    expect(locked.container.textContent).toContain("Unlock your account");
  });

  it("shows the composer for an unlocked account with actions disabled while not deployed", async () => {
    const vault = createVaultStore({ storage: memoryStorage(), kdf, passkey: unsupportedPasskey });
    await vault.getState().init();
    await vault.getState().create("correct horse battery");
    const { container } = await render("/compose", vault);
    expect(container.textContent).toContain("Who can read it");
    expect(container.textContent).toContain("not deployed");
    const submit = container.querySelector("button[type='submit']") as HTMLButtonElement | null;
    expect(submit?.disabled).toBe(true);
  });
});
