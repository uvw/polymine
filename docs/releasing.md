# Releasing

How a Polymine release is made. Nothing is released by hand: release-please
opens the release pull request, and merging it builds and publishes the release.

## Summary

1. Commits on `main` follow Conventional Commits (CONTRIBUTING.md, "Commits").
   `feat` and `fix` make a release; the other types don't, though they still
   ship in the next one.
2. On every push to `main`, the Release Please workflow keeps one release pull
   request open, titled `chore(main): release X.Y.Z`. It bumps the version in
   every version file and adds the changelog entry to `CHANGELOG.md`.
3. Merging that pull request creates the `vX.Y.Z` tag and a draft release, then
   runs the Release workflow, which builds, attests, and publishes.

## Versions

Before 1.0, a `feat` raises the minor version and a `fix` the patch version. A
breaking change (`feat!:` or a `BREAKING CHANGE:` footer) raises the minor
version too.

release-please bumps these files together, and `scripts/check-versions.mjs`
fails CI and the release when any of them disagree:

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

## The release workflow

`.github/workflows/release.yml` runs these jobs in order. The build jobs hold no
token that can write.

1. **Release eligibility:** the tag must be `vX.Y.Z`, on `main`, and match every
   version file. Later jobs check out the commit it found, not the tag.
2. **CI:** the whole CI workflow, on that commit.
3. **Build:** the macOS DMGs for Apple silicon and Intel, the Windows NSIS
   installer, and the portable Windows ZIP, built from scratch with no caches.
4. **Attest provenance:** `checksums.txt` and a build provenance attestation for
   every file.
5. **Publish:** uploads the files and `checksums.txt` to the draft, adds
   `.github/release-body.md` (downloads and first-launch steps for unsigned
   builds) below the changelog entry, checks the tag still names the commit that
   was built, and publishes the release as the latest.

Running the Release workflow by hand with an existing tag (re)publishes it.

Publish only what the workflow builds. A build made on a developer's machine
records that machine's home folder in the binaries, and nothing attests it.
`scripts/release-windows.ps1` (docs/windows.md) is for testing the Windows
files.

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
   pull request.
3. **Actions, General:** allow GitHub Actions to create and approve pull
   requests, which release-please needs when it falls back to the workflow's
   token.
4. **Rulesets:** import `.github/rulesets/main.json` and
   `.github/rulesets/tags.json` under Settings, Rules, Rulesets. The first
   requires a pull request, squash merges, the `CI (all green)` check, and no
   CodeQL errors for `main`; the second protects `v*` tags. GitHub offers
   rulesets on private repositories only with a paid plan, so they're imported
   when the repository goes public.

## Verifying a download

[SECURITY.md](../SECURITY.md) says how to check a download's attestation and
checksum.
