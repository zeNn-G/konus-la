# Research: changesets single-package release flow (#101)

Resolves wayfinder research ticket [#101](https://github.com/zeNn-G/konus-la/issues/101).
Goal state (charter decision 8): changesets in PRs → standing "Version Packages" PR →
merging it bumps ONE root version + `CHANGELOG.md` + tags `vX.Y.Z` → tag triggers the
image-build workflow pushing `ghcr.io/zenn-g/konus-la`. First release must be `v1.0.0`.

Versions researched against: `@changesets/cli` **2.31.1** (latest stable; 3.0.0 is in
`next` prerelease), `changesets/action` **v1.9.0** (latest release, 2026-06-03; v2 exists
only as `v2.0.0-next.*` prereleases with renamed kebab-case inputs — do not use its
main-branch README for a `@v1` workflow).

Every "Verified (experiment)" claim below was reproduced locally on 2026-07-19 with
bun 1.3.14 + `@changesets/cli@2.31.1`, either in a scratch Bun-workspace monorepo or in
this repo's worktree itself.

---

## 1. Single-package mode in a Bun workspace monorepo

### The catch: changesets does not see the workspace root by default

Changesets discovers packages via `@manypkg/get-packages`, which returns only the
packages matched by the `workspaces` globs — the root `package.json` of a monorepo is
**not** a versionable package. The sanctioned fix comes from the changesets maintainers
themselves: the error-message guidance added in
[changesets/changesets#1506](https://github.com/changesets/changesets/pull/1506) reads
*"If you intend to version the root package, add `"."` to the list of workspaces"*.

**Verified (experiment):** adding `"."` to `workspaces.packages` in this repo's root
`package.json` (object form, with the `catalog` key present) makes the root a
first-class changesets package:

- `bun install` accepts `"."` in the workspaces list without complaint (both array and
  object form) — bun docs on workspaces: <https://bun.com/docs/pm/workspaces>.
- `bun x @changesets/cli@2.31.1 version` with a changeset naming `"konus-la"` bumped
  **only** the root `package.json` and wrote `CHANGELOG.md` at the repo root. No
  workspace `package.json` was touched.
- `@manypkg/get-packages@1.1.3` (the old major bundled by `changesets/action@v1.9.0`)
  also resolves the layout: it detects the tool as `yarn` (bun uses the same
  `workspaces` field) and returns `konus-la` + all workspace packages, root included via
  `"."`. So both the CLI (which bundles manypkg v2 with an explicit
  [Bun tool](https://github.com/Thinkmill/manypkg) — README: "Manypkg is a linter for
  `package.json` files in Yarn, npm, pnpm, Bun or Lerna monorepos") and the action
  tolerate a Bun workspace. No pnpm/npm lockfile is consulted for package discovery.

### Config: `privatePackages` + `ignore`, no `fixed`/`linked`

Semantics, per the config docs
(<https://github.com/changesets/changesets/blob/main/docs/config-file-options.md>) and
the app-versioning doc
(<https://github.com/changesets/changesets/blob/main/docs/versioning-apps.md>):

- `privatePackages` defaults to `{ version: true, tag: false }`. `version: true` lets
  private packages (like the root, which is `"private": true`) be versioned;
  `tag: false` keeps `changeset tag`/`changeset publish` from creating tags for them.
  The versioning-apps doc is explicit that changesets supports exactly this use case
  ("versioning apps and non-npm packages... Docker images"), requiring only a
  `package.json` with `name`, `private`, and `version`.
- `ignore` excludes packages from changesets/publishing. **Verified (experiment):**
  glob patterns work — `"ignore": ["@konus-la/*", "web", "server"]` was accepted and
  the ignored packages were untouched by `changeset version`. Documented caveat: a
  changeset that names both an ignored and a non-ignored package fails at publish; our
  changesets will only ever name `konus-la`, so this cannot occur. The docs also note
  ignored private deps are safe for a private app to depend on (no stale npm refs).
- `fixed` / `linked` are for lockstep-versioning *groups of published packages* — not
  needed here; leave them `[]`. Versioning all workspaces in a fixed group would churn
  nine `package.json` files per release for no benefit.
- **Verified (experiment):** workspace packages *without* a `version` field
  (`@konus-la/api`, `@konus-la/auth`, `@konus-la/db`, `server` today) do not crash
  `changeset version` when they are ignored. (Adding `"private": true` to the four
  packages missing it is still good hygiene.)

## 2. Action wiring: version-PR-only mode, tagging without npm publish

`changesets/action@v1` behavior (README at v1.9.0:
<https://github.com/changesets/action/blob/v1.9.0/README.md>, source:
<https://github.com/changesets/action/blob/v1.9.0/src/run.ts>):

- With pending changesets on `main`, it runs the `version` input (default
  `changeset version`) on a `changeset-release/main` branch and opens/updates the
  "Version Packages" PR.
- With **no** pending changesets, it runs the `publish` input — this is the hook for
  tagging without npm. Note carefully: this fires on **every** push to `main` that has
  zero pending changesets (README: "a commit without any new changesets can always land
  on your base branch after a successful publish"), so the publish command **must be
  idempotent** (skip if the tag already exists).
- Tag/release detection: the action parses the publish command's stdout for
  `New tag: <name>@<version>` lines to set the `published` / `publishedPackages`
  outputs. With `createGithubReleases: true` it then pushes tag `<name>@<version>`
  itself (`git.pushTag`) and creates a GitHub Release.

### Why not `publish: bunx changeset tag`

**Verified (experiment):** in a workspace monorepo, `changeset tag` creates
`<name>@<version>` tags — the scratch run produced `mono-root@1.0.0`, and this repo
would get `konus-la@1.0.0`, not `v1.0.0`. The `v`-prefix form is reserved for
single-package repos: the CLI's tag builder is literally
`tool.type !== "root" ? `${pkg.name}@${pkg.newVersion}` : `v${pkg.newVersion}``
(<https://github.com/changesets/changesets/blob/main/packages/cli/src/commands/git-tag/index.ts>),
and the action mirrors the same split in `runPublish` (`tool !== "root"` branch). Since
the charter requires `vX.Y.Z`, use a **custom publish script** that tags
`v${rootVersion}` itself, and set `createGithubReleases: false` so the action does not
additionally push a `konus-la@X.Y.Z` tag. The script may still print
`New tag: konus-la@X.Y.Z` to populate the action's `published`/`publishedPackages`
outputs (used to gate the chained build job). The action exports `GITHUB_TOKEN` into the
publish script's env, so `gh` works inside it unauthenticated-setup-free.

Also required (GitHub side): the action creates PRs with the workflow token, so the repo
setting **Settings → Actions → General → "Allow GitHub Actions to create and approve
pull requests"** must be enabled, and the workflow needs
`permissions: contents: write, pull-requests: write`
(<https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#preventing-github-actions-from-creating-or-approving-pull-requests>).

## 3. The tag-trigger gotcha

**Confirmed, still current.** GitHub Actions docs, "Triggering a workflow from a
workflow"
(<https://docs.github.com/en/actions/using-workflows/triggering-a-workflow#triggering-a-workflow-from-a-workflow>):
*"events triggered by the `GITHUB_TOKEN` will not create a new workflow run"*, with only
`workflow_dispatch` and `repository_dispatch` as exceptions. The documented workarounds
are a **personal access token** or a **GitHub App installation token** stored as a
secret. The changesets action pushes release tags with the workflow's token
(`git.pushTag` in `run.ts`), so an `on: push: tags: [v*]` build workflow will silently
never fire from it.

This exact failure is changesets/action issue
[#669](https://github.com/changesets/action/issues/669) ("Tags created by
`changeset tag` don't trigger workflows with `on.push.tags`"). Two extra facts from that
thread:

- A maintainer-endorsed workaround is `commitMode: github-api` **plus a PAT or GitHub
  App token** (the changesets org itself uses a GitHub App in its publish workflow).
  The github-api commit mode alone with the default `GITHUB_TOKEN` does *not* help.
- Separate platform limit: pushing **more than 3 tags at once** never triggers
  `on.push.tags` workflows regardless of token
  (<https://github.com/orgs/community/discussions/56152>). Irrelevant for this repo's
  single-tag releases, but worth knowing.

### Options for a solo-maintainer public repo

| Option | Cost | Failure mode |
|---|---|---|
| Fine-grained PAT secret (checkout with it, or `commitMode: github-api` + PAT) | create + store secret | **expires; releases silently stop until rotated** |
| GitHub App + token action | one-time app setup, 2 secrets | none ongoing; heaviest setup |
| `workflow_call` chaining — release workflow invokes the build workflow as a reusable workflow after tagging | zero secrets | none; build runs inside the release run |

**Recommendation: `workflow_call` chaining.** Reusable workflows
(<https://docs.github.com/en/actions/using-workflows/reusing-workflows>) let the build
workflow declare both `on: push: tags: ["v*"]` *and* `on: workflow_call`; the release
workflow calls it as a second job gated on `published == 'true'`, passing the tag ref.
The `vX.Y.Z` tag still exists for humans, `git describe`, and GitHub Releases — and a
manually pushed tag (from a dev machine, i.e. not GITHUB_TOKEN) still triggers the same
build via the push path. No secret to rotate is the decisive property for a solo
maintainer; a lapsed PAT is the classic way this pipeline dies quietly a year later.
(Inference/judgment call — both PAT and App token are documented and workable.)

## 4. First release as v1.0.0

**Verified (experiment):** with the root at `"version": "0.0.0"`, a single `major`
changeset naming `konus-la` makes `changeset version` produce exactly `1.0.0`
(semver major increment of 0.0.0), with a root `CHANGELOG.md` beginning
`## 1.0.0`. So:

1. In the setup PR, set root `"version": "0.0.0"` (the field does not exist today) and
   commit a changeset: `--- "konus-la": major ---` "Initial release."
2. The first "Version Packages" PR will show `konus-la@1.0.0`; merging it tags `v1.0.0`
   and builds the first image.

Do **not** pre-set the version to `1.0.0` manually — then the first changeset would land
as 1.0.1/1.1.0/2.0.0 and `v1.0.0` itself would never be tagged by the pipeline.

---

## Recommended setup

### Root `package.json` deltas

```jsonc
{
  "name": "konus-la",
  "private": true,
  "version": "0.0.0",                  // NEW — becomes 1.0.0 on first release
  "workspaces": {
    "packages": ["apps/*", "packages/*", "."],   // NEW: "."
    "catalog": { /* unchanged */ }
  },
  "devDependencies": {
    "@changesets/cli": "^2.31.1"       // NEW — `bun changeset` locally + CI version cmd
  }
}
```

(`bun install` rewrites `bun.lock` once for the new workspace entry — verified harmless.)

### `.changeset/config.json`

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.1/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": ["@konus-la/*", "web", "server"],
  "privatePackages": { "version": true, "tag": false }
}
```

`tag: false` (the default) is deliberate: tagging is owned by the release script below,
so a stray `changeset tag` can never mint a `konus-la@X.Y.Z` tag. Optional nicety:
swap `changelog` for `["@changesets/changelog-github", { "repo": "zeNn-G/konus-la" }]`
(extra devDep `@changesets/changelog-github`; links PRs/authors in the changelog).

### `scripts/release-tag.sh` (the `publish` command)

```bash
#!/usr/bin/env bash
set -euo pipefail
VERSION=$(bun -e 'console.log(require("./package.json").version)')
TAG="v${VERSION}"
if git ls-remote --exit-code --tags origin "refs/tags/${TAG}" > /dev/null 2>&1; then
  echo "Tag ${TAG} already exists — nothing to release."   # idempotency guard
  exit 0
fi
git tag "${TAG}"
git push origin "${TAG}"
# Release notes: extract this version's section from CHANGELOG.md
awk -v ver="${VERSION}" '$0 ~ "^## "ver"$" {f=1; next} /^## / {f=0} f' CHANGELOG.md \
  | gh release create "${TAG}" --title "${TAG}" --notes-file -
echo "New tag:  konus-la@${VERSION}"   # lets the action set published/publishedPackages
```

### `.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    branches: [main]

concurrency: ${{ github.workflow }}-${{ github.ref }}

permissions:
  contents: write
  pull-requests: write

jobs:
  release:
    runs-on: ubuntu-latest
    outputs:
      published: ${{ steps.changesets.outputs.published }}
      publishedPackages: ${{ steps.changesets.outputs.publishedPackages }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0            # changesets diffs against baseBranch history
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - name: Version PR or tag release
        id: changesets
        uses: changesets/action@v1
        with:
          version: bunx changeset version
          publish: bash scripts/release-tag.sh
          createGithubReleases: false     # release-tag.sh owns the v-tag + GH Release
          commit: "chore: version packages"
          title: "Version Packages"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  build-image:                       # chained — does NOT rely on the tag event
    needs: release
    if: needs.release.outputs.published == 'true'
    uses: ./.github/workflows/docker-image.yml
    permissions:
      contents: read
      packages: write
    with:
      ref: v${{ fromJson(needs.release.outputs.publishedPackages)[0].version }}
```

### `.github/workflows/docker-image.yml`

```yaml
name: Docker image

on:
  push:
    tags: ["v*"]                    # manual tag pushes still work (non-GITHUB_TOKEN)
  workflow_call:
    inputs:
      ref:
        required: true
        type: string

permissions:
  contents: read
  packages: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.ref || github.ref }}
      - name: Derive version
        id: meta
        run: echo "version=${REF#v}" >> "$GITHUB_OUTPUT"
        env:
          REF: ${{ inputs.ref || github.ref_name }}
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ghcr.io/zenn-g/konus-la:${{ steps.meta.outputs.version }}
            ghcr.io/zenn-g/konus-la:latest
```

### Flow recap

1. Feature PRs include a changeset naming `konus-la` (`bun changeset`).
2. Push to `main` with pending changesets → action maintains the "Version Packages" PR
   (root version + root `CHANGELOG.md`).
3. Merging that PR → next `main` run has no changesets → `release-tag.sh` tags
   `vX.Y.Z`, creates the GitHub Release, and the chained `build-image` job pushes
   `ghcr.io/zenn-g/konus-la:X.Y.Z` + `:latest`.
4. First release: seed `0.0.0` + one major changeset → `v1.0.0`.

### Surprises vs the charter wording (spec-relevant)

- Root versioning requires adding `"."` to the workspaces globs — changesets cannot see
  the monorepo root otherwise.
- `changeset tag` cannot produce `vX.Y.Z` in a monorepo (always `name@version`); the
  `v`-tag must come from a custom publish script.
- The chosen build trigger is `workflow_call` chaining, with `on: push: tags: v*` kept
  only as a secondary/manual path — because the action pushes tags with `GITHUB_TOKEN`,
  which never triggers other workflows.
- The publish script runs on every changeset-free push to `main`, so it must be
  idempotent (remote-tag existence guard).
