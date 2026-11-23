# Releasing

## Summary

How a Polymine release is made. Nothing is released by hand: release-please
opens the release pull request, and merging it builds and publishes the release.

1. Commits on `main` follow Conventional Commits (CONTRIBUTING.md, "Commits").
   `feat` and `fix` make a release; the other types don't, though they still
   ship in the next one.
2. On every push to `main`, the Release Please workflow keeps one release pull
   request open, titled `chore(main): release X.Y.Z`. It bumps the version in
   every version file, adds the changelog entry to `CHANGELOG.md`, and, when
   `COPILOT_TOKEN` is set, writes the release notes.
3. Merging that pull request creates the `vX.Y.Z` tag and a draft release, then
   runs the Release workflow, which builds, attests, and publishes.

## Versions

Before 1.0, a `feat` raises the minor version and a `fix` the patch version. A
breaking change (`feat!:` or a `BREAKING CHANGE:` footer) raises the minor
version too.

release-please bumps these files together, and `hack/check-versions.mjs` fails
CI and the release when any of them disagree:

1. `Cargo.toml`, the workspace version.
2. `Cargo.lock`, the five workspace crates' entries, so `--locked` builds pass.
3. `package.json` and `package-lock.json`.
4. `src-tauri/tauri.conf.json`, which names the installers.

`.github/release-please-config.json` lists them, and
`.github/release-please-manifest.json` holds the current version.

## The changelog

release-please writes `CHANGELOG.md` from the commit subjects: `feat` under
Features, `fix` under Bug fixes, and `perf` under Performance. Other types stay
out of it. It writes long lines, so the workflow's "Format the changelog" job
runs Prettier over the release pull request's copy and pushes the result, which
keeps the Markdown checks green. Edit the entry in the pull request before
merging, if it needs it.

## Release notes

Copilot CLI writes notes for players above the changelog list: a TL;DR, what the
release is about, and what changed in the game. It runs on every push to `main`
while a release pull request is open, so a release needs no step of its own.

1. The "Write the release notes" job in `release-please.yml` gathers the release
   pull request's changelog entry and the title and body of each pull request
   merged since the last release, with the workflow's read-only token.
2. Copilot CLI writes `docs/release-notes/vX.Y.Z.md` from them, guided by
   `.github/release-notes/prompt.md`. Edit that file to change how the notes
   read.
3. The job checks the file, formats it with Prettier, and lints it with
   markdownlint. The push job checks it again and commits it to the release pull
   request beside the formatted changelog.
4. At publish, `release.yml` puts the notes at the top of the release, then an
   "All changes" heading and the list release-please wrote, then
   `.github/release-body.md`.

Read the notes in the release pull request before merging it. Edit them there,
or delete the file to release with the list alone. Each push to `main` writes
them again, so edit them just before you merge.

`.github/workflows/hack/release-notes.sh` does each step, and
`release-notes.sh test` runs them on the fixtures in
`.github/release-notes/testdata`, with no Copilot call. CI runs that test.

Pull request bodies can come from anyone, so the workflow treats them as
untrusted:

1. The prompt marks them as data, never instructions, between markers a body
   can't fake.
2. The job that runs Copilot holds only `COPILOT_TOKEN` and a read-only
   `GITHUB_TOKEN`, and gathers everything before Copilot starts.
3. Copilot sees one tool, `create`, which may write only the notes, in an empty
   folder with no MCP servers and no shell.
4. The check refuses anything but one file of Markdown under 16 KiB, with no
   HTML, images, @-mentions, title heading, or links outside this repository. A
   refused file is never pushed.
5. The push job accepts only `CHANGELOG.md` and the notes for the release pull
   request's version.

Notes are optional, and never hold up a release. Without the `COPILOT_TOKEN`
secret the job skips itself with a notice. A failed run doesn't fail the
workflow, and the formatted changelog still goes out. Without a notes file at
the tag, or with one that fails its check, the release keeps release-please's
list alone.

Each run spends Copilot AI credits from the account that owns `COPILOT_TOKEN`,
about 10 to 15 a run, with one run on each push to `main`. Copilot CLI makes no
more model calls once a run has used 30 credits (`--max-ai-credits`), the least
it accepts. The job log shows what a run used. `COPILOT_TOKEN` is a fine-grained
token with the account permission "Copilot Requests" and no repository access.

The model is `claude-sonnet-5.5` unless the repository variable
`RELEASE_NOTES_MODEL` names another, so changing it needs no code change:

