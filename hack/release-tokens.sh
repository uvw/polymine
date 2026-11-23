#!/usr/bin/env bash
# Sets up the tokens the release workflows use, as secrets of the release
# environment on uvw/polymine, which only jobs on main or a v* tag can read:
#
#   RELEASE_PLEASE_TOKEN  opens and updates the release pull request, so its
#                         checks start without a maintainer's approval
#   HOMEBREW_TAP_TOKEN    pushes the cask to uvw/homebrew-tap
#   WINGET_TOKEN          opens winget-pkgs pull requests from uvw/winget-pkgs
#   COPILOT_TOKEN         lets Copilot CLI write the release notes
#
# It also forks microsoft/winget-pkgs when the fork is missing. GitHub creates
# tokens only in the browser, so the script opens each token page with its
# fields filled in, then reads the token you paste. It never prints a token or
# passes one on a command line. A secret that is already set is skipped, unless
# its name is given to renew it.
#
# Usage: hack/release-tokens.sh [SECRET...]
set -euo pipefail

repo=uvw/polymine
env=release
tap=uvw/homebrew-tap
fork=uvw/winget-pkgs

say() { printf '%s\n' "$*"; }
die() {
  printf 'release-tokens: %s\n' "$*" >&2
  exit 1
}

open_url() {
  say "  $1"
  if command -v open >/dev/null 2>&1; then
    open "$1"
  elif command -v rundll32.exe >/dev/null 2>&1; then
    # Git Bash and WSL: Windows' URL handler opens the default browser, and no
    # shell sits between, so the & in a query stays. cmd's start cuts the URL
    # at the first &, and explorer.exe opens a folder window for a query.
    rundll32.exe url.dll,FileProtocolHandler "$1"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$1" >/dev/null 2>&1
  fi
}

# read_token NAME reads a token without echoing it, into the variable token.
read_token() {
  token=
  while [[ -z $token ]]; do
    read -rsp "Paste the $1 token (it is not shown): " token </dev/tty
    printf '\n'
  done
}

