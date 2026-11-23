# Polymine

Minesweeper on many tilings, with an assistant that can hint or play the whole
game. Polymine is a desktop game for Windows and macOS, built with Rust, Tauri,
and Svelte.

![The assistant clears a professional game on hexagons in the Quanta theme](docs/media/demo.gif)

## Features

- Tilings from squares and hexagons to herringbone bricks, kites, pentagon
  florets, and snub squares. Cells count as neighbors when they share an edge or
  a corner, so a triangle has 12 neighbors and a Cairo pentagon has seven.
- Beginner, Amateur, Professional, and Crazy levels, plus custom boards. The
  level sets the mine density. Each tiling's shape adds a measured complexity,
  from 1 to 5, shown in the tiling picker.
- A first click that is never a mine, and opens an area whenever the board has
  room.
- Flags, optional question marks, and smart click. Clicking a number flags its
  neighbors when they must all be mines, then opens the rest once the flags
  match.
- An assistant that shows the next safe move or plays the game itself. It plays
  the moves the numbers force, and when none is left it opens the cell least
  likely to hold a mine. A move it calls certain is always right.
- Statistics and a champions table per tiling and level. Assisted and custom
  games don't count toward records.
- A native look on Windows 11 and macOS that follows the system's light or dark
  mode, built-in themes, and themes players make as folders of CSS variables.
- A color filter for deuteranopia, protanopia, or tritanopia. Themes that show
  counts by color alone draw high counts as rings and list every count in a key
  under the board.
- Keyboard play with screen reader announcements, zoom, and reduced-motion
  support.
- A command line, `polymine-cli`, that plays from a terminal or a coding agent
  and shares a history across machines through a GitHub gist.

## Keys

| Key          | Action                                             |
| ------------ | -------------------------------------------------- |
| Arrows, WASD | Move on the board                                  |
| Enter, Space | Open the focused cell                              |
| F            | Flag the focused cell                              |
| N, F2        | New game (also Ctrl+N on Windows, Cmd+N on macOS)  |
| 1 to 4       | Beginner, Amateur, Professional, Crazy             |
| 5            | Custom level                                       |
| H            | Hint                                               |
| B            | Bot on or off                                      |
| P, Pause     | Pause or resume                                    |
| Esc          | Pause and minimize                                 |
| F1           | About                                              |
| F3, F4       | Statistics and champions                           |
| F5           | Settings (Ctrl+, on Windows, Cmd+, on macOS)       |
| Ctrl+S       | Saves (Cmd+S on macOS)                             |
| + or =, -    | Zoom in, zoom out                                  |
| \*, /        | Zoom to the largest cells, back to the fitted size |

A dialog's key closes it when pressed again inside it. The wheel or a trackpad
pinch over the board resizes the window.

## Your data

Settings, finished games (`history.jsonl`), the saved game, named saves (in
`saves`), and the window's place live in a `Polymine` folder:
`%APPDATA%\Polymine` on Windows and `~/Library/Application Support/Polymine` on
macOS. A portable copy, such as the Windows ZIP on the releases page, keeps
everything in a `data` folder beside the executable instead.

Player themes go in the `themes` folder inside it, one folder per theme.
[Creating a theme](docs/themes/creating-a-theme.md) explains the format.

## Command line

`polymine-cli` plays Polymine from a terminal or a coding agent and prints JSON.
It drives a running window, where every move animates, or plays headless games
with `--local`.

The installers bundle it with the app:

1. On Windows, it sits next to `Polymine.exe` in the install folder. The
   installer puts it on your `PATH`, so open a new terminal afterwards.
2. On macOS, it sits inside the app, at
   `/Applications/Polymine.app/Contents/MacOS/polymine-cli`. Run
   `polymine-cli link` once by that full path to link it into `~/.local/bin`.

```sh
polymine-cli status
polymine-cli --local practice new --tiling kite --seed 7
polymine-cli skill    # the guide for coding agents
```

[docs/CLI.md](docs/CLI.md) covers the commands, instances, sharing a history
through a gist, the output contract, and exit codes.

## Documentation

| Document                                                | What it covers                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| [Design](docs/design.md)                                | How Polymine works: engine, app shell, chrome, themes, and input |
| [Decisions](docs/decisions.md)                          | Each settled choice, why, and the alternatives                   |
| [Command line](docs/CLI.md)                             | `polymine-cli` commands, replies, exit codes, and `sync`         |
| [Creating a theme](docs/themes/creating-a-theme.md)     | Every theme variable, for players who make themes                |
| [How theming works](docs/themes/how-theming-works.md)   | The theme code: loading, checks, rendering, and the color filter |
| [Architecture diagram](docs/architecture/overview.html) | An interactive map of the components and the flows between them  |
| [App icon](docs/icons/README.md)                        | The icon, how it follows the theme, and its concept sheets       |
| [To do](docs/todo.md)                                   | Open work and ideas                                              |
| [Handoffs](docs/handoffs.md)                            | Work one machine leaves for another                              |
| [Windows](docs/windows.md)                              | Testing the installer and building a release on Windows          |
| [Releasing](docs/releasing.md)                          | How release-please and the release workflow make a release       |
| [Changelog](CHANGELOG.md)                               | What changed in each release                                     |
| [Security](SECURITY.md)                                 | How to report a problem, and how to check a download             |
| [Contributing](CONTRIBUTING.md)                         | Rules for changes, the checks, and the commit format             |
| [Agents](AGENTS.md)                                     | What coding agents need on top of CONTRIBUTING                   |
| [Agent skill](skills/polymine-cli/SKILL.md)             | The guide `polymine-cli skill` prints for coding agents          |

## Building from source

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

Then:

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

## Development

[CONTRIBUTING.md](CONTRIBUTING.md) holds the rules for changes: the
architecture, how to add a tiling or a theme, the checks to run, and the commit
format. Coding agents also read [AGENTS.md](AGENTS.md).

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

From a checkout, run the CLI with `cargo run -p polymine-cli -- <command>`.

## Project layout

| Path                   | Contents                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `crates/polymine-core` | Game engine: tilings, board, rules, solver, and statistics. No I/O, no UI.                                       |
| `src-tauri`            | Desktop shell: session, clock, settings, history, named saves, player themes, the CLI server, and Tauri commands |
| `ui`                   | Svelte UI. The board is drawn with PixiJS in `ui/src/lib/board`.                                                 |
| `crates/polymine-ipc`  | What the app and the CLI share: instances, protocol, move checks, board views, theme folders, and history reads  |
| `crates/polymine-net`  | Network layer: HTTPS policy, response cache, GitHub downloads, and JSON APIs                                     |
| `crates/polymine-cli`  | `polymine-cli`, the command line for people and coding agents                                                    |
| `skills/polymine-cli`  | The agent guide `polymine-cli skill` prints                                                                      |
| `ui/src/lib/bindings`  | TypeScript types generated from the Rust types by `cargo test`                                                   |
| `ui/src/themes`        | The built-in themes, one folder each                                                                             |
| `docs`                 | The documents in the table above                                                                                 |
| `hack`                 | Housekeeping scripts: notices, versions, the smoke test, the app icon, and Windows builds                        |
| `.github`              | CI and release workflows, and Dependabot                                                                         |

## Credits

Inspired by FastMines by Sergey Krivulya. Polymine is a new implementation and
shares no code with it.

## License

Licensed under either of [Apache License 2.0](LICENSE-APACHE) or
[MIT license](LICENSE-MIT) at your option.
