import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ProtocolClient } from "@osp/sdk";
import { App, type AppProps } from "./App";
import { IndexerClient } from "./api/indexer";
import type { Services } from "./api/services";
import { useAccount } from "./stores/account";
import { fakeIndexerFetch, fakeProvider, fixtureDeployment } from "./testing/fixtures";
import { createVaultStore, VAULT_KEY } from "./vault/store";
import { memoryStorage } from "./vault/storage";
import { unsupportedPasskey } from "./vault/passkey";
import { returnPath } from "./features/onboarding/OnboardingPage";

const kdf = { N: 1024, r: 8, p: 1 };
let root: Root | undefined;
let container: HTMLDivElement | undefined;

/** A deployed network with an empty chain (nobody registered) and a fake indexer recording its requests. */
function deployedServices(calls: string[]): AppProps["services"] {
  const deployment = fixtureDeployment("harbinger");
  return (resolved): Services => ({
    resolved: { ...resolved, deployment, deployed: true, chainId: deployment.chainId, indexerUrl: "https://indexer.test", sponsorUrls: [] },
    indexer: new IndexerClient({ baseUrl: "https://indexer.test", fetch: fakeIndexerFetch({ "/v1/feed": { items: [], nextCursor: null } }, calls) }),
    protocol: new ProtocolClient({ rpc: fakeProvider(), deployment }),
  });
}

// Keep offline tests independent of the repository's live deployment manifest.
const notDeployedServices: NonNullable<AppProps["services"]> = (resolved) => ({
  resolved: {
    ...resolved,
    deployed: false,
    deploymentMessage: "Protocol contracts are not deployed on harbinger yet",
    indexerUrl: "",
    sponsorUrls: [],
  },
  indexer: new IndexerClient({ baseUrl: "" }),
});

async function render(path: string, vault = createVaultStore({ storage: memoryStorage(), kdf, passkey: unsupportedPasskey }), services: AppProps["services"] = notDeployedServices) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <App vault={vault} services={services} />
      </MemoryRouter>,
    );
  });
  // let the vault init resolve
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return { vault, container: container! };
}

async function submitUnlock(container: HTMLElement, passphrase: string) {
  const input = container.querySelector("input[type='password']") as HTMLInputElement;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, passphrase);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  // Wait for the async KDF/UI state, not a machine-speed-dependent 50 ms delay.
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(container.querySelector('button[aria-busy="true"]')).toBeNull();
  }, { timeout: 5000, interval: 20 });
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  useAccount.getState().reset();
});

describe("App", () => {
  it("unlocks an account saved before a failed registration and resumes that same account", async () => {
    const storage = memoryStorage();
    const original = createVaultStore({ storage, kdf, passkey: unsupportedPasskey });
    await original.getState().init();
    const identity = await original.getState().create("correct horse battery");
    const saved = structuredClone(storage.map.get(VAULT_KEY));
    // A new store models reloading after creating the vault but before registration.
    const reloaded = createVaultStore({ storage, kdf, passkey: unsupportedPasskey });
    const { container } = await render("/welcome", reloaded, deployedServices([]));
    expect(container.textContent).toContain("Unlock your account");
    expect(container.textContent).not.toContain("Create an account");
    await submitUnlock(container, "incorrect passphrase");
    expect(reloaded.getState().status).toBe("locked");
    expect(container.querySelector(".notice-error")).not.toBeNull();
    expect(storage.map.get(VAULT_KEY)).toEqual(saved);
    await submitUnlock(container, "correct horse battery");
    expect(reloaded.getState().status).toBe("unlocked");
    expect(reloaded.getState().account).toBe(identity.account);
    expect(container.textContent).toContain("Join the network");
    expect(container.textContent).toContain("Register on the network");
    expect(container.textContent).not.toContain("Create an account");
    expect(storage.map.get(VAULT_KEY)).toEqual(saved);
  });

  it("provides a working Unlock action from the public feed", async () => {
    const vault = createVaultStore({ storage: memoryStorage(), kdf, passkey: unsupportedPasskey });
    await vault.getState().init();
    await vault.getState().create("correct horse battery");
    vault.getState().lock();
    const { container } = await render("/", vault, deployedServices([]));
    const link = container.querySelector(".topbar-actions a") as HTMLAnchorElement;
    expect(link.textContent).toBe("Unlock");
    await act(async () => { link.click(); });
    expect(container.textContent).toContain("Unlock your account");
    expect(container.querySelector("input[type='password']")).not.toBeNull();
  });

  it("opens the passphrase form from Settings and returns a registered account there", async () => {
    const vault = createVaultStore({ storage: memoryStorage(), kdf, passkey: unsupportedPasskey });
    await vault.getState().init();
    await vault.getState().create("correct horse battery");
    vault.getState().lock();
    const { container } = await render("/settings", vault, deployedServices([]));
    const link = [...container.querySelectorAll("a")].find((a) => a.textContent === "Go to unlock")!;
    await act(async () => { link.click(); });
    expect(container.textContent).toContain("Unlock your account");
    await submitUnlock(container, "correct horse battery");
    await act(async () => { useAccount.getState().markRegistered(vault.getState().account!); });
    expect(container.textContent).toContain("Network and endpoints");
    expect(container.textContent).toContain("Export identity file");
    expect(container.textContent).not.toContain("Register on the network");
  });

  it("returns to the unlock form if unfinished registration is locked again", async () => {
    const vault = createVaultStore({ storage: memoryStorage(), kdf, passkey: unsupportedPasskey });
    await vault.getState().init();
    const identity = await vault.getState().create("correct horse battery");
    const { container } = await render("/welcome", vault, deployedServices([]));
    expect(container.textContent).toContain("Register on the network");
    await act(async () => { vault.getState().lock(); });
    expect(container.textContent).toContain("Unlock your account");
    await submitUnlock(container, "correct horse battery");
    expect(container.textContent).toContain("Register on the network");
    expect(vault.getState().account).toBe(identity.account);
  });

  it("does not loop back to onboarding after unlocking", () => {
    expect(returnPath({ from: "/welcome?resume=1#account" })).toBe("/");
    expect(returnPath({ from: "/post/example?view=full#replies" })).toBe("/post/example?view=full#replies");
  });

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
    const submit = container.querySelector("main button[type='submit']") as HTMLButtonElement | null;
    expect(submit?.disabled).toBe(true);
  });

  it("keeps a deep link for a visitor without an account and says so on the onboarding page", async () => {
    const { container } = await render("/post/abc123");
    expect(container.textContent).toContain("Welcome to Open Social");
    expect(container.textContent).toContain("return to the page you opened");
    const { container: plain } = await render("/");
    expect(plain.textContent).not.toContain("return to the page you opened");
  });

  it("tells an unlocked but unregistered account to register and disables actions until then", async () => {
    const vault = createVaultStore({ storage: memoryStorage(), kdf, passkey: unsupportedPasskey });
    await vault.getState().init();
    await vault.getState().create("correct horse battery");
    const { container } = await render("/compose", vault, deployedServices([]));
    expect(container.textContent).toContain("not registered on the network yet");
    expect(container.querySelector("a[href='/welcome']")).not.toBeNull();
    expect(container.textContent).toContain("Register your account on the network first.");
    const submit = container.querySelector("main button[type='submit']") as HTMLButtonElement | null;
    expect(submit?.disabled).toBe(true);
  });

  it("does not ask the indexer for the friends feed while the account is locked", async () => {
    const vault = createVaultStore({ storage: memoryStorage(), kdf, passkey: unsupportedPasskey });
    await vault.getState().init();
    await vault.getState().create("correct horse battery");
    vault.getState().lock();
    const calls: string[] = [];
    const { container } = await render("/", vault, deployedServices(calls));
    expect(calls.some((c) => c.includes("scope=public"))).toBe(true);
    const friendsTab = [...container.querySelectorAll("button[role='tab']")].find((b) => b.textContent?.trim() === "Friends") as HTMLButtonElement;
    await act(async () => {
      friendsTab.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.textContent).toContain("Unlock your account to see posts from your friends");
    expect(calls.some((c) => c.includes("scope=friends"))).toBe(false);
    expect(container.querySelector(".notice-error")).toBeNull();
  });
});

