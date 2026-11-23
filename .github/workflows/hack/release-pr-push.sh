#!/usr/bin/env bash
# Pushes the formatted changelog that format-changelog.sh made, without a push
# token, to the open release pull request. DIR holds sha, the commit that job
# read, and CHANGELOG.md.
#
# It pushes nothing when the branch moved since that job read it: release-please
# rewrote it, and the next run starts over. It refuses any file but
# CHANGELOG.md, so a job that went wrong can't write anywhere else.
#
# With RELEASE_PLEASE_TOKEN as TOKEN, the push starts CI like any other. With
# the workflow's own token it starts none, and the pull request's checks wait
# for a maintainer (docs/releasing.md).
#
# Usage: .github/workflows/hack/release-pr-push.sh [--dry-run] DIR
# Env: GITHUB_REPOSITORY, GH_TOKEN (read-only, for gh), and unless --dry-run,
#      TOKEN and the commit's author as GIT_AUTHOR_* and GIT_COMMITTER_*.
#      --dry-run makes the commit and shows it, but pushes nothing.
set -euo pipefail

dry_run=false
if [[ ${1:-} == --dry-run ]]; then
  dry_run=true
  shift
fi
dir=${1:?usage: release-pr-push.sh [--dry-run] DIR}
: "${GITHUB_REPOSITORY:?}"
$dry_run || : "${TOKEN:?}"
root=$PWD

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
head=$(git rev-parse FETCH_HEAD)
if [[ $(<"$dir/sha") != "$head" ]]; then
  echo "$branch moved since the changelog was formatted, so nothing was pushed"
  exit 0
fi

files=$(cd "$dir" && find . -mindepth 1 | sed 's|^\./||' | sort | tr '\n' ' ')
if [[ $files != "CHANGELOG.md sha " ]]; then
  echo "::error::$dir holds $files, not just CHANGELOG.md and sha"
  exit 1
fi

git worktree add --quiet --detach "$work" "$head"
cp "$dir/CHANGELOG.md" "$work/CHANGELOG.md"
cd "$work"
git add -- CHANGELOG.md
if git diff --cached --quiet; then
  echo "$branch already has this changelog"
  exit 0
fi
git commit --quiet -m "chore: format the changelog"
if $dry_run; then
  git show --stat HEAD
  echo "Would push that to $branch"
  exit 0
fi
git push --quiet "https://x-access-token:${TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "HEAD:refs/heads/${branch}"
echo "Pushed the formatted changelog to $branch"
