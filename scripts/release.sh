#!/bin/sh
# Publish the current version as one squashed commit to the public repo.
# Bump first with `npm run bump`; versions between releases are skipped.
set -e
V=$(node -p "require('./package.json').version")
[ -z "$(git status --porcelain)" ] || { echo "Commit your changes first."; exit 1; }
[ "$(git branch --show-current)" = master ] || { echo "Run from master."; exit 1; }
git fetch -q public --tags 2>/dev/null || true
if git rev-parse -q --verify "refs/tags/v$V" >/dev/null; then
  echo "v$V is already released. Run npm run bump first."; exit 1
fi
printf "Publish v$V to the PUBLIC repo? [y/N] "
read -r ok
[ "$ok" = y ] || { echo "Cancelled."; exit 1; }
git push -q origin master

# One commit with master's files, on top of the last public release.
# Private files (CHANGES.md, AI files, Dependabot) are left out of the public tree.
IDX=$(mktemp)
GIT_INDEX_FILE=$IDX git read-tree master
GIT_INDEX_FILE=$IDX git rm -q -r --cached --ignore-unmatch CHANGES.md CLAUDE.md CLAUDE.local.md AGENTS.md .claude .github/dependabot.yml
TREE=$(GIT_INDEX_FILE=$IDX git write-tree)
rm -f "$IDX"
PARENT=$(git rev-parse -q --verify public/main || true)
COMMIT=$(git commit-tree "$TREE" ${PARENT:+-p "$PARENT"} -m "Release v$V")
git tag "v$V" "$COMMIT"
git push -q public "$COMMIT:refs/heads/main" "v$V"
echo "Released v$V"
