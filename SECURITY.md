# Security

## Supported versions

Only the latest release gets fixes.

## Reporting a problem

Report it privately through GitHub's [private vulnerability reporting][report].
Please don't open a public issue for it.

[report]: https://github.com/uvw/polymine/security/advisories/new

Include:

1. The Polymine version, from About in the menu or `polymine-cli --version`.
2. Your operating system and its version.
3. What an attacker could do, and the steps to show it.

These are in scope:

1. **Theme files.** Polymine treats a theme folder as untrusted input: it never
   adds a theme's CSS to the page, loads its SVG files only as images, and keeps
   reads inside the folder. Anything that breaks one of those rules is a bug
   ([how theming works](docs/themes/how-theming-works.md)).
2. **The CLI's local socket.** Each running instance listens on a named pipe on
   Windows, or a Unix socket on macOS and Linux, that only the user who started
   it may open ([CLI](docs/CLI.md)). Another account reaching it, or claiming
   its name first, is in scope.
3. **Network access.** Only `polymine-cli sync` uses the network, over HTTPS to
   GitHub hosts on an allowlist. The app's window makes no requests.
4. **Saved data.** Settings, history, saves, and the files the CLI reads, when a
   crafted file makes Polymine do more than refuse it.
5. **The installer,** including the folder it adds to `PATH` on Windows.

## Checking a download

Every file in a release has a build provenance attestation, made by the release
workflow ([releasing](docs/releasing.md)):

```sh
gh attestation verify Polymine_0.1.0_x64-setup.exe --repo uvw/polymine
```

`checksums.txt` in each release lists every file's SHA-256. It isn't attested
itself, so check a file's attestation rather than only its checksum.
