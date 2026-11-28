import { storePostText } from "@osp/sdk";
import type { SubmitContext } from "../tx/submit";
import { uploadStoredMedia } from "./mediaStorage";

export function uploadPostText(ctx: SubmitContext, owner: string, text: string, encrypted: boolean, assertActive: () => void = () => {}) {
  return storePostText(text, encrypted, bytes => uploadStoredMedia(ctx, owner, bytes, assertActive));
}
