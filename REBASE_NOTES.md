# Rebase Notes

Notes for future rebases of this fork onto upstream `main`.

## High-level fork intent

When rebasing, preserve these fork features unless explicitly decided otherwise:

- nested `powerline` settings via `settings.ts`
- settings-driven `custom` preset via `powerline.custom`
- custom segment loading via `segment-registry.ts`
- typed segment options / generic `StatusLineSegment`
- fork package metadata on the `release` branch

## Commit-by-commit rebase discipline

Do **not** resolve the whole stack at once.

Rebase each logical commit separately:

1. `settings-centralization`
2. `custom-preset`
3. `release`

Important: do not copy tip-of-branch file contents into an earlier conflicted step. That can accidentally fold later commit content into the wrong rebased commit.

## Known upstream/fork conflict themes

## TypeScript gotcha: `editor as any`

There is a tempting upstream change from:

```ts
!(editor as any).autocompleteProvider;
```

to:

```ts
!editor.autocompleteProvider;
```

In this repo, that direct access fails typecheck because `autocompleteProvider` is a **private** property on the editor type.

Even though `CustomEditor` subclasses `Editor`, private members are still not safely accessible.

So for rebases, keep the pragmatic version:

```ts
!(editor as any).autocompleteProvider;
```

This is not ideal, but it is currently the least noisy working option here.

## Changelog/release handling

During feature-commit rebases:

- keep fork notes in `## [Unreleased]`
- do not prematurely move them into a numbered release section

Only in the final `release` commit should fork release metadata be moved into a versioned release entry.

Current example pattern:

- upstream base version: `0.4.11`
- fork release version: `0.4.11-1`

## Package metadata handling

The `release` commit is where fork publishing metadata belongs:

- package name: `@thurstonsand/pi-powerline-footer`
- fork repository/homepage/issues URLs
- publish config
- fork release version suffix

Do not drag these changes into earlier feature commits unless the original commit specifically owned them.

## Validation checklist after each conflicted step

After resolving a step, run:

```bash
npx tsc -p tsconfig.json --noEmit
npm test
```

Also check for unresolved markers:

```bash
grep -R -n '<<<<<<<\|=======\|>>>>>>>' .
```

## Local noise

Ignore/remove local scratch directories like `eval/` before concluding a rebase if they get in the way.
