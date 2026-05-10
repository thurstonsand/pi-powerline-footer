---
name: rebase
description: Rebase the pi-powerline-footer custom-preset-layout PR branch onto upstream with the smallest possible diff, then update the temporary release branch used to publish @thurstonsand/pi-powerline-footer while waiting for upstream merge.
---

# Rebase

Use this skill in `pi-powerline-footer` when upstream has moved and the fork needs updating.

## Mental model

There are two branches with different purposes:

- `custom-preset-layout` is the real fork/PR branch. It contains the important changes that should land upstream. Optimize this branch for upstream review: smallest diff, least churn, one coherent commit.
- `release` is temporary/throwaway packaging on top of `custom-preset-layout`. It exists only so Thurston can publish `@thurstonsand/pi-powerline-footer` while waiting for the PR to merge. Do not let release metadata leak into the PR branch.

Invariant: **one commit per branch**.

```text
release
└─ chore(release): prepare fork package release       # temporary publish-only commit
   └─ custom-preset-layout
      └─ feat(powerline): configure custom preset layout  # upstream PR commit
         └─ upstream/main
```

If either branch has more than one unique commit, stop and ask before continuing. Fewer commits means fewer conflict rounds. Human civilization has endured enough `rebase --continue`.

## First gate: delete as much fork code as possible

Before rebasing, fetch upstream and inspect what already landed:

```bash
git -c fetch.pruneTags=false fetch upstream --prune --no-tags
git -c fetch.pruneTags=false fetch upstream --tags
```

Do **not** combine `--tags` and `--prune` when fetching `upstream`. Also force `fetch.pruneTags=false`, because a global prune-tags setting can still delete fork-only release tags during an upstream fetch. This repo has fork-only release tags such as `v0.5.4-1`; pruning tags against `upstream` deletes those local tag refs because upstream does not have them. Humans apparently designed this footgun on purpose.

The goal is not to preserve this implementation. The goal is to get the desired footer behavior with the smallest possible upstream PR.

Check whether upstream now supports any of the fork capabilities:

- custom footer/preset layout from settings
- explicit left/right/secondary rows
- configurable separator style
- per-segment options, e.g. `path: { mode: "basename" }`
- promoted extension statuses or equivalent dedicated footer/status segments
- documentation for the behavior in the upstream package

Useful probes:

```bash
git show upstream/main:README.md | rg -n "custom|preset|customItems|leftSegments|rightSegments|secondarySegments|separator|extension_status"
git show upstream/main:powerline-config.ts | rg -n "custom|customItems|leftSegments|rightSegments|secondarySegments|segmentOptions"
git show upstream/main:types.ts | rg -n "CustomPreset|CustomStatus|PresetDef|StatusLinePreset"
git log --oneline --decorate HEAD..upstream/main
```

Decision rules:

- If upstream can reproduce all desired behavior, recommend deleting the fork and using upstream directly.
- If upstream implements only part of the behavior, delete that part from `custom-preset-layout` and keep only the missing pieces.
- If upstream implements the behavior differently, prefer upstream's version unless it cannot reproduce Thurston's desired footer.

## Rebase `custom-preset-layout`

Before starting, confirm the invariant and remember the old feature commit for the release rebase:

```bash
git rev-list --count upstream/main..custom-preset-layout
git log --oneline upstream/main..custom-preset-layout
OLD_FEATURE=$(git rev-parse custom-preset-layout)
```

Then:

```bash
git checkout custom-preset-layout
git rebase upstream/main
```

Conflict policy for this branch:

- Keep upstream's code/import/dependency style unless the feature requires changing it.
- Keep only PR-relevant behavior.
- Delete fork code that upstream now covers.
- Do not include scoped package names, fork author/homepage, npm publishing docs, version suffixes, or other release-only changes.
- Preserve upstream changelog entries. Put PR feature notes under `[Unreleased]` if needed.

Expected feature diff is usually limited to:

- `CHANGELOG.md`
- `README.md`
- `index.ts`
- `powerline-config.ts`
- `presets.ts`
- `tests/custom-items.test.ts`
- `types.ts`

Afterward, verify it is still one PR commit and review the upstream-facing diff:

```bash
git log --oneline --decorate --graph upstream/main..custom-preset-layout
git diff --stat upstream/main..custom-preset-layout
git diff upstream/main..custom-preset-layout
```

## Rebase `release`

Use `--onto` to move only the release commit onto the newly rebased PR branch:

