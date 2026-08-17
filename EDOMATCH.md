# EdoMatch fork

This branch is Documenso v2.15.0 with a few changes on top.

## What is changed

### `fix: don't create a field on top of an identical one`

The editor could write the same field twice at the same position for the same
recipient. The signer then fills the field on top, the copy underneath stays
uninserted, and the envelope keeps asking for a field they cannot click. The
document can never be completed. It cost us a real agreement with a
counterparty waiting.

The fix adds `findDuplicateField` to `packages/lib/utils/fields-overlap.ts` and
uses it in `addField`, which now selects the existing field instead of stacking
a new one on top.

Sent upstream as documenso/documenso#3224.

### `fix: don't create a second copy of a recipient on every save`

The same bug one level up. The editor saved a recipient, the server created it
and handed back an id, and the editor never stored it. Since the server matches
recipients on id alone, the next save looked like a new person and created them
again. Typing an email and then a name was enough to do it.

The sender was left with a signer they never added, and could not send, because
that copy had no signature field on it. Fields already stored their ids; only
recipients were missed.

The fix sends the editor's local id with each recipient and echoes it back, so
the editor knows which saved recipient is which. Pairing on the local id rather
than the email is deliberate: the same person can appear on an envelope more
than once on purpose, so an email identifies nobody in particular.

The same commit shows the reason the server gives when an envelope cannot be
sent, instead of replacing it with "Something went wrong".

Not sent upstream yet.

## Going back to upstream

When that PR is merged and released, there is nothing to unpick. Point the
Railway service back at the published image, `documenso/documenso:vX.Y.Z`, and
delete this branch. That is the whole rollback.

## Updating this fork to a newer Documenso

```bash
git fetch upstream --tags
git checkout -b edomatch-vX.Y.Z vX.Y.Z
git cherry-pick <the fix commits>
git push origin edomatch-vX.Y.Z
```

Then change the branch on the Railway service. Check the fixes still apply
cleanly first. If upstream has fixed either of these themselves, drop our
commit and take theirs.

## Building it

Railway builds this from source, which takes far longer than pulling the
published image. If that becomes annoying, build the image in CI once per
change and point Railway at the image instead.

Note for anyone running the build locally: the zod generator fails on Node 25
with "options.recursive is no longer supported". Use Node 22, which is what the
Dockerfile uses.
