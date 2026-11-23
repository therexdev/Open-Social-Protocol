import { isAddress, photoLocation, profilePhotoId, toBase64url, type DecodedProfile } from "@osp/sdk";
import { useServices } from "../../api/services";
import { MediaPhoto } from "../../components/MediaPhoto";

export function ProfileImage({ account, document, banner = false, preview = true }: { account: string; document: DecodedProfile; banner?: boolean; preview?: boolean }) {
  const { protocol } = useServices();
  const hash = banner ? document.banner_photo_hash : document.avatar_photo_hash;
  const legacy = !banner && document.avatar;
  if (hash?.length === 32 && protocol && isAddress(account)) {
    const location = photoLocation(protocol.deployment.contracts.publications.address, profilePhotoId(account, hash));
    return <MediaPhoto decorative preview={preview} location={location} hash={toBase64url(hash)} mime="image/jpeg" alt={banner ? "Profile banner" : "Profile photo"}/>;
  }
  if (legacy && legacy.content_hash?.length === 32 && legacy.locations?.[0]?.match(/^(osp-photo|ipfs):\/\//))
    return <MediaPhoto decorative preview={preview} location={legacy.locations[0]} hash={toBase64url(legacy.content_hash)} mime={legacy.mime} alt="Profile photo"/>;
  return null;
}
