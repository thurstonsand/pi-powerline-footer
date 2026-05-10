# Release Process

Use this checklist to publish `@thurstonsand/pi-powerline-footer` to npm.

## Fork patch release

1. Confirm the working tree contains only intended changes.

   ```bash
   git status --short
   ```

2. Run the quality gate.

   ```bash
   npm run check
   ```

3. Bump the fork package version without letting npm create its own commit or tag.

   ```bash
   npm version prerelease --preid 1 --no-git-tag-version
   ```

   For this fork, prefer upstream-version suffixes like `0.5.1-1`, `0.5.1-2`, then reset to `0.5.2-1` when rebasing onto upstream `0.5.2`.

4. Commit the release changes.

   ```bash
   git add package.json CHANGELOG.md README.md RELEASE.md
   git commit
   ```

5. Confirm npm authentication and package contents.

   ```bash
   npm whoami
   npm publish --dry-run --tag latest
   ```

6. Publish to npm.

   ```bash
   npm publish --tag latest
   ```

7. Create and push the matching git tag.

   ```bash
   VERSION=$(node -p "require('./package.json').version")
   git tag -a "v$VERSION" -m "v$VERSION"
   git push origin release
   git push origin "v$VERSION"
   ```

8. Confirm the registry version.

   ```bash
   npm view @thurstonsand/pi-powerline-footer version
   ```

## Notes

- Pi first-party packages moved from `@mariozechner/*` to `@earendil-works/*` in the Pi 0.74 release line. Keep release branch peer/dev dependencies on `@earendil-works/*`.
- npm requires an explicit `--tag` for prerelease-style versions such as `0.5.1-1`; use `--tag latest` when this fork release should be the default install target.
- If `npm whoami` returns `E401`, run `npm login` before publishing.
- If publishing succeeds but git push fails, do not republish. Fix only the git push/tag state.
