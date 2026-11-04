#!/bin/sh
# Publish the current master as one squashed commit to the public repo.
# Usage: npm run release <version>   e.g. npm run release 0.2.0
set -e
V="$1"
[ -n "$V" ] || { echo "Usage: npm run release <version>"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Commit your changes first."; exit 1; }
[ "$(git branch --show-current)" = master ] || { echo "Run from master."; exit 1; }

# Bump version in package.json if needed.
if [ "$(node -p "require('./package.json').version")" != "$V" ]; then
  npm version "$V" --no-git-tag-version >/dev/null
  git commit -qam "Bump version to $V"
fi
git push -q origin master

# One commit with master's files, on top of the last public release.
git fetch -q public 2>/dev/null || true
PARENT=$(git rev-parse -q --verify public/main || true)
COMMIT=$(git commit-tree "master^{tree}" ${PARENT:+-p "$PARENT"} -m "Release v$V")
git tag "v$V" "$COMMIT"
git push -q public "$COMMIT:refs/heads/main" "v$V"
echo "Released v$V"
