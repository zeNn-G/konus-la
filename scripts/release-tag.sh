#!/usr/bin/env bash
# Publish command for changesets/action (release.yml). Runs on every
# changeset-free push to main, so it must be idempotent: if the tag for the
# current root version already exists on the remote, exit 0 without touching
# anything. Otherwise tag v<version>, push it, and create the GitHub Release
# from that version's CHANGELOG.md section.
set -euo pipefail

VERSION=$(bun -e 'console.log(require("./package.json").version)')
TAG="v${VERSION}"

if git ls-remote --exit-code --tags origin "refs/tags/${TAG}" > /dev/null 2>&1; then
  echo "Tag ${TAG} already exists — nothing to release."
  exit 0
fi

git tag "${TAG}"
git push origin "${TAG}"

awk -v ver="${VERSION}" '$0 == "## " ver {f=1; next} /^## / {f=0} f' CHANGELOG.md \
  | gh release create "${TAG}" --title "${TAG}" --notes-file -

# The action parses this exact format to set its published/publishedPackages
# outputs, which gate the chained build-image job.
echo "New tag:  konus-la@${VERSION}"
