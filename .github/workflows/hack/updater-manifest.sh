#!/usr/bin/env bash
# Names the release's updater artifacts and writes latest.json, the manifest
# the installed app reads from the latest release to find an update.
#
#   files DIR VERSION  prints the path of each updater artifact in DIR: the
#                      macOS app archives and the Windows installer. Fails
#                      unless each is there exactly once.
#   manifest DIR TAG [NOTES]
#                      prints latest.json for TAG, with each artifact's
#                      download URL and the contents of its .sig file, and
#                      NOTES, a Markdown file, as the notes when it exists.
#                      Fails unless every signature is from the key in
#                      src-tauri/tauri.conf.json and signs TAG's version.
#   test               runs both modes on generated fixtures.
#
# UPDATER_PUBKEY replaces the public key from tauri.conf.json, for the tests.
# PUB_DATE replaces the current time as the publish date.
set -euo pipefail

root=$(cd "$(dirname "$0")/../../.." && pwd)
repo=${GITHUB_REPOSITORY:-uvw/polymine}

die() {
  echo "::error::$*" >&2
  exit 1
}

# platforms VERSION prints each manifest platform and its artifact's name.
platforms() {
  printf '%s %s\n' \
    darwin-aarch64 "Polymine_$1_aarch64.app.tar.gz" \
    darwin-x86_64 "Polymine_$1_x64.app.tar.gz" \
    windows-x86_64 "Polymine_$1_x64-setup.exe"
}

