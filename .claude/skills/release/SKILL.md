---
name: release
description: Release a new cclens version end to end. Checks that the GitHub CI pipeline passes, versions the pending changesets, publishes @abdofawzi5/cclens to npm (with the owner's 2FA approval) and creates the GitHub Release. Use when the user says "release", "cut a release", "publish a new version", "ship it to npm" or "/release".
disable-model-invocation: true
---

# Release cclens

Ships what is on `main` as a new version: CI green, npm package published, tag pushed, GitHub Release created. Invoking this skill is the user's go-ahead to push to `main` and publish; still stop and ask at the two checkpoints below.

Facts this relies on:

- npm package `@abdofawzi5/cclens`, GitHub repo `abdofawzi5/cclens`, default branch `main`.
- Versions come from changesets in `.changeset/*.md`. `pnpm version-packages` bumps `package.json`, writes `CHANGELOG.md` and syncs `plugin/.claude-plugin/plugin.json`.
- CI is `.github/workflows/ci.yml` (workflow name `CI`), a 3 OS x 3 Node matrix that runs on every push to `main`.
- `pnpm release` runs `changeset publish`, which runs `prepublishOnly` (`pnpm check && pnpm build`), publishes, then creates the local `v<version>` tag.
- npm needs 2FA through a web page. A non-interactive shell fails with `ERR_PNPM_OTP_NON_INTERACTIVE`, so the publish must run in a Terminal panel tab where the owner presses Enter and approves.
- Right after a publish the registry can answer 404 for a minute or two, and the npmjs.com page can lag longer. Neither means the publish failed.

## 1. Preflight

Run these and stop on any problem, telling the user what is wrong:

```bash
git rev-parse --abbrev-ref HEAD   # must be main
git fetch origin && git status -sb # must not be behind origin/main
ls .changeset/*.md | grep -v README # at least one changeset
gh auth status
npm whoami                          # must print the owner's npm user
```

- Not on `main`, or behind `origin/main`: stop and ask.
- Uncommitted changes: show `git status --short` and ask whether to commit them as part of this release (they need a changeset if they change behaviour) or stop.
- No changesets: nothing to release; say so and stop. Offer to write one if there are unreleased commits since the last `v*` tag (`git log $(git describe --tags --abbrev=0)..HEAD --oneline`).
- `npm whoami` fails: ask the owner to run `npm login` in a terminal tab.

## 2. Local checks

```bash
pnpm install --frozen-lockfile
pnpm check && pnpm build && node dist/cli.js --version
```

Any failure: stop, show the failing output, and offer to fix it. Do not release over a red check.

## 3. Version

```bash
pnpm version-packages
```

Read the new version from `package.json` and the new `CHANGELOG.md` section. Confirm `plugin/.claude-plugin/plugin.json` has the same version.

**Checkpoint 1.** Show the user the version (and why it is patch/minor/major: the highest bump among the changesets) and the changelog section. Ask to go ahead. If they decline, undo only the version bump with `git restore package.json CHANGELOG.md plugin/.claude-plugin/plugin.json .changeset` and stop.

Commit (no tag yet; `changeset publish` creates it):

```bash
git add -A
git commit -m "chore(release): <version>" -m "Co-Authored-By: <attribution line from the current system reminder, if any>"
```

## 4. Pipeline must pass

```bash
git push origin main
```

Find the CI run for the pushed commit and wait for it:

```bash
sha=$(git rev-parse HEAD)
gh run list --workflow CI --commit "$sha" --json databaseId,status --jq '.[0]'
gh run watch <databaseId> --exit-status --compact
```

The run can take a few seconds to appear; retry `gh run list` until it does. Run `gh run watch` in the background (it takes a couple of minutes) and wait for its notification instead of polling.

If CI fails: do not publish. Show the failing job with `gh run view <id> --log-failed | tail -80`, fix it in a new commit, push, and wait again. The release commit can stay on `main`; nothing is published until CI is green.

## 5. Publish to npm

Open a Terminal panel tab in the repo (`mcp__terminal__run_in_terminal`, title `npm release`) and run:

```bash
pnpm release
```

**Checkpoint 2.** When the tab shows the npm auth URL / QR code and "Press ENTER to open the URL in your browser", tell the user to click into that tab, press Enter and approve on the npm page, then wait for them to say so. Do not press Enter for them.

Read the tab until it prints `Successfully published: @abdofawzi5/cclens@<version>`. If it fails, show the error and stop.

Confirm on the registry (allow a couple of minutes for 404s to clear):

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://registry.npmjs.org/@abdofawzi5/cclens/<version>?t=$RANDOM"
npm view @abdofawzi5/cclens version --prefer-online
```

## 6. Release on GitHub

```bash
git tag --list v<version>           # changeset publish created it; if not: git tag v<version>
git push origin v<version>
awk '/^## <version>$/{f=1;next}/^## /{if(f)exit}f' CHANGELOG.md > <scratchpad>/release-notes.md
gh release create v<version> --title "v<version>" --notes-file <scratchpad>/release-notes.md --verify-tag
```

## 7. Wrap up

- Offer to update the owner's global install, which their live cclens hooks run from: `npm i -g @abdofawzi5/cclens@<version>`, then `cclens --version` and `cclens doctor`.
- Report: version, npm link `https://www.npmjs.com/package/@abdofawzi5/cclens`, the GitHub Release URL, and the green CI run. Mention that the npmjs.com page may show the old version for a while.
