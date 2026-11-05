import { fromBase64url, toBase64url, type ProtocolClient } from "@osp/sdk";
import type { Session } from "../../vault/store";
import { deriveAesKey, EncryptedStore } from "../../vault/encryptedStore";
import { defaultStorage } from "../../vault/storage";
import type { MediaAttachment } from "../composer/publish";
import { rememberMediaBytes } from "../../api/mediaCache";

export interface GroupDraft {
  id: string;
  revision: number;
  name: string;
  members: string[];
  banner?: Omit<MediaAttachment, "contentHash"> & { contentHash: string } | null;
}
export const saveBanner = (banner: MediaAttachment | null | undefined): GroupDraft["banner"] =>
  banner ? { ...banner, contentHash: toBase64url(banner.contentHash) } : banner;
export const openBanner = (banner: GroupDraft["banner"]): MediaAttachment | null | undefined => {
  if (!banner) return banner;
  if (banner.archiveBytes) rememberMediaBytes(banner.url, banner.contentHash, fromBase64url(banner.archiveBytes));
  return { ...banner, contentHash: fromBase64url(banner.contentHash) };
};

/** Preserve the exact encrypted photo across interrupted saves and reloads. */
export async function groupDraftStore(session: Session, client: ProtocolClient, id?: string) {
  const scope = `${client.chainId}:${client.deployment.contracts.publications.address}:${session.identity.account}:${id ?? "new"}`;
  return new EncryptedStore<GroupDraft>(defaultStorage(), `osp.web.group-draft.${scope}`,
    await deriveAesKey(session.identity.seed, `group-draft:${scope}`));
}
