# Extension 0.1.1: Compose and Facebook repair

The user confirmed the website friendship fix and reported a white middle tab in the extension,
plus no visible Facebook integration despite enabling it.

## Confirmed failure and cause

The previous packaged side panel renders Feed, but switching to Compose unmounts the UI with:

`EncodingError: unknown type osp.envelope.content: Code generation from strings disallowed for this context`

`Composer` measures the encoded draft during render. The CSP-safe protobuf initialization ran only
in the worker. Extension pages have separate JavaScript realms and also prohibit generated code.
Unit tests installed the workaround in their global setup, masking the missing page initialization.
Every extension entry point now imports the shared bootstrap before the SDK. The new packaged-page
test failed against the old bundle and passes against the repaired one without any test-side bootstrap.

## Facebook lifecycle defects repaired

- Dynamic registration did not attach scripts to already-open tabs. Sync now injects into granted
  Facebook tabs, including inactive ones, and retains registration for later documents. Closing tabs
  do not block other tabs; injection failures appear in Settings.
- The observer disconnected after 60 seconds idle and did not wake when the user opened a composer
  in the same focused page. Pointer/keyboard interaction now resumes observation before host UI changes.
- Disabled feed settings were cached until reload; settings now refresh existing controllers and
  invalidate old requests. ARIA `role=main` is supported alongside `main` and `role=feed`.
- Disable/unregister previously left injected controls/listeners in the page. Stop messages now clean
  them up, including after permission revocation. Repeated injection reuses one isolated-world controller.
- Composer detection now accepts non-div dialogs, Lexical editors, and text-labeled Post buttons.
  An unrelated last button is no longer treated as a submit control.
- An expandable bottom-left “Open Social enabled” indicator explains where the cross-post control
  lives and that the public feed box is a separate opt-in setting.

No new permissions, contract changes, website changes, or automatic Facebook/OSP publication.
Cross-posting still captures only the opted-in composer text and requires Queue confirmation.

## Validation

- Extension TypeScript build and 68 unit tests pass.
- Packaged worker smoke test passes with eval disabled and message authorization enforced.
- Packaged side panel and options run in independent CSP-restricted realms; Compose renders,
  accepts text, opens confirmation, cancels, and survives repeated tab navigation.
- Packaged Facebook script passes repeated injection, late dialog creation, explicit opt-in,
  live feed toggling, sender/origin validation, cleanup, and re-enable checks.
- Source tests cover existing/inactive tab attachment, closed-tab failures, partial permission
  revocation, idle recovery, alternative dialog/editor markup, and in-flight feed cancellation.

Authenticated Facebook production acceptance remains unverified in this environment. Fixtures and
packaged DOM simulations establish the repaired behavior for the supported markup; they do not prove
compatibility with every Facebook layout or language. The new indicator makes attachment observable.

## Delivery

Release version 0.1.1 uses the existing Harbinger deployment and configured Open Social indexer/sponsor.
Replace the files in the same unpacked-extension folder, reload the existing extension, then refresh
Facebook once to replace content scripts from the old version. Do not remove the installation: its
local vault and settings belong to that extension identity.