it("explains the protocol on a public About page without requiring an account", async () => {
  const { container } = await render("/about");
  const main = container.querySelector("main")!;
  expect(main.textContent).toContain("The website and plugin are your tools");
  expect(main.textContent).toContain("Removing a friend stops sharing access to future");
  expect(main.textContent).not.toContain("Welcome to Open Social");
  expect(container.querySelector("nav[aria-label='Primary'] a[href='/compose']")).toBeNull();
  expect(container.querySelector("nav[aria-label='Primary'] a[href='/me']")).not.toBeNull();
});
it("takes an unlocked account to its own profile from /me", async () => {
  const vault = createVaultStore({ storage: memoryStorage(), kdf, passkey: unsupportedPasskey });
  await vault.getState().init();
  const identity = await vault.getState().create("correct horse battery");
  const { container } = await render("/me", vault, deployedServices([]));
  expect(container.querySelector("main")!.textContent).toContain("YOUR PROFILE");
  expect(container.querySelector("main")!.textContent).toContain(identity.account);
  expect(container.querySelector("main a[href='/compose']")).not.toBeNull();
});
it("offers nickname search without making visitors create an account first", async () => {
  const { container } = await render("/people");
  expect(container.querySelector("main input[type='search']")).not.toBeNull();
  expect(container.querySelector("main")!.textContent).toContain("Names aren’t unique");
});
it("keeps loaded feed panels mounted during repeated scope changes", async () => {
  const vault = createVaultStore({ storage: memoryStorage(), kdf, passkey: unsupportedPasskey });
  await vault.getState().init();
  await vault.getState().create("correct horse battery");
  const calls: string[] = [];
  const { container } = await render("/", vault, deployedServices(calls));
  const publicPanel = container.querySelector("#feed-public");
  const friendsPanel = container.querySelector("#feed-friends");
  for (let i = 0; i < 10; i++) await act(async () => { (container.querySelectorAll("button[role='tab']")[i % 2 ? 0 : 1] as HTMLButtonElement).click(); });
  expect(container.querySelector("#feed-public")).toBe(publicPanel);
  expect(container.querySelector("#feed-friends")).toBe(friendsPanel);
  expect(calls.filter(call => call.includes("/v1/feed") && call.includes("scope=public"))).toHaveLength(1);
  expect(calls.filter(call => call.includes("/v1/feed") && call.includes("scope=friends"))).toHaveLength(1);
  await act(async () => vault.getState().lock());
  expect(container.querySelector("#feed-friends")).not.toBe(friendsPanel);
  expect(calls.filter(call => call.includes("/v1/feed") && call.includes("scope=friends"))).toHaveLength(1);
});
