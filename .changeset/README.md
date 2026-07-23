# Changesets

Release notes live here as changeset files. Add one to a PR with `bun changeset`;
every changeset names the single releasable package, `konus-la` (the repo root — all
inner workspace packages are ignored). Merging the standing "Version Packages" PR is
the release button: it bumps the root version, updates `CHANGELOG.md`, tags `vX.Y.Z`,
and builds the Docker image.

Docs: <https://github.com/changesets/changesets>
