import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { encryptMedia, toBase64url, utf8 } from "@osp/sdk";
import { MediaPhoto } from "./MediaPhoto";
const state = vi.hoisted(() => ({ session: {} as unknown }));
vi.mock("../vault/context",() => ({ useVault: (selector: (s: typeof state) => unknown) => selector(state) }));
vi.mock("../stores/settings",() => ({ useSettings: (selector: (s: { ipfsGateways: string[] }) => unknown) => selector({ ipfsGateways: ["https://gateway.test"] }) }));
let root: Root, container: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("decrypts only verified image bytes and revokes the displayed private photo when locked", async () => {
  const encrypted = encryptMedia(utf8("image pixels"));
  const fetchFn = vi.fn().mockResolvedValue(new Response(encrypted.ciphertext));
  vi.stubGlobal("fetch",fetchFn);
  const create = vi.fn().mockReturnValue("blob:private-photo"), revoke = vi.fn();
  Object.defineProperty(URL,"createObjectURL",{ configurable: true,value: create });
  Object.defineProperty(URL,"revokeObjectURL",{ configurable: true,value: revoke });
  state.session = {}; container = document.createElement("div"); root = createRoot(container);
  const photo = <MediaPhoto location="ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqw4j4k2pm" hash={toBase64url(encrypted.contentHash)} mime="image/jpeg" encryption={{ key: toBase64url(encrypted.key),nonce: toBase64url(encrypted.nonce) }}/>
  await act(async () => { root.render(photo); await new Promise(resolve => setTimeout(resolve,20)); });
  expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:private-photo");
  expect(create).toHaveBeenCalledTimes(1);
  state.session = undefined;
  await act(async () => root.render(<MediaPhoto {...photo.props}/>));
  expect(container.querySelector("img")).toBeNull();
  expect(revoke).toHaveBeenCalledWith("blob:private-photo");
  expect(container.textContent).toContain("Unlock");
});
