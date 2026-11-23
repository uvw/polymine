#!/usr/bin/env bash
# Formats CHANGELOG.md in the open release pull request with Prettier, in a job
# with no token that can push. When that changes it, the script writes the
# result to OUT/CHANGELOG.md and the commit it formatted to OUT/sha, for
# release-pr-push.sh to push. Needs the repository's npm packages (npm ci).
#
# It works in a separate worktree, removed on exit, so the checkout it runs
# from stays as it is.
#
# Usage: .github/workflows/hack/format-changelog.sh OUT
# Env: GITHUB_REPOSITORY, and GH_TOKEN (read-only, for gh).
set -euo pipefail

out=${1:?usage: format-changelog.sh OUT}
mkdir -p "$out"
out=$(cd "$out" && pwd)
: "${GITHUB_REPOSITORY:?}"
root=$PWD
prettier=$root/node_modules/.bin/prettier

work=$(mktemp -d)
cleanup() {
  git -C "$root" worktree remove --force "$work" 2>/dev/null || rm -rf "$work"
}
trap cleanup EXIT

branch=$(gh pr list --repo "$GITHUB_REPOSITORY" --state open --label "autorelease: pending" \
  --json headRefName -q '.[0].headRefName // empty')
if [[ -z $branch ]]; then
  echo "No open release pull request"
  exit 0
fi
git fetch --quiet origin "refs/heads/$branch"
git worktree add --quiet --detach "$work" FETCH_HEAD
cd "$work"
# Prettier loads the config's plugins from the worktree, which has no packages
# of its own. Git ignores node_modules, so the link never shows in the diff.
ln -s "$root/node_modules" node_modules
"$prettier" --config "$root/.prettierrc.yaml" --write CHANGELOG.md
if git diff --quiet -- CHANGELOG.md; then
  echo "CHANGELOG.md in $branch is already formatted"
  exit 0
fi
cp CHANGELOG.md "$out/CHANGELOG.md"
git rev-parse HEAD >"$out/sha"
echo "Formatted CHANGELOG.md in $branch"
