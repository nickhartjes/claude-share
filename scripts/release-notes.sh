#!/bin/sh
# Prints Markdown release notes for a tag: the subjects of the commits since the previous release.
# A normal release (v0.2.0) lists everything since the previous normal release, including its
# release candidates; a prerelease (v0.2.0-rc.2) lists what changed since the tag before it.
# Merge commits, the release workflow's own commits and version bumps are left out.
# Usage: scripts/release-notes.sh v0.2.0   (needs the full history and tags: fetch-depth 0)
set -eu
tag=$1
repo=${GITHUB_REPOSITORY:-nickhartjes/specdeck}

case "$tag" in
  *-*) previous=$(git describe --tags --abbrev=0 --match 'v*' "$tag^" 2>/dev/null || true) ;;
  *) previous=$(git tag --list 'v*' --merged "$tag^" --sort=-v:refname | grep -v -- '-' | head -n 1 || true) ;;
esac
range=${previous:+$previous..}$tag

echo "## Changes"
echo
git log --no-merges --reverse --format='%s (%h)%x09%an' "$range" |
  grep -v -e '^Release [0-9]' -e '	github-actions\[bot\]$' |
  cut -f 1 |
  sed 's/^/- /'
echo
echo "Download the installers below, or see [Install](https://github.com/$repo#install)."
if [ -n "$previous" ]; then
  echo
  echo "**Full changelog:** https://github.com/$repo/compare/$previous...$tag"
fi
