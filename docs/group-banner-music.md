# Group banners and music tabs

This release updates the static web client. It uses the deployed photo archive and collection metadata envelope; no contract deployment, indexer migration, sponsor change, or server restart is needed.

## Update the website

1. Back up Hostinger's `public_html`.
2. Extract `OpenSocial-Group-Banner-Music.zip` directly into `public_html`, replacing matching files. The ZIP has `index.html`, `.htaccess`, `sw.js`, `assets/`, and `release.json` at its root. Retain older hashed assets for browsers with an existing session.
3. Open `https://opensocial.online/release.json?v=group-banner-music` and verify `release` is `2026-11-05-group-banner-music`, `groupBanners` is `1`, and `groupMusicTabs` is `1`.
4. Reload the website. Close and reopen an installed PWA if needed. Keep site storage intact; it holds account keys and resumable uploads.

## Use

- Create a group with an optional banner, or open an owned group and select **Manage group** to upload, replace, or remove it. Select **Save group** to publish the change. The banner picker includes a **Choose from files** recovery option for mobile photo-provider read errors.
- Groups open on **Posts**. Select **Music** for the same track cards, playback/access links, comments, and **Tiles / List** switch used on profiles. An unfinished post stays in the composer when switching tabs.
- Upload music through your profile's Music tab, selecting **Group** access and the intended group.

## Storage and access

Banners are resized and JPEG-compressed in the browser to the existing photo budget, encrypted before upload, and stored in the on-chain photo archive. Only the encrypted photo reference and wrapped key are included in the group's metadata. The group owner controls changes. Photo storage uses the existing free/regenerating OSAT capacity; saving group metadata uses one usage unit. There is no music-upload fee for a banner.

Editing the group name or membership preserves its banner without re-uploading the photo. New members receive the current banner's key in the new group revision. Historical key distribution is limited to albums; newly added group members receive future posts only. Revocation prevents current app access and future sharing, but cannot erase earlier copies or keys.

Before saving, the editor stores an encrypted draft on the device, including the exact banner ciphertext, key, and archive id. Reopening **Manage group** (or **Create group** for an interrupted creation) restores an unfinished edit at the same base revision. Confirmed photo chunks are reused on retry. If another device changes the group, refresh before editing again.

Older groups without a banner remain compatible. Other frontends can ignore the optional `banner: 0` marker in `application/vnd.osp.collection+json`; updated clients render the first encrypted media attachment as the banner.
