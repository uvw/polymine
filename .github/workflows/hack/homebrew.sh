#!/usr/bin/env bash
# Writes the Homebrew cask for a release from its checksums.txt, and pushes it
# to uvw/homebrew-tap with the token in HOMEBREW_TAP_TOKEN. Without the token it
# prints the cask and pushes nothing.
#
# Usage: .github/workflows/hack/homebrew.sh TAG CHECKSUMS
set -euo pipefail

tag=${1:?usage: homebrew.sh TAG CHECKSUMS}
sums=${2:?usage: homebrew.sh TAG CHECKSUMS}
version=${tag#v}
tap=uvw/homebrew-tap

sha() {
  local sum
  sum=$(awk -v f="Polymine_${version}_$1.dmg" '$2 == f { print $1 }' "$sums")
  [[ $sum =~ ^[0-9a-f]{64}$ ]] || {
    echo "::error::$sums has no Polymine_${version}_$1.dmg"
    exit 1
  }
  printf '%s' "$sum"
}

# Each in its own assignment, so a missing DMG stops the script.
arm=$(sha aarch64)
intel=$(sha x64)

# The builds aren't signed or notarized yet, so macOS blocks the first launch.
# The caveat says how to open the app, rather than the cask clearing the
# quarantine flag behind the player's back.
cask=$(
  cat <<EOF
cask "polymine" do
  version "$version"

  on_arm do
    url "https://github.com/uvw/polymine/releases/download/v#{version}/Polymine_#{version}_aarch64.dmg"
    sha256 "$arm"
  end
  on_intel do
    url "https://github.com/uvw/polymine/releases/download/v#{version}/Polymine_#{version}_x64.dmg"
    sha256 "$intel"
  end

  name "Polymine"
  desc "Minesweeper on many tilings, with an assistant that plays for real"
  homepage "https://github.com/uvw/polymine"

  app "Polymine.app"
  binary "#{appdir}/Polymine.app/Contents/MacOS/polymine-cli"

  zap trash: [
    "~/Library/Application Support/Polymine",
    "~/Library/Application Support/dev.uvw.polymine",
    "~/Library/Logs/dev.uvw.polymine",
  ]

  caveats <<~CAVEATS
    Polymine isn't signed or notarized yet, so macOS blocks its first launch.
    Open it once, then go to System Settings > Privacy & Security and click
    Open Anyway. Or run:
      xattr -dr com.apple.quarantine "#{appdir}/Polymine.app"
  CAVEATS
end
EOF
)

if [[ -z ${HOMEBREW_TAP_TOKEN:-} ]]; then
  echo "::notice::HOMEBREW_TAP_TOKEN is not set, so the cask was not pushed to $tap"
  printf '%s\n' "$cask"
  exit 0
fi

path=Casks/polymine.rb
# The contents API replaces a file only when given the blob it replaces.
current=$(GH_TOKEN=$HOMEBREW_TAP_TOKEN gh api "repos/$tap/contents/$path" -q .sha 2>/dev/null) || current=
args=(-X PUT "repos/$tap/contents/$path" -f "message=polymine $version"
  -f "content=$(printf '%s\n' "$cask" | base64 | tr -d '\n')")
[[ -z $current ]] || args+=(-f "sha=$current")
GH_TOKEN=$HOMEBREW_TAP_TOKEN gh api "${args[@]}" >/dev/null
echo "Pushed the polymine $version cask to $tap"
