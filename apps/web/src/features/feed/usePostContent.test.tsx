import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AUDIENCE, encryptContent, identityFromSeed, toBase64url } from "@osp/sdk";
import { KeyStore } from "../../api/keystore";
import type { PostView } from "../../api/indexer";
import { HARBINGER_CHAIN_ID } from "../../testing/fixtures";
import { usePostContent } from "./usePostContent";

const state = vi.hoisted(() => ({ session: undefined as unknown }));
vi.mock("../session", () => ({ useSession: () => state.session }));
vi.mock("../../api/services", () => {
  const indexer = { configured: false };
  return { useServices: () => ({ resolved: { chainId: HARBINGER_CHAIN_ID }, indexer }) };
});

let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  vi.useRealTimers();
});

function Reader({ post }: { post: PostView }) {
  const content = usePostContent(post);
  return <div>{content?.status === "decrypted" ? content.content.text : content?.status}</div>;
}

describe("waiting for a friend's reading key", () => {
  it("automatically unlocks an already-rendered post when the key arrives and stops retrying", async () => {
    vi.useFakeTimers();
    const author = identityFromSeed(new Uint8Array(32).fill(10));
    const reader = identityFromSeed(new Uint8Array(32).fill(20));
    const key = new Uint8Array(32).fill(3);
    const encrypted = encryptContent({ content: { version: 1, text: "Now readable" }, epochKey: key, aad: { chainId: HARBINGER_CHAIN_ID, author: author.account, audience: AUDIENCE.FRIENDS, epoch: 0, versionNumber: 1 } });
    const keys = new KeyStore();
    state.session = { identity: reader, keys };
    const post = { author: author.account, postId: "", contentHash: toBase64url(encrypted.contentHash), envelope: toBase64url(encrypted.bytes), audience: AUDIENCE.FRIENDS, audienceId: "", epoch: 0, versionNumber: 1, state: 0 } as PostView;
    container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root!.render(<Reader post={post} />));
    expect(container.textContent).toBe("no-key");
    expect(vi.getTimerCount()).toBe(1);
    await keys.put({ author: author.account, audienceId: new Uint8Array(0), epoch: 0 }, key);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(container.textContent).toBe("Now readable");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes pending retry timers when the reader leaves the page", async () => {
    vi.useFakeTimers();
    const author = identityFromSeed(new Uint8Array(32).fill(10));
    state.session = { identity: author, keys: new KeyStore() };
    const encrypted = encryptContent({ content: { version: 1, text: "Waiting" }, epochKey: new Uint8Array(32).fill(3), aad: { chainId: HARBINGER_CHAIN_ID, author: author.account, audience: AUDIENCE.FRIENDS, epoch: 0, versionNumber: 1 } });
    const post = { author: author.account, postId: "", envelope: toBase64url(encrypted.bytes), audience: AUDIENCE.FRIENDS, audienceId: "", epoch: 0, versionNumber: 1, state: 0 } as PostView;
    container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root!.render(<Reader post={post} />));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => root!.unmount());
    root = undefined;
    expect(vi.getTimerCount()).toBe(0);
  });
});