files() {
  local dir=${1:?usage: updater-manifest.sh files DIR VERSION} version=${2:?usage: updater-manifest.sh files DIR VERSION}
  local platform name found
  [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "'$version' is not a MAJOR.MINOR.PATCH version"
  while read -r platform name; do
    found=$(find "$dir" -name "$name" -type f | wc -l)
    ((found == 1)) || die "$dir has $((found)) copies of $name, the $platform artifact"
    find "$dir" -name "$name" -type f
  done < <(platforms "$version")
}

# key_id prints the eight-byte key id, in hex, of a minisign key or signature
# given as the base64 that Tauri writes: the id follows a two-byte algorithm.
key_id() {
  base64 -d <<<"$1" 2>/dev/null | sed -n 2p | base64 -d 2>/dev/null | head -c 10 | tail -c 8 | od -An -tx1 | tr -d ' \n'
}

manifest() {
  local dir=${1:?usage: updater-manifest.sh manifest DIR TAG [NOTES]} tag=${2:?usage: updater-manifest.sh manifest DIR TAG [NOTES]}
  local notes_file=${3:-} version pubkey want platform name file sig text id notes platforms_json
  version=${tag#v}
  [[ $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "'$tag' is not a vMAJOR.MINOR.PATCH tag"
  pubkey=${UPDATER_PUBKEY:-$(jq -r '.plugins.updater.pubkey' "$root/src-tauri/tauri.conf.json" | tr -d '\r')}
  want=$(key_id "$pubkey")
  [[ ${#want} == 16 ]] || die "the updater public key has no key id"

  platforms_json='{}'
  while read -r platform name; do
    file=$(files "$dir" "$version" | grep -F "/$name") || die "no $name in $dir"
    [[ -f $file.sig ]] || die "$name has no signature: $name.sig is missing"
    sig=$(tr -d '\r\n' <"$file.sig")
    text=$(base64 -d <<<"$sig" 2>/dev/null) || die "$name.sig is not base64"
    [[ $text == "untrusted comment: "* ]] || die "$name.sig is not a minisign signature"
    id=$(key_id "$sig")
    [[ $id == "$want" ]] || die "$name.sig is from key $id, not the app's key $want"
    # The app refuses an update whose signature doesn't name its version.
    grep -qE "^trusted comment: .*(^|[[:space:]])version:v?$version([[:space:]]|$)" <<<"$text" ||
      die "$name.sig does not sign version $version"
    platforms_json=$(jq -c --arg p "$platform" --arg sig "$sig" \
      --arg url "https://github.com/$repo/releases/download/$tag/$name" \
      '.[$p] = {signature: $sig, url: $url}' <<<"$platforms_json")
  done < <(platforms "$version")

  if [[ -n $notes_file && -f $notes_file ]]; then
    notes=$(<"$notes_file")
  else
    notes="Polymine $version. The release notes are at https://github.com/$repo/releases/tag/$tag."
  fi
  jq -n --arg version "$version" --arg notes "$notes" \
    --arg date "${PUB_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}" --argjson platforms "$platforms_json" \
    '{version: $version, notes: $notes, pub_date: $date, platforms: $platforms}'
}

# fake_key ID prints a minisign public key with the eight-byte hex ID, as
# Tauri's base64.
fake_key() {
  {
    printf 'untrusted comment: minisign public key: %s\n' "$1"
    {
      printf 'Ed'
      printf '%s' "$1" | sed 's/../\\x&/g' | xargs -0 printf
      head -c 32 /dev/zero
    } | base64 -w0
    printf '\n'
  } | base64 -w0
}

# fake_sig ID COMMENT prints a signature from key ID with the trusted COMMENT.
fake_sig() {
  {
    printf 'untrusted comment: signature from tauri secret key\n'
    {
      printf 'ED'
      printf '%s' "$1" | sed 's/../\\x&/g' | xargs -0 printf
      head -c 64 /dev/zero
    } | base64 -w0
    printf '\ntrusted comment: %s\n' "$2"
    head -c 64 /dev/zero | base64 -w0
    printf '\n'
  } | base64 -w0
}

# expect_fail NAME CMD... passes when CMD fails.
expect_fail() {
  local name=$1 why
  shift
  if why=$( ("$@") 2>&1 >/dev/null); then
    die "test: $name passed and should have failed"
  fi
  echo "ok   $name is refused: ${why##*::error::}"
}

# jqr runs jq -r without the carriage returns jq writes on Windows.
jqr() {
  jq -r "$@" | tr -d '\r'
}

selftest() {
  local dist key other json name
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  dist=$tmp/dist
  key=0123456789abcdef
  other=fedcba9876543210
  export UPDATER_PUBKEY PUB_DATE=2026-11-22T12:00:00Z
  UPDATER_PUBKEY=$(fake_key "$key")

  mkdir -p "$dist/mac-arm" "$dist/mac-intel"
  echo arm >"$dist/mac-arm/Polymine_1.2.3_aarch64.app.tar.gz"
  echo intel >"$dist/mac-intel/Polymine_1.2.3_x64.app.tar.gz"
  echo exe >"$dist/Polymine_1.2.3_x64-setup.exe"
  echo dmg >"$dist/Polymine_1.2.3_x64.dmg"
  [[ $(files "$dist" 1.2.3 | wc -l) == 3 ]] || die "test: files did not find three artifacts"
  ! files "$dist" 1.2.3 | grep -q dmg || die "test: files listed the disk image"
  echo "ok   files lists the three updater artifacts"

  while read -r name; do
    fake_sig "$key" "timestamp:1795000000	file:$(basename "$name")	version:1.2.3" >"$name.sig"
  done < <(files "$dist" 1.2.3)
  json=$(manifest "$dist" v1.2.3 /nonexistent)
  [[ $(jqr .version <<<"$json") == 1.2.3 ]] || die "test: the manifest has the wrong version"
  [[ $(jqr .pub_date <<<"$json") == "$PUB_DATE" ]] || die "test: the manifest has the wrong date"
  [[ $(jqr '.platforms | keys | join(" ")' <<<"$json") == "darwin-aarch64 darwin-x86_64 windows-x86_64" ]] ||
    die "test: the manifest has the wrong platforms"
  [[ $(jqr '.platforms["windows-x86_64"].url' <<<"$json") == "https://github.com/$repo/releases/download/v1.2.3/Polymine_1.2.3_x64-setup.exe" ]] ||
    die "test: the manifest has the wrong Windows URL"
  [[ $(jqr '.platforms["darwin-aarch64"].signature' <<<"$json") == $(<"$dist/mac-arm/Polymine_1.2.3_aarch64.app.tar.gz.sig") ]] ||
    die "test: the manifest has the wrong signature"
  jqr -e '.notes | contains("releases/tag/v1.2.3")' <<<"$json" >/dev/null || die "test: the notes do not link the release"
  echo "ok   manifest writes every platform with its URL and signature"

  printf '## TL;DR\n\n- **New:** a tiling\n' >"$tmp/notes.md"
  [[ $(manifest "$dist" v1.2.3 "$tmp/notes.md" | jqr .notes) == "$(<"$tmp/notes.md")" ]] ||
    die "test: the manifest did not take the notes file"
  echo "ok   manifest takes the release notes when there are some"

  expect_fail "a prerelease tag" manifest "$dist" v1.2.3-rc.1
  expect_fail "a version with no artifacts" manifest "$dist" v1.2.4
  cp "$dist/Polymine_1.2.3_x64-setup.exe" "$dist/mac-arm/"
  expect_fail "an artifact found twice" files "$dist" 1.2.3
  rm "$dist/mac-arm/Polymine_1.2.3_x64-setup.exe"

  local sig=$dist/Polymine_1.2.3_x64-setup.exe.sig good
  good=$(<"$sig")
  rm "$sig"
  expect_fail "a missing signature" manifest "$dist" v1.2.3
  echo 'not base64 at all!' >"$sig"
  expect_fail "a signature that is not base64" manifest "$dist" v1.2.3
  fake_sig "$other" "timestamp:1795000000	file:x	version:1.2.3" >"$sig"
  expect_fail "a signature from another key" manifest "$dist" v1.2.3
  fake_sig "$key" "timestamp:1795000000	file:x" >"$sig"
  expect_fail "a signature with no version" manifest "$dist" v1.2.3
  fake_sig "$key" "timestamp:1795000000	file:x	version:1.2.30" >"$sig"
  expect_fail "a signature of another version" manifest "$dist" v1.2.3
  printf '%s' "$good" >"$sig"
  manifest "$dist" v1.2.3 >/dev/null || die "test: the good signature stopped passing"
  echo "All updater manifest tests passed"
}

usage="usage: updater-manifest.sh files|manifest|test ..."
mode=${1:-}
shift || true
case $mode in
files) files "$@" ;;
manifest) manifest "$@" ;;
test) selftest ;;
*)
  echo "$usage" >&2
  exit 2
  ;;
esac
