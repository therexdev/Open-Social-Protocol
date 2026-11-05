import { isAddress, photoLocation, profilePhotoId, toBase64url, type DecodedProfile } from "@osp/sdk";
import { useServices } from "../../api/services";
import { MediaPhoto } from "../../components/MediaPhoto";

export function ProfileImage({ account, document, banner = false }: { account: string; document: DecodedProfile; banner?: boolean }) {
  const { protocol } = useServices();
  const hash = banner ? document.banner_photo_hash : document.avatar_photo_hash;
  const legacy = !banner && document.avatar;
  if (hash?.length === 32 && protocol && isAddress(account)) {
    const location = photoLocation(protocol.deployment.contracts.publications.address, profilePhotoId(account, hash));
    return <MediaPhoto decorative location={location} hash={toBase64url(hash)} mime="image/jpeg" alt=""/>;
  }
  if (legacy && legacy.content_hash?.length === 32 && legacy.locations?.[0]?.match(/^(osp-photo|ipfs):\/\//))
    return <MediaPhoto decorative location={legacy.locations[0]} hash={toBase64url(legacy.content_hash)} mime={legacy.mime} alt=""/>;
  return null;
}
