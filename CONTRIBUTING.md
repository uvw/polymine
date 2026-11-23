# Contributing to Polymine

How to build Polymine, and the rules for changing it. The
[docs index](docs/README.md) lists every document by reader, and coding agents
also read [AGENTS.md](AGENTS.md).

## Getting started

### Prerequisites

You need:

1. [rustup](https://rustup.rs). Run `rustup install` in the repository to get
   the Rust version `rust-toolchain.toml` pins.
2. Node.js 24. With nvm, `nvm use` reads the version from `.nvmrc`.
3. The [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your
   platform: Microsoft C++ Build Tools and WebView2 on Windows, Xcode command
   line tools on macOS.
4. [`cargo-deny`](https://github.com/EmbarkStudios/cargo-deny) for the license
   and advisory check: `cargo install --locked cargo-deny`, or the prebuilt
   binary from its releases page.
5. [`cargo-about`](https://github.com/EmbarkStudios/cargo-about) 0.8.4 for the
   third-party notices: the prebuilt binary from its releases page. CI pins the
   same version, so a different one can render a different file.

### Building from source

```sh
npm install
npm run app          # run the game with hot reload
npm run tauri build  # build the app and an installer, without polymine-cli
```

A release installer also bundles `polymine-cli`. Build the CLI first, copy it to
`src-tauri/binaries/polymine-cli-<target triple>`, and add
`--config src-tauri/tauri.bundle-cli.conf.json` to the build.
[docs/windows.md](docs/windows.md) has the Windows commands, and
`.github/workflows/release.yml` builds both platforms the same way.

### Development commands

| Command                                                 | What it does                                            |
| ------------------------------------------------------- | ------------------------------------------------------- |
| `npm run app`                                           | Runs the desktop app in development mode, as `dev`      |
| `cargo test --workspace`                                | Runs the Rust tests and regenerates TypeScript bindings |
| `npm test`                                              | Runs the UI unit tests                                  |
| `npm run check`                                         | Type-checks the Svelte and TypeScript code              |
| `npm run lint`                                          | Lints the UI code                                       |
| `npm run lint:md`                                       | Lints the Markdown                                      |
| `npm run format`                                        | Formats the UI code and docs with Prettier              |
| `cargo clippy --workspace --all-targets -- -D warnings` | Lints the Rust code                                     |

From a checkout, run the CLI with `cargo run -p polymine-cli -- <command>`.

The About window shows `ui/src/lib/notices/THIRD-PARTY-NOTICES.txt`. It holds
the licenses of the npm packages in the UI bundle, the Rust crates that ship,
and the editor color schemes the built-in themes borrow. Run `npm run notices`
to regenerate it after changing dependencies. CI fails when the committed file
is out of date.

To watch the assistant play a few hundred games and report its win rate, on
every tiling or only the ones named:

```sh
cargo run --release -p polymine-core --example autoplay -- 200
cargo run --release -p polymine-core --example autoplay -- 200 Kite Floret
```

To measure each tiling's complexity rating, using every CPU core:

```sh
cargo run --release -p polymine-core --example complexity -- 400
```

## Project layout

| Path                   | Contents                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `crates/polymine-core` | Game engine: tilings, board, rules, solver, and statistics. No I/O, no UI.                                              |
| `src-tauri`            | Desktop shell: session, clock, settings, history, named saves, player themes, the CLI server, and Tauri commands        |
| `ui`                   | Svelte UI. The board is drawn with PixiJS in `ui/src/lib/board`.                                                        |
| `crates/polymine-ipc`  | What the app and the CLI share: instances, protocol, move checks, board views, theme folders, and history reads         |
| `crates/polymine-net`  | Network layer: HTTPS policy, response cache, GitHub downloads, and JSON APIs                                            |
| `crates/polymine-cli`  | `polymine-cli`, the command line for people and coding agents                                                           |
| `skills/polymine-cli`  | The agent guide `polymine-cli skill` prints                                                                             |
| `ui/src/lib/bindings`  | TypeScript types generated from the Rust types by `cargo test`                                                          |
| `ui/src/themes`        | The built-in themes, one folder each                                                                                    |
| `docs`                 | The documents the [docs index](docs/README.md) lists                                                                    |
| `hack`                 | Housekeeping scripts: notices, versions, the CLI smoke test, the app icon, release tokens, and Windows builds and tests |
| `.github`              | CI, release, and security workflows, their helpers in `workflows/hack`, release settings, rulesets, and Dependabot      |

## Checks

Run all of these before you commit, and keep them clean, with zero warnings:

```sh
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run format:check
npm run lint
npm run lint:md
npm run check
npm run coverage
cargo build -p polymine -p polymine-cli && node hack/cli-smoke.mjs
node hack/check-versions.mjs
cargo deny check
npm run notices
```

`cargo deny check` needs `cargo-deny` and `npm run notices` needs `cargo-about`;
[Prerequisites](#prerequisites) covers installing both. Commit any change
`npm run notices` makes to the notices file.

## Tests

Write tests alongside the code. Engine changes need unit tests. Solver changes
must keep the property tests passing, since they check that certain moves are
never wrong.

1. Rust: unit tests per module, property tests for the solver, and tests that
   drive `App` end to end with temporary directories. `npm run coverage:rust`
   measures coverage with `cargo llvm-cov`.
2. UI: Vitest with jsdom and Testing Library for components, the store with a
   mocked backend, and `BoardView` against small stand-ins for the Pixi classes
   in `ui/src/test/fakePixi.ts`. `npm run coverage` enforces 90% for lines,
   statements, and functions, and 80% for branches.
3. Untested on purpose: Tauri startup in `src-tauri/src/lib.rs` and the one-line
   command wrappers, which need a real window. Check them by running the app.

Test a running app as a named instance (`POLYMINE_INSTANCE=<name>` and
`POLYMINE_DATA_DIR=<scratch>`), so your own settings and history stay untouched.

## Commits

Use Conventional Commits with a scope: `type(scope): subject`, with the subject
in lowercase imperative, for example `fix(ui): keep menus inside the window`.
Types are `feat`, `fix`, `docs`, `test`, `refactor`, `ci`, and `chore`. The
scope names the area: `core`, `app`, `ui`, `cli`, `ipc`, `net`, `tilings`,
`themes`, `windows`, `macos`, `release`, `docs`, `todo`, or `deps`. Leave the
scope out only when a commit spans several areas. Keep the body to one or two
sentences about what changed and why.

The type decides the release: release-please makes one for `feat` and `fix`, and
lists them in `CHANGELOG.md` ([releasing.md](docs/releasing.md)).

No AI attribution. Commit messages, tags, release notes, and pull request bodies
carry no AI attribution, such as a `Co-Authored-By` trailer for an AI tool, and
no session links.

## Pull requests

Changes from outside the project come as pull requests from a fork, which
squash-merge. The pull request title becomes the commit on `main`, so it follows
the commit rules above, and CI checks it.

1. Fork `uvw/polymine`, clone your fork, and branch from `main`.
2. Run the [checks](#checks), then open the pull request against `uvw/polymine`
   with `gh pr create --fill`.
3. On your first pull request, CI waits until a maintainer approves its runs.
   Later ones run on every push. Runs from a fork get a read-only token and none
   of the repository's secrets.
4. A maintainer merges it once "CI (all green)" passes.

Dependabot opens grouped pull requests weekly. Their titles start `fix(deps):`,
`chore(deps-dev):`, or `ci(deps):`, which the title check accepts. Read the
changelog of anything that changes behavior before merging.

## Architecture rules

1. `crates/polymine-core` does no I/O and depends on nothing UI-related.
   Randomness comes from a seed passed in, so games and tests are reproducible.
2. `src-tauri` stays thin: it owns the session, clock, settings, history, named
   saves, and the player themes folder, and translates between commands and the
   engine. Game rules belong in the engine.
3. UI calls to app commands go through `ui/src/lib/api.ts`. Other UI code may
   use the window, app, and menu APIs from `@tauri-apps/api` directly. UI
   logging goes through `ui/src/lib/log.ts`, which forwards console warnings and
   errors to the app's log file.
4. `crates/polymine-ipc` holds what the app and `polymine-cli` share: instance
   names, paths, the wire protocol, board views, the rules for player theme
   folders, the checks a move passes, and how the history file is read. It has
   no Tauri dependency. The app answers CLI requests in
   `src-tauri/src/remote.rs`, through the same `App` methods its window uses.
5. All network access goes through `crates/polymine-net`, which enforces HTTPS,
   the host allowlist, and the size and time limits. Only `polymine-cli sync`
   uses it; `src-tauri` doesn't depend on it, and the webview makes no requests
   of its own.
6. `skills/polymine-cli/SKILL.md` is the guide the CLI prints for coding agents
   that use it. Update it with any change to the CLI's commands or output.
7. `ui/src/lib/bindings/index.ts` is generated by `cargo test` through
   `tauri-specta`: the types and a typed `commands` object for every Tauri
   command. Never edit it by hand; change the Rust type or command and rerun the
   tests. A new command goes into `specta_builder` in `src-tauri/src/lib.rs`,
   and a type no command uses gets a `.typ::<T>()` line there.
8. Every UI string goes through `t()` from `ui/src/lib/i18n`, with English in
   `en.json` as the baseline.
9. Board colors come from the active theme in `ui/src/lib/themes`; window chrome
   colors come from the CSS tokens in `ui/src/app.css`. No hard-coded colors in
   components. Board effects that look the same in every theme, such as the ring
   halo and the mine's glint, may use named constants in `ui/src/lib/board`.
10. Theme files are untrusted input. Never add one to the page as a stylesheet
    or put its SVG in the DOM; values go through `ui/src/lib/themes/format.ts`,
    and SVG files load only as images.
11. Chrome follows the platform: Fluent metrics on Windows, AppKit metrics on
    macOS, and the system's light or dark mode. Platform differences go through
    the `platform-*` classes on `<html>`, not user-agent checks in components.

## Adding a tiling

1. Add a variant to `TilingId` in `crates/polymine-core/src/tiling.rs` and to
   `TilingId::ALL`, and raise the array's length.
2. Describe its repeating patch in `tiling/catalog.rs`: the period, the logical
   columns and rows per patch, and one polygon per slot. Add its arm to
   `catalog::build`.
3. Add its neighbor counts to the `neighbor_counts_match_the_geometry` test. The
   coverage and symmetry tests pick up the new tiling automatically.
4. Run the autoplay example on it, naming the new tiling after the game count. A
   win rate far below similar tilings at low density points to cells no number
   can tell apart.
5. Rate it: run the `complexity` example and add its rating to
   `TilingId::complexity`.
6. Add the `tiling.<id>` string to `en.json` and the id to `TILINGS` in
   `ui/src/lib/menu.ts`.
7. Add it to `TilingArg` in `crates/polymine-cli/src/cli.rs`; the
   `every_tiling_flag_names_a_real_tiling` test fails until you do.
8. Update the tiling count in `docs/design.md` "Tilings as data" and in the
   `skills/polymine-cli/SKILL.md` front matter, and add a row to the tiling
   table in `docs/design.md`.

## Adding a theme

A theme is a folder. [How theming works](docs/themes/how-theming-works.md)
explains the format and the code, and
[Creating a theme](docs/themes/creating-a-theme.md) lists every variable.

1. Make `ui/src/themes/<id>/theme.css`, with the header comment and the
   variables. Copy a close theme and change it. Optional SVG glyphs and a
   `preview.png` go in the same folder.
2. Add the id to `BUILT_IN_ORDER` in `ui/src/lib/themes/builtin.ts`, or to
   `EDITOR_COLUMNS` there when it takes a code editor's color scheme. An
   experiment that only development builds list goes in `EXPERIMENTAL_THEMES`
   instead. Settings shows the header's `Name`, `Description`, and `Author`, as
   for a player's theme.
3. Run `npm test`. The theme tests check contrast and color-blind separation.
   Relax a check with the header's `Relaxed:` line only for a look kept on
   purpose, and record why in `docs/decisions.md`.
4. A theme that borrows another project's palette credits it: add an entry to
   `THEME_PALETTES` in `hack/notices.mjs`, put the license in
   `hack/notices/palettes`, and run `npm run notices`.
5. Update the count of built-in themes and add a row to the theme table, both in
   `docs/design.md` "Themes".

## App icon

`ui/public/icon.svg` is the source of the app icon, and
`ui/public/icon-small.svg` is its simpler form for 16 and 24 pixels, where the
full mine blurs. The favicon and the About dialog use `icon.svg` as is. After
changing either, run `node hack/app-icon.mjs` to regenerate the window,
installer, and store icons in `src-tauri/icons`, and commit them with the SVGs.

## Docs

The [docs index](docs/README.md) lists every doc by reader; add a new doc there.
Update a doc in the same change as the code it describes.

1. `docs/design.md` describes how Polymine works today.
2. `docs/decisions.md` records each settled choice, why, and the alternatives.
   It is a living record: each entry states today's rule. When a choice changes,
   rewrite its entry, or merge it with the entry it narrows, rather than adding
   one that replaces it. Keep the index table in step, and when entries are
   renumbered, update every `decision N` reference in the repo.
3. `docs/todo.md` holds open work. Delete an item when it's done, or when a
   decision settles it.
4. `docs/handoffs.md` holds work one machine leaves for another, such as a
   Windows-only change made on a Mac.
5. `docs/architecture/overview.html` maps the components and the flows between
   them. Update it when a component is added, removed, or wired differently.
6. `docs/windows.md` holds the Windows installer test and the Windows release
   steps.
7. `docs/releasing.md` describes how a release is made: release-please, the
   release workflow, and the repository settings they need.

Each repeated fact has one home, and other docs link to it instead of copying
it:

| Fact                                     | Home                                                           |
| ---------------------------------------- | -------------------------------------------------------------- |
| The tiling count                         | `docs/design.md`, and the `SKILL.md` front matter              |
| The built-in theme count                 | `docs/design.md`                                               |
| Data, runtime, and log folders           | `docs/design.md`, with the player's folder in the README       |
| CLI commands, replies, and exit codes    | `docs/CLI.md`                                                  |
| Theme test bars and the color filter     | `ui/src/lib/themes/filter.ts`, in prose `how-theming-works.md` |
| Player keys                              | The README                                                     |
| Reporting a problem, checking a download | `SECURITY.md`                                                  |
| Opening an unsigned build                | `.github/release-body.md`, shown on every release page         |

Prettier wraps Markdown at 80 columns. Run `npx prettier --write` on a doc after
editing it rather than wrapping by hand.

## Clean-room rule

Polymine is MIT or Apache licensed. The original FastMines source is GPL, so
never copy or translate its code, tables, or assets. Port behavior from a
plain-language description, derive geometry from the math, and write new strings
and art.
