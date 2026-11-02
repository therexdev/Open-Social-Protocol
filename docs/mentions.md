# Mentions in the reference web client

Type `@` in a post or reply to see friends. Keep typing to filter by display name
or account address and search other profiles. Name matching ignores case and
accents. Friends remain first; duplicate display names have separate rows with
account addresses. The picker excludes your account and known blocked accounts.

Select a person with a click/tap, or use the arrow keys and Enter. Escape, Tab,
or moving focus out of the editor dismisses the list. Enter without an active
suggestion still inserts a newline. Searches are debounced and stale responses
are discarded. A failed directory search leaves matching friends available.

The editor displays `@Name`; posts, previews and saved drafts link that name to
the selected account. Editing a selected name removes its association instead
of silently choosing another account with that name. Ordinary emails and bare
`@Name` text do not become profile links without a selection.

## Portable text representation

Mentions are a reference-client convention in the existing content text field:
`@[Display name](osp:BASE58_ACCOUNT)`. In the label, backslash and `]` are escaped
with a backslash. Names are single-line and bounded; account targets must parse
as Koinos addresses. Text rendering escapes labels and creates only internal
`/u/ACCOUNT` links. URLs consume their own text before mention parsing.

The account, rather than the mutable or non-unique display name, determines the
target. Existing draft saving, editing, background publishing and encrypted
friends-only posts retain the serialized text. Other clients can adopt this
convention without a new contract or schema; clients that do not support it
display the plain serialized text.

This frontend change does not create mention notifications or grant access to
private posts. It uses the existing graph, profile and people-search endpoints;
no contract or service deployment is required. Build with `npm run build:web`
and upload the contents of `apps/web/dist` to the existing website root.