```sh
gh variable set RELEASE_NOTES_MODEL --body claude-sonnet-5.5 -R uvw/polymine
```

Copilot CLI is pinned in `.github/release-notes/package.json`, and Dependabot
updates it weekly.

## The release workflow

`.github/workflows/release.yml` runs these jobs in order. The build jobs hold no
token that can write.

1. **Release eligibility:** the tag must be `vX.Y.Z`, on `main`, and match every
   version file. Later jobs check out the commit it found, not the tag.
2. **CI:** the whole CI workflow, on that commit.
3. **Build:** the macOS DMGs and app archives for Apple silicon and Intel, the
   Windows NSIS installer, and the portable Windows ZIP, built from scratch with
   no caches.
4. **Sign updates:** signs the [updater artifacts](#updates) with the release
   key and writes `latest.json`.
5. **Attest provenance:** `checksums.txt` and a build provenance attestation for
   every file, the signatures and `latest.json` included.
6. **Publish:** uploads the files and `checksums.txt` to the draft, puts the
   [release notes](#release-notes) above the changelog entry when there are any,
   adds `.github/release-body.md` (downloads and first-launch steps for unsigned
   builds) below it, checks the tag still names the commit that was built, and
   publishes the release as the latest.
7. **Homebrew tap:** pushes the cask for the new version to `uvw/homebrew-tap`
   ([Homebrew](#homebrew)).
8. **winget:** opens a pull request on microsoft/winget-pkgs for the new version
   ([winget](#winget)).

Running the Release workflow by hand with an existing tag (re)publishes it.

Publish only what the workflow builds. A build made on a developer's machine
records that machine's home folder in the binaries, and nothing attests it.
`hack/release-windows.ps1` (docs/windows.md) is for testing the Windows files.

## Updates

Installed copies update themselves from the latest release
([design](design.md#updates)). Each release carries what they need:

1. **The artifacts:** `Polymine_X.Y.Z_aarch64.app.tar.gz` and
   `Polymine_X.Y.Z_x64.app.tar.gz`, the app bundles the macOS updater unpacks,
   and the Windows installer itself.
2. **A signature for each:** the artifact's name plus `.sig`, a minisign
   signature whose trusted comment names the version. The app refuses an update
   whose signature doesn't name the version `latest.json` announces.
3. **`latest.json`:** the version, the notes, the publish date, and for
   `darwin-aarch64`, `darwin-x86_64`, and `windows-x86_64` the download URL and
   the signature. Installed copies read it from
   `releases/latest/download/latest.json`, so publishing a release as the latest
   offers it to everyone.

The build jobs hold no signing key. Tauri writes the updater artifacts only when
it can sign them, so each build signs with a key made for the run and deletes
it. The Sign updates job then signs each artifact again with
`TAURI_SIGNING_PRIVATE_KEY`, a secret of the `release` environment, and
`.github/workflows/hack/updater-manifest.sh` writes `latest.json`. The script
refuses a signature from any key other than the one in
`src-tauri/tauri.conf.json`, or one that doesn't name the version, so a missing
or wrong secret fails the release instead of the players' updates. Its `test`
mode runs in CI.

The key pair lives in `~/.tauri/polymine-updater.key` and its `.pub` beside it;
the public key is also in `tauri.conf.json`. The key has no password, and the
workflow passes an empty one. **Keep an offline backup of the private key.** If
it's lost, no new release can be signed for the copies already installed: they
keep refusing updates, and every player has to download the next version by
hand. A new key pair then needs its public key in `tauri.conf.json` and the
secret replaced. If the key leaks, do the same, since anyone holding it can sign
an update that installed copies accept.

## Homebrew

Once a release is published, the Homebrew job runs
`.github/workflows/hack/homebrew.sh`, which writes `Casks/polymine.rb` in
`uvw/homebrew-tap` from the release's `checksums.txt` and pushes it. Players
install with `brew install --cask uvw/tap/polymine`. The cask installs
`Polymine.app` for Apple silicon or Intel, links `polymine-cli` onto `PATH`, and
removes the data, runtime, and log folders on `brew uninstall --zap`.

1. The job runs in the `release` environment and needs `HOMEBREW_TAP_TOKEN`, a
   fine-grained token with Contents set to read and write on `uvw/homebrew-tap`.
   Without the secret, the job prints the cask and pushes nothing.
2. The builds aren't signed or notarized, so macOS blocks the first launch after
   a Homebrew install too. The cask's caveat says how to open the app; it
   doesn't clear the quarantine flag itself.
3. The cask says `auto_updates true`, since the app updates itself, so
   `brew upgrade` leaves it alone unless run with `--greedy`.
4. A failed Homebrew job doesn't touch the release. Rerun the job.

## winget

Once a release is published, the winget job runs
`.github/workflows/hack/winget.sh`. It runs
[komac](https://github.com/russellbanks/Komac), pinned by version and checksum,
to open a pull request on microsoft/winget-pkgs that adds the new version of
`uvw.Polymine`, from the uvw/winget-pkgs fork. The package points at the NSIS
installer, `Polymine_X.Y.Z_x64-setup.exe`, a `nullsoft` installer to winget.

1. The job runs in the `release` environment and needs `WINGET_TOKEN`, a classic
   token with `public_repo`. A fine-grained token can't open pull requests on
   another owner's public repository. Without the secret, the job skips itself
   with a notice.
2. komac adds versions only to a package winget already has, so until
   `uvw.Polymine` is in winget-pkgs the job skips itself too.
3. A failed winget job doesn't touch the release, which is already out. Rerun
   the job, or submit the version by hand as below.

The first version goes in by hand, on any machine with komac:

```sh
GITHUB_TOKEN=<the winget token> komac new uvw.Polymine --version X.Y.Z \
  --urls https://github.com/uvw/polymine/releases/download/vX.Y.Z/Polymine_X.Y.Z_x64-setup.exe
```

komac asks for the rest: publisher `uvw`, package name `Polymine`, license
`MIT OR Apache-2.0`, and installer type `nullsoft`, installed per user. The
winget-pkgs maintainers review the first pull request of a new package by hand.
Once it merges, the release job handles every version after it.

## Repository settings

These live in GitHub's settings, not in the repository.

1. **The `release` environment:** Settings, Environments. Limit its deployment
   branches and tags to `main` and `v*`, so a run from any other branch can't
   publish or read its secrets.
2. **`RELEASE_PLEASE_TOKEN`,** a secret of the `release` environment: a
   fine-grained personal access token for this repository with Contents and Pull
   requests set to read and write. A pull request opened with the workflow's own
   token starts no workflows, so without it the release pull request's checks
   never run: a maintainer then has to approve them, or close and reopen the
   pull request. [Tokens](#tokens) covers it and the other release secrets.
3. **Actions, General:** allow GitHub Actions to create and approve pull
   requests, which release-please needs when it falls back to the workflow's
   token.
4. **Rulesets:** import `.github/rulesets/main.json` and
   `.github/rulesets/tags.json` under Settings, Rules, Rulesets. The first
   requires a pull request, squash merges, the `CI (all green)` check, and no
   CodeQL errors for `main`; the second protects `v*` tags. GitHub offers
   rulesets on private repositories only with a paid plan, so they're imported
   when the repository goes public.

## Tokens

The release workflows read four tokens and a signing key, all secrets of the
`release` environment, not of the repository:

1. `RELEASE_PLEASE_TOKEN` opens and updates the release pull request, so its
   checks start without a maintainer's approval.
2. `HOMEBREW_TAP_TOKEN` pushes the cask to `uvw/homebrew-tap`
   ([Homebrew](#homebrew)).
3. `WINGET_TOKEN` opens the winget-pkgs pull requests from the uvw/winget-pkgs
   fork ([winget](#winget)).
4. `COPILOT_TOKEN` lets Copilot CLI write the [release notes](#release-notes).
5. `TAURI_SIGNING_PRIVATE_KEY` signs the [updates](#updates). It's required:
   without it, Sign updates fails and nothing is published.

Each token is optional: without it, its step is skipped with a notice, or, for
`RELEASE_PLEASE_TOKEN`, falls back to the workflow's own token.

`hack/release-tokens.sh` sets them up. Run it once the repository is public and
the `release` environment exists. It forks microsoft/winget-pkgs when the fork
is missing, opens each token's page with its fields filled in, checks the token
you paste, and saves it as a secret of the `release` environment. It never
prints a token or passes one on a command line, and skips any secret that's
already set. For the signing key it reads `~/.tauri/polymine-updater.key`, or
the file `--updater-key PATH` names, checks its `.pub` against
`tauri.conf.json`, and reminds you to back it up.

When a token expires, run it again with the secret's name, such as
`hack/release-tokens.sh WINGET_TOKEN`. Each token's name ends in the day it was
made, since GitHub refuses a name another of your tokens has. Revoke the old
token once the new secret is saved. Each fine-grained token lasts a year.

## Checking a download

[SECURITY.md](../SECURITY.md) says how to check a download's attestation and
checksum.