# wanted SECRET reports whether to set SECRET this run: it was named, or no
# names were given and it is not set yet.
renew=("$@")
existing=
wanted() {
  if [[ ${#renew[@]} -gt 0 ]]; then
    [[ " ${renew[*]} " == *" $1 "* ]]
  else
    [[ $'\n'$existing$'\n' != *$'\n'$1$'\n'* ]] || {
      say "   $1 is already set; name it to renew it"
      return 1
    }
  fi
}

for name in "$@"; do
  case $name in
  RELEASE_PLEASE_TOKEN | HOMEBREW_TAP_TOKEN | WINGET_TOKEN | COPILOT_TOKEN) ;;
  *) die "$name is not a secret this script sets" ;;
  esac
done

command -v gh >/dev/null 2>&1 || die "the GitHub CLI (gh) is not installed"
# GitHub refuses a token whose name another of your tokens has, so each name
# carries the day it was made, and a renewed token sits beside the old one
# until you revoke it.
today=$(date +%Y-%m-%d)
gh auth status >/dev/null 2>&1 || die "gh is not signed in: run gh auth login"
existing=$(gh secret list -R "$repo" --env "$env" --json name -q '.[].name') ||
  die "cannot list the secrets of the $env environment on $repo; create it first (docs/releasing.md)"

say "1. The winget-pkgs fork"
if gh repo view "$fork" >/dev/null 2>&1; then
  say "   $fork exists"
else
  gh repo fork microsoft/winget-pkgs --clone=false --default-branch-only >/dev/null
  say "   forked microsoft/winget-pkgs to $fork"
fi

say ""
say "2. RELEASE_PLEASE_TOKEN: a fine-grained token for $repo"
if wanted RELEASE_PLEASE_TOKEN; then
  say "   The page opens with the name, owner, expiry, and Contents and Pull requests"
  say "   set to write. Under Repository access, choose \"Only select repositories\""
  say "   and pick $repo, then Generate token and copy it."
  open_url "https://github.com/settings/personal-access-tokens/new?name=polymine+release-please+$today&description=release-please+opens+the+polymine+release+pull+request&target_name=uvw&expires_in=366&contents=write&pull_requests=write"
  read_token "release-please"
  push=$(GH_TOKEN=$token gh api "repos/$repo" -q .permissions.push 2>/dev/null) || push=
  [[ $push == true ]] || die "that token cannot write to $repo; check its repository access and Contents permission"
  GH_TOKEN=$token gh api "repos/$repo/pulls?per_page=1" >/dev/null 2>&1 ||
    die "that token cannot read $repo's pull requests; check its Pull requests permission"
  printf '%s' "$token" | gh secret set RELEASE_PLEASE_TOKEN -R "$repo" --env "$env"
  say "   saved RELEASE_PLEASE_TOKEN in the $env environment on $repo"
fi

say ""
say "3. HOMEBREW_TAP_TOKEN: a fine-grained token that can push to $tap"
if wanted HOMEBREW_TAP_TOKEN; then
  say "   The page opens with the name, owner, expiry, and Contents: write filled in."
  say "   Under Repository access, choose \"Only select repositories\" and pick"
  say "   $tap, then Generate token and copy it. The token claudes uses works too,"
  say "   if it's still valid: paste that one instead."
  open_url "https://github.com/settings/personal-access-tokens/new?name=polymine+homebrew-tap+$today&description=Release+workflow+pushes+the+polymine+cask+to+$tap&target_name=uvw&expires_in=366&contents=write"
  read_token "Homebrew tap"
  push=$(GH_TOKEN=$token gh api "repos/$tap" -q .permissions.push 2>/dev/null) || push=
  [[ $push == true ]] || die "that token cannot push to $tap; check its repository access and Contents permission"
  printf '%s' "$token" | gh secret set HOMEBREW_TAP_TOKEN -R "$repo" --env "$env"
  say "   saved HOMEBREW_TAP_TOKEN in the $env environment on $repo"
fi

say ""
say "4. WINGET_TOKEN: a classic token with the public_repo and workflow scopes"
if wanted WINGET_TOKEN; then
  say "   winget's tools open pull requests on microsoft/winget-pkgs from your fork,"
  say "   which only a classic token can do. Check that public_repo and workflow"
  say "   are ticked, set an expiry, then Generate token and copy it."
  open_url "https://github.com/settings/tokens/new?scopes=public_repo,workflow&description=polymine+winget+releases+$today"
  read_token "winget"
  scopes=$(GH_TOKEN=$token gh api -i user 2>/dev/null | tr -d '\r' | sed -n 's/^[Xx]-[Oo][Aa]uth-[Ss]copes: //p') || scopes=
  [[ ",${scopes// /}," == *,public_repo,* ]] || die "that token lacks the public_repo scope (it has: ${scopes:-none})"
  printf '%s' "$token" | gh secret set WINGET_TOKEN -R "$repo" --env "$env"
  say "   saved WINGET_TOKEN in the $env environment on $repo"
fi

say ""
say "5. COPILOT_TOKEN: a fine-grained token that can make Copilot requests"
if wanted COPILOT_TOKEN; then
  say "   The page opens with the name, owner, expiry, and the account permission"
  say "   Copilot Requests filled in. It needs no repository access. Generate the"
  say "   token and copy it. Each run spends Copilot AI credits from this account"
  say "   (docs/releasing.md, \"Release notes\")."
  open_url "https://github.com/settings/personal-access-tokens/new?name=polymine+release+notes+$today&description=Copilot+CLI+writes+the+polymine+release+notes&target_name=uvw&expires_in=366&copilot_requests=write"
  read_token "Copilot"
  # Checking the Copilot Requests permission would spend a request.
  GH_TOKEN=$token gh api user >/dev/null 2>&1 || die "GitHub does not accept that token"
  printf '%s' "$token" | gh secret set COPILOT_TOKEN -R "$repo" --env "$env"
  say "   saved COPILOT_TOKEN in the $env environment on $repo"
fi
unset token

say ""
say "Done."
