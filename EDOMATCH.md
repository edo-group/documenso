# EdoMatch fork

This branch is Documenso v2.15.0 with one change on top.

## What is changed

`fix: don't create a field on top of an identical one`

The editor could write the same field twice at the same position for the same
recipient. The signer then fills the field on top, the copy underneath stays
uninserted, and the envelope keeps asking for a field they cannot click. The
document can never be completed. It cost us a real agreement with a
counterparty waiting.

The fix adds `findDuplicateField` to `packages/lib/utils/fields-overlap.ts` and
uses it in `addField`, which now selects the existing field instead of stacking
a new one on top.

Sent upstream as documenso/documenso#3224.

## Going back to upstream

When that PR is merged and released, there is nothing to unpick. Point the
Railway service back at the published image, `documenso/documenso:vX.Y.Z`, and
delete this branch. That is the whole rollback.

## Updating this fork to a newer Documenso

```bash
git fetch upstream --tags
git checkout -b edomatch-vX.Y.Z vX.Y.Z
git cherry-pick <the fix commit>
git push origin edomatch-vX.Y.Z
```

Then change the branch on the Railway service. Check the fix still applies
cleanly first; if upstream has changed `addField`, take their version instead.