```bash
git checkout release
git rebase --onto custom-preset-layout "$OLD_FEATURE" release
```

Why `--onto "$OLD_FEATURE"`?

Before the feature rebase, `release` sits on the old feature commit:

```text
old-feature <- release-commit
```

After rebasing `custom-preset-layout`, there is a new feature commit:

```text
upstream/main <- new-feature
```

A plain `git rebase custom-preset-layout` can try to replay both the old feature commit and the release commit, causing duplicate feature conflicts. `--onto custom-preset-layout "$OLD_FEATURE" release` means: take commits after the old feature commit, i.e. only the release commit, and replay them onto the new feature commit.

If `OLD_FEATURE` was not saved, recover it from reflog/history before touching `release`:

```bash
git reflog custom-preset-layout
git log --oneline --graph --all --decorate --max-count=40
```

Release branch policy:

- Keep it one commit.
- Keep only publish-time changes: scoped package metadata, install docs, version suffix, changelog release section, and this skill if the process changed.
- Treat `release` as disposable. The PR branch is what matters.
- Version follows the upstream base: upstream `0.5.6` -> fork `0.5.6-1`.

Expected release-only diff is usually limited to:

- `CHANGELOG.md`
- `README.md`
- `package.json`
- `.agents/skills/rebase/SKILL.md` when the process changes

Verify topology:

```bash
git log --oneline --decorate --graph upstream/main..release
git log --oneline upstream/main..custom-preset-layout
git log --oneline custom-preset-layout..release
```

Expected: one feature commit, one release commit.

## Publish temporary fork release

Run local gates:

```bash
npm run check
npm publish --dry-run --tag latest
npm view @thurstonsand/pi-powerline-footer version --json
```

`npm login` and real `npm publish` require browser auth. Ask Thurston to run them manually:

```bash
npm login
npm publish --tag latest
```

Then verify:

```bash
npm view @thurstonsand/pi-powerline-footer version dist-tags time --json
```

Push rebased branches:

```bash
git push --force-with-lease origin custom-preset-layout
git push --force-with-lease origin release
```

## Tag release

After npm publish succeeds, draft the annotated tag message and present it to Thurston for approval **before creating the tag**.

The tag notes should describe fork additions only. They may mention the upstream base in one sentence, but do not list upstream's release notes as fork highlights.

Draft template:

```md
v0.5.6-1

Fork release based on upstream pi-powerline-footer v0.5.6.

Highlights:
- Adds configurable custom preset layouts through powerline.custom.
- Supports explicit left, right, and secondary segment rows.
- Supports separator style configuration for custom layouts.
- Supports per-segment options for configured segments.
- Supports custom:<id> entries for promoted extension statuses.
```

Only after approval:

```bash
VERSION=$(node -p "require('./package.json').version")
UPSTREAM_VERSION=${VERSION%-*}
git tag -a "v$VERSION" \
  -m "v$VERSION" \
  -m "Fork release based on upstream pi-powerline-footer v$UPSTREAM_VERSION." \
  -m "Highlights:" \
  -m "- Adds configurable custom preset layouts through powerline.custom." \
  -m "- Supports explicit left, right, and secondary segment rows." \
  -m "- Supports separator style configuration for custom layouts." \
  -m "- Supports per-segment options for configured segments." \
  -m "- Supports custom:<id> entries for promoted extension statuses."

git show "v$VERSION" --no-patch --format=fuller
git push origin "v$VERSION"
```

Final verification:

```bash
npm view @thurstonsand/pi-powerline-footer version dist-tags --json
git ls-remote --tags origin "v$VERSION*"
```

## Changelog policy

On `custom-preset-layout`, keep PR notes under `[Unreleased]` for upstream review.

On `release`, make the temporary fork release explicit:

```md
## [0.5.6-1] - YYYY-MM-DD

### Added
- **Configurable custom preset layout** — `powerline.preset: "custom"` can now define explicit segment rows, separator style, and per-segment options through `powerline.custom`, including `custom:<id>` entries for promoted extension statuses.

### Changed
- Fork release metadata and install docs now publish under `@thurstonsand/pi-powerline-footer`.
- Release-only package metadata targets Pi's current package scope and this repo skill documents the rebase/publish/tag process.
```

## Update this skill

At the end, after publishing/tagging, update `.agents/skills/rebase/SKILL.md` if anything about the process was wrong, missing, or changed. The skill is the runbook; keep future rebases less annoying.
