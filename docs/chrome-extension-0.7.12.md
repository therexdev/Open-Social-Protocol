# Open Social browser extension 0.7.12 beta

The Chrome build retains the standalone Open Social client, feed cards and Facebook/X cross-posting.
This update adds mobile Facebook/X origins and mobile Facebook composer detection, larger touch
controls, and a separate Firefox Android build. Existing Chrome installations keep their account
and preferences; grant the additional origins in Browser connections when using those sites.

For Chrome: build `npm run build -w apps/extension`, open `chrome://extensions`, enable Developer
mode, and load `apps/extension/dist`. Unlock/import your account, authorize the browser, then
enable the desired integrations under Settings → Browser connections.

For Firefox Android setup, signing, installation and acceptance steps, see
`docs/firefox-android-extension.md` in the source repository.

Verify that the Open Social feed cards react/comment/play media, that checked Facebook/X text
posts produce one Open Social copy with the published source link, and that unchecked posts do
not cross-post. Test Public/Friends selection and recovery under More → Unfinished browser posts.
