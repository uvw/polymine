#!/usr/bin/env bash
# Pushes what the jobs without a push token made for the open release pull
# request: the formatted changelog from format-changelog.sh and the release
# notes from release-notes.sh. Each DIR holds sha, the commit its job read, and
# its files at their paths in the repository. All of them go into one commit.
#
# It pushes nothing when the branch moved since any DIR's job read it:
# release-please rewrote it, and the next run starts over. It refuses any file
# but CHANGELOG.md and the notes for the branch's version, and checks the notes
# again, so a job that went wrong can't write anywhere else.
#
# With RELEASE_PLEASE_TOKEN as TOKEN, the push starts CI like any other. With
# the workflow's own token it starts none, and the pull request's checks wait
# for a maintainer (docs/releasing.md).
#
# Usage: .github/workflows/hack/release-pr-push.sh [--dry-run] DIR...
# Env: GITHUB_REPOSITORY, GH_TOKEN (read-only, for gh), and unless --dry-run,
#      TOKEN and the commit's author as GIT_AUTHOR_* and GIT_COMMITTER_*.
#      --dry-run makes the commit and shows it, but pushes nothing.
set -euo pipefail

dry_run=false
if [[ ${1:-} == --dry-run ]]; then
  dry_run=true
  shift
fi
(($#)) || {
  echo "usage: release-pr-push.sh [--dry-run] DIR..." >&2
  exit 2
}
: "${GITHUB_REPOSITORY:?}"
$dry_run || : "${TOKEN:?}"
root=$PWD
hack=$(cd "$(dirname "$0")" && pwd)

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
version=$(git show FETCH_HEAD:.github/release-please-manifest.json | jq -r '."."')
notes=docs/release-notes/v$version.md

for dir in "$@"; do
  if [[ $(<"$dir/sha") != "$head" ]]; then
    echo "$branch moved since $dir was made, so nothing was pushed"
    exit 0
  fi
done

git worktree add --quiet --detach "$work" "$head"
paths=()
for dir in "$@"; do
  [[ -z $(find "$dir" ! -type f ! -type d) ]] || {
    echo "::error::$dir holds something other than files"
    exit 1
  }
  while IFS= read -r path; do
    path=${path#./}
    case $path in
    sha) continue ;;
    CHANGELOG.md) ;;
    "$notes") bash "$hack/release-notes.sh" verify "$dir/$path" ;;
    *)
      echo "::error::$dir holds $path, which is neither the changelog nor $notes"
      exit 1
      ;;
    esac
    mkdir -p "$(dirname "$work/$path")"
    cp "$dir/$path" "$work/$path"
    paths+=("$path")
  done < <(cd "$dir" && find . -type f)
done

cd "$work"
git add -- "${paths[@]}"
case $(git diff --cached --name-only | sort | tr '\n' ' ') in
'') echo "$branch already has these files" && exit 0 ;;
"CHANGELOG.md $notes ") message="chore: format the changelog and write the release notes" ;;
"CHANGELOG.md ") message="chore: format the changelog" ;;
*) message="chore: write the release notes" ;;
esac
git commit --quiet -m "$message"
if $dry_run; then
  git show --stat HEAD
  echo "Would push that to $branch"
  exit 0
fi
git push --quiet "https://x-access-token:${TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "HEAD:refs/heads/${branch}"
echo "Pushed \"$message\" to $branch"
