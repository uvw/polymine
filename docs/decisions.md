# Decisions

Each entry states a settled rule as it stands today, why, and what else was
weighed. When a rule changes, rewrite its entry rather than adding one that
replaces it. [CONTRIBUTING.md](../CONTRIBUTING.md#docs) says how to keep this
file current.

## Index

| No.                                                                              | Decision                                                                |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [1](#1-rust-engine-with-a-tauri-and-svelte-shell)                                | Rust engine with a Tauri and Svelte shell                               |
| [2](#2-mit-or-apache-license)                                                    | MIT or Apache license                                                   |
| [3](#3-game-state-lives-in-the-rust-backend)                                     | Game state lives in the Rust backend                                    |
| [4](#4-the-shells-logic-is-a-plain-struct)                                       | The shell's logic is a plain struct                                     |
| [5](#5-types-and-commands-come-from-tauri-specta)                                | Types and commands come from tauri-specta                               |
| [6](#6-logs-go-through-log-and-tauri-plugin-log)                                 | Logs go through `log` and `tauri-plugin-log`                            |
| [7](#7-eight-modules-may-use-unsafe-code)                                        | Eight modules may use unsafe code                                       |
| [8](#8-third-party-notices-ship-in-the-about-window)                             | Third-party notices ship in the About window                            |
| [9](#9-tilings-are-data)                                                         | Tilings are data                                                        |
| [10](#10-chacha8-for-mine-placement)                                             | ChaCha8 for mine placement                                              |
| [11](#11-twin-cells-never-hold-a-mine)                                           | Twin cells never hold a mine                                            |
| [12](#12-obtuse-triangles-come-from-rhombuses-and-the-cube-pattern-is-out)       | Obtuse triangles come from rhombuses, and the cube pattern is out       |
| [13](#13-difficulty-is-the-level-plus-the-tilings-complexity)                    | Difficulty is the level plus the tiling's complexity                    |
| [14](#14-fastmines-click-and-pause-behavior)                                     | FastMines click and pause behavior                                      |
| [15](#15-deliberate-differences-from-fastmines)                                  | Deliberate differences from FastMines                                   |
| [16](#16-history-keeps-every-finished-game-and-ranks-unaided-ones)               | History keeps every finished game and ranks unaided ones                |
| [17](#17-autosave-by-replay-every-5-seconds)                                     | Autosave by replay, every 5 seconds                                     |
| [18](#18-rules-changes-are-logged-with-the-moves)                                | Rules changes are logged with the moves                                 |
| [19](#19-games-pause-when-the-computer-sleeps)                                   | Games pause when the computer sleeps                                    |
| [20](#20-a-loaded-named-save-counts-as-assisted)                                 | A loaded named save counts as assisted                                  |
| [21](#21-players-are-names-only)                                                 | Players are names only                                                  |
| [22](#22-a-cli-and-a-skill-not-an-mcp-server)                                    | A CLI and a skill, not an MCP server                                    |
| [23](#23-a-full-instance-answers-busy)                                           | A full instance answers busy                                            |
| [24](#24-a-move-is-checked-in-one-order-on-both-paths)                           | A move is checked in one order on both paths                            |
| [25](#25-network-requests-go-through-ureq-with-rustls)                           | Network requests go through ureq with rustls                            |
| [26](#26-histories-sync-ranked-games-through-a-gist)                             | Histories sync ranked games through a gist                              |
| [27](#27-native-chrome-that-follows-the-platform)                                | Native chrome that follows the platform                                 |
| [28](#28-no-menu-bar-on-windows)                                                 | No menu bar on Windows                                                  |
| [29](#29-player-data-lives-in-a-polymine-folder)                                 | Player data lives in a Polymine folder                                  |
| [30](#30-keep-pixi-render-on-demand)                                             | Keep Pixi, render on demand                                             |
| [31](#31-minimum-cell-size-then-scroll)                                          | Minimum cell size, then scroll                                          |
| [32](#32-results-show-in-the-toolbar)                                            | Results show in the toolbar                                             |
| [33](#33-keyboard-play-by-direction)                                             | Keyboard play by direction                                              |
| [34](#34-the-wheel-and-a-pinch-resize-the-window)                                | The wheel and a pinch resize the window                                 |
| [35](#35-themes-are-folders-of-css-variables-that-pair-chrome-and-board)         | Themes are folders of CSS variables that pair chrome and board          |
| [36](#36-theme-variables-resolve-away-from-the-apps-styles)                      | Theme variables resolve away from the app's styles                      |
| [37](#37-board-colors-are-opaque-and-layers-have-opacities)                      | Board colors are opaque, and layers have opacities                      |
| [38](#38-player-themes-come-from-a-folder-with-hard-limits)                      | Player themes come from a folder with hard limits                       |
| [39](#39-themes-never-carry-shader-code)                                         | Themes never carry shader code                                          |
| [40](#40-experimental-themes-show-only-in-development-builds)                    | Experimental themes show only in development builds                     |
| [41](#41-theme-tests-hold-every-built-in-theme-to-readability-bars)              | Theme tests hold every built-in theme to readability bars               |
| [42](#42-a-color-filter-solves-each-themes-pairs-under-the-deficiency)           | A color filter solves each theme's pairs under the deficiency           |
| [43](#43-color-only-themes-ring-high-counts-and-keep-their-key-under-the-board)  | Color-only themes ring high counts and keep their key under the board   |
| [44](#44-cells-take-one-light-drawn-from-one-shared-texture)                     | Cells take one light, drawn from one shared texture                     |
| [45](#45-frost-puts-its-look-ahead-of-readability-over-bright-desktops)          | Frost puts its look ahead of readability over bright desktops           |
| [46](#46-swatch-fills-closed-cells-with-the-system-accent)                       | Swatch fills closed cells with the system accent                        |
| [47](#47-glossy-glazes-tiles-in-the-accent-deep-in-light-mode-and-light-in-dark) | Glossy glazes tiles in the accent, deep in light mode and light in dark |
| [48](#48-glass-lights-see-through-cells-and-relaxes-cell-and-digit-contrast)     | Glass lights see-through cells and relaxes cell and digit contrast      |
| [49](#49-editor-themes-take-their-sources-names-and-official-palettes)           | Editor themes take their sources' names and official palettes           |
| [50](#50-editor-themes-part-cells-like-panes)                                    | Editor themes part cells like panes                                     |
| [51](#51-editor-theme-counts-follow-the-syntax-colors)                           | Editor theme counts follow the syntax colors                            |
| [52](#52-themes-get-a-page-of-their-own-in-sections-by-where-they-come-from)     | Themes get a page of their own, in sections by where they come from     |
| [53](#53-the-code-section-sets-a-dark-theme-over-a-light-one-in-each-column)     | The Code section sets a dark theme over a light one in each column      |
| [54](#54-windows-releases-ship-the-nsis-installer-only)                          | Windows releases ship the NSIS installer only                           |
| [55](#55-the-window-icon-follows-the-theme)                                      | The window icon follows the theme                                       |
| [56](#56-each-data-folder-is-an-instance-of-its-own)                             | Each data folder is an instance of its own                              |
| [57](#57-the-players-own-copy-updates-itself-from-signed-github-releases)        | The player's own copy updates itself from signed GitHub releases        |

## 1. Rust engine with a Tauri and Svelte shell

**Date:** 2026-10-24

**Decision:** The engine is a Rust library. The desktop app is Tauri 2 with a
Svelte 5 UI, and PixiJS draws the board.

**Why:** Rust gives a fast solver and compiles to WASM for a later browser
build. Tauri gives native windows, menus, and materials on Windows and macOS,
with small installers. The web stack has the widest choice of animation tools.

**Alternatives:** C# with Avalonia, Flutter, and a shared Rust engine with
separate SwiftUI and WinUI front ends.

## 2. MIT or Apache license

**Date:** 2026-10-24

**Decision:** Polymine is dual licensed under MIT or Apache 2.0.

**Why:** It's the usual license pair for Rust projects, so the engine and the
crates can be reused anywhere, and Apache 2.0 adds a patent grant.

## 3. Game state lives in the Rust backend

**Date:** 2026-10-24

**Decision:** The session and rules run in the Tauri backend, not as WASM in the
webview.

**Why:** It keeps the UI free of rules and makes each click one small command.
The engine has no I/O, so a WASM build stays possible.

## 4. The shell's logic is a plain struct

**Date:** 2026-11-02

**Decision:** `App` in `src-tauri/src/app.rs` holds the session, settings, and
history, and implements every command. The Tauri commands are one-line wrappers.

**Why:** Tests can drive the whole shell without a window, which took its
coverage from zero to over 90%.

## 5. Types and commands come from tauri-specta

**Date:** 2026-11-03

**Decision:** `tauri-specta` generates the TypeScript types and a typed wrapper
for every command. `api.ts` stays the UI's only door to the backend and
delegates to the generated `commands`. Commands throw on error, as `invoke`
does. The versions are pinned exactly while specta 2 is a release candidate.

**Why:** A renamed command or argument fails the build instead of a click. The
maintainer prefers the cleaner code over waiting for specta 2 to ship.

**Alternatives:** `ts-rs` for the types with hand-written `invoke` wrappers,
which is stable but leaves every command name and argument unchecked.

## 6. Logs go through `log` and `tauri-plugin-log`

**Date:** 2026-11-03

**Decision:** The shell logs with the `log` macros, written by
`tauri-plugin-log` to stdout and the platform log directory. `ui/src/lib/log.ts`
forwards console warnings and errors, uncaught errors, and unhandled promise
rejections to `@tauri-apps/plugin-log`, the plugin's JavaScript half. Its npm
version matches the crate's major and minor version.

**Why:** Release builds on Windows have no console, so `eprintln!` messages are
lost. Release builds have no devtools either, so UI warnings and errors would
never reach a file. The official plugin needs only the `log:default` permission,
where a custom command would add app code and generated bindings.

## 7. Eight modules may use unsafe code

**Date:** 2026-11-05

**Decision:** The workspace lints deny `unsafe_code` instead of forbidding it.
Eight modules allow it, each for platform calls that no safe crate wraps, and
each `unsafe` block carries a `SAFETY` comment:

1. `windows_user` in `crates/polymine-ipc/src/transport.rs` reads the user's SID
   from the process token to name the CLI's pipe and lock its DACL to that user.
   It also reads the SID of the process serving a pipe, so the CLI talks only to
   a server running as the same user.
2. `pipe_watchdog` in the same file cancels blocked pipe I/O.
3. `registry` in `crates/polymine-cli/src/user_path.rs` edits the user's `PATH`
   and broadcasts the change.
4. `src-tauri/src/edge_fit.rs` subclasses the Windows window to take a double
   click on its edge, so the UI can fit the window to the board.
5. `src-tauri/src/foreground.rs` reads the Windows foreground window, so focus
   loss pauses the game only when another window is in front.
6. `src-tauri/src/traffic_lights.rs` gives the macOS window an empty compact
   `NSToolbar`, so AppKit centers the traffic lights on the 40 pt toolbar.
7. `message_box` in `src-tauri/src/fatal.rs` shows a startup failure on Windows,
   where a release build has no console for the error.
8. `windows_icon` in `src-tauri/src/taskbar_icon.rs` gives the window its big
   icon, which the taskbar and Alt+Tab draw. Tauri's `set_icon` sets only the
   small one.

A new `allow(unsafe_code)` gets a line here in the same change.

**Why:** No safe wrapper exposes these calls, and `forbid` can't be lifted for
one module. `deny` still fails the build on any other unsafe block. Naming every
module keeps a new `allow` from slipping in unrecorded. Traffic lights moved by
hand don't hold: AppKit lays the title bar out again on every frame of a live
resize, so they jump between its place and ours. Tauri's `trafficLightPosition`
moves them by hand too, so only a toolbar AppKit sizes itself keeps them still.

## 8. Third-party notices ship in the About window

**Date:** 2026-11-03

**Decision:** `npm run notices` generates one notices file. cargo-about lists
the Rust crates that ship on the release targets, and the Vite build lists the
npm packages that reach the bundle. The file is committed, CI fails on drift,
and the About window shows it.

**Why:** The installers ship hundreds of crates and the bundled PixiJS and
Svelte, whose MIT, BSD, Unicode, and Zlib licenses ask for their notices to
travel with copies. MPL-2.0 also asks recipients to learn where the source is. A
committed file shows each dependency change in review.

**Alternatives:** `rollup-plugin-license`, which adds dependencies and predates
Vite's switch to Rolldown, and a notices file beside the installers only, which
the Mac app bundle and the portable ZIP would not carry.

## 9. Tilings are data

**Date:** 2026-10-24

**Decision:** A tiling is a repeating patch of polygons. Cells are neighbors
when they share an edge or a corner, computed from the geometry.

Slots sort into rows by their vertex means, compared on a grid of 1e-9. Means
equal in exact math then tie on every platform, and each tiling breaks such ties
top first or bottom first, whichever keeps the order saved games and seeds
already use. A test pins every tiling's cell order.

**Why:** Deriving the neighbors from the geometry makes a new tiling a matter of
coordinates, and tests can check every tiling the same way. Saves and seeds
rebuild boards by cell index, and `sin` and `cos` round differently on each
platform, so a raw float comparison would let a tie in exact math build a
different board on another machine.

**Alternatives:** exact constants for the vertices that tie. That fixes today's
ties but not the next tiling's, and it would have flipped the order saved
Rosettes games use.

## 10. ChaCha8 for mine placement

**Date:** 2026-11-01

**Decision:** Mines are placed with `rand_chacha::ChaCha8Rng`, and a test pins
the layout one seed produces.

**Why:** `StdRng` may change its algorithm between rand releases, which would
break saved games, shared seeds, and replays.

## 11. Twin cells never hold a mine

**Date:** 2026-11-02

**Decision:** Mine placement skips twin cells, which have exactly the same
neighbors as another cell, whenever the board has room for the mines without
them.

The rule follows from the board, the first click, and the mine count, so a
player can know when it applied. The solver uses it too: when it applied, every
closed twin counts as safe and the mines spread over the other cells. The
property tests' brute force applies the same rule.

**Why:** A single mine between two twins is a coin flip that no reasoning can
avoid. Board edges create twins on kites, where the assistant lost about half
its games at 6% density. With twins kept clear, it wins 96%. A solver blind to
the rule guessed on risky cells while a closed twin was certainly safe, and its
hint odds were wrong on boards with twins.

## 12. Obtuse triangles come from rhombuses, and the cube pattern is out

**Date:** 2026-11-02

**Decision:** The 30-30-120 triangle tiling cuts rows of 120° rhombuses along
their long diagonals, rather than cutting equilateral triangles into three. The
cube pattern of 60° rhombuses, three to a hexagon, is not offered.

**Why:** In the three-way cut, every triangle has a twin across its long edge,
so every board is full of coin flips. In the cube pattern, a rhombus touches
exactly the cells around its two sharp corners. Two different mine layouts on
any four-corner loop then show the same numbers, so the assistant won only 38%
of games even at 6% density.

## 13. Difficulty is the level plus the tiling's complexity

**Date:** 2026-11-02

**Decision:** Each level has one mine density on every tiling. Each tiling has a
measured complexity rating from 1 to 5, shown in the picker. Complex shapes are
meant to play harder.

**Why:** FastMines tuned a mine percentage per tiling, rising with the neighbor
count, so its levels felt alike across tilings. The maintainer prefers shape to
count as difficulty, and the rating tells players what they're choosing. At
Professional, the assistant wins 64% of square games and 2% on Rosettes.

**Alternatives:** a mine density per tiling that rises with the neighbor count,
as FastMines' levels do.

## 14. FastMines click and pause behavior

**Date:** 2026-11-02

**Decision:** Polymine follows FastMines here. Right click restarts an ended
game and resumes a paused one. Marks wait for the first open. Losing focus,
minimizing, or opening a dialog pauses the game, and Esc pauses and minimizes. A
setting turns off the pause on focus loss.

**Why:** A behavior audit of FastMines found these were part of its feel, and
the maintainer missed the right-click restart first.

## 15. Deliberate differences from FastMines

**Date:** 2026-11-02

**Decision:** Polymine keeps these differences:

1. A loss reveals mines and wrong flags only, marks the mine that exploded, and
   animates by distance. FastMines reveals the whole board.
2. A press follows the pointer while the left button is held, as in classic
   Windows Minesweeper, and releasing elsewhere cancels the click.
3. The clock counts milliseconds across pauses; FastMines drops part of a second
   at each pause.
4. Hints also suggest flags, wrong-flag removals, and best guesses with their
   risk, instead of only certain safe opens.
5. The window doesn't stay on top while active.
6. The idle assistant is off by default. FastMines takes over after 30 seconds
   out of the box, which surprises new players.
7. Two FastMines bugs, seen in play, are not ported: a loss with as many flags
   as mines counts as a win, and the assistant reads the hidden mine count.
8. Only opening every safe cell wins. FastMines also wins when the flags sit on
   exactly the mines, which lets a player settle any guess by trying flag
   layouts until one wins. A test that way settled 117 of 117 end-game guesses,
   and those wins counted for champions.
9. The click that opens a number runs only smart click's flagging step. It never
   opens the neighbors; a second click on the open number does. FastMines runs
   the whole smart click on the opening click, so with a wrong flag nearby a
   click that opened a safe cell could hit a mine. The maintainer is trying this
   and may revisit it.

**Why:** Each one either gives the player more information, matches current
platform conventions, or fixes a bug or a loophole.

## 16. History keeps every finished game and ranks unaided ones

**Date:** 2026-11-03

**Decision:** Each finished game appends one record to `history.jsonl`. A game
left unfinished, by a new game or by closing the window, leaves no record.
Statistics and champions come from ranked records only: assisted games and
custom levels never rank. Average time and clicks count wins only. The file
keeps every ranked record and the newest 2,000 unranked ones. Once it holds
3,000 unranked records, it is rewritten through a synced temporary file and a
rename. Only ranked records are held in memory. Abandoned records in older files
count as unranked.

**Why:** Appending never rewrites earlier games, and new views need no
migration. Records should reflect unaided play on comparable boards. FastMines
records no unfinished game, and recording one on a new game but not on exit
would be inconsistent. Idle autoplay can add about 2 MB of assisted games a
night. Statistics never read unranked records, so trimming them changes no
number the player sees.

**Alternatives:** recording abandoned games as played, and keeping every
unranked record.

## 17. Autosave by replay, every 5 seconds

**Date:** 2026-11-02

**Decision:** An unfinished game is saved as its seed and moves every 5 seconds
when it changed, on pause, and on exit. It is restored paused on the next start.

**Why:** The maintainer wants closing and reopening to pick up the game with no
questions asked. Saving only on exit would lose games to crashes and forced
restarts, while writing on every move is needless for a game. Saving every 5
seconds bounds the loss. A seed and moves are a few kilobytes and rebuild the
board exactly.

## 18. Rules changes are logged with the moves

**Date:** 2026-11-03

**Decision:** The saved game holds the rules it started under, and each rules
change mid-game is an entry in its move log. Replay applies each move under the
rules in effect when it was played. Rules aren't frozen per game: a change in
the settings applies to the game in progress. A save with no rules entries
replays under its saved rules.

**Why:** Replaying every move under the rules at save time rebuilds a different
board than the one on screen. For example, a removed `?` comes back as a flag.

## 19. Games pause when the computer sleeps

**Date:** 2026-11-03

**Decision:** A game in play pauses when the computer sleeps, on every platform,
and the time asleep never counts. The autosave thread ticks every second and
treats a gap of 10 seconds or more on the wall or monotonic clock as sleep.

**Why:** `Instant` stops during sleep on macOS and keeps counting on Windows, so
the same game left open overnight would record different times. Tauri exposes no
system sleep event on desktop, and the clock comparison works the same
everywhere.

## 20. A loaded named save counts as assisted

**Date:** 2026-11-03

**Decision:** Loading a named save replays it paused and marks the game
assisted, so it can't set a record. `App::load_save` sets the flag whatever the
save held.

**Why:** A save lets a player return to a known position and retry it until a
guess comes out right. Records should come from one unbroken attempt, as with
the assistant's moves and the CLI's.

**Alternatives:** keeping the save's own flag, which turns saves into free
retries; and ranking a loaded game only when it was saved before the first open,
which adds a rule for little gain.

## 21. Players are names only

**Date:** 2026-11-04

**Decision:** A player profile is a name and nothing else. Settings list the
players and mark the active one, whose name goes on every game it finishes.
Theme, rules, and the other settings stay shared by everyone on the computer.
Stats open on the active player, with "All players" one click away.

**Why:** Records already carry a player name, so a list of names is enough to
tell people apart in stats and the champions table. The maintainer picked the
smaller version. Per-player settings would need overrides layered over the
shared ones, and a story for what changes when the player switches mid-game.

**Alternatives:** profiles that carry their own theme and rules, which can still
grow from this list later; and filtering stats by name in the UI, which would
miss a player's wins outside the overall top 10.

## 22. A CLI and a skill, not an MCP server

**Date:** 2026-11-02

**Decision:** Agents play through `polymine-cli`, a separate console program
that prints JSON, and a `SKILL.md` it prints on request. Every app launch is a
named instance, `default` unless set, and the CLI addresses one by name over a
local socket. Moves from the CLI count as assisted.

**Why:** An MCP server puts every tool's schema in every session's context; a
skill costs one line until it's used, and the same JSON works for people,
scripts, and CI. The design follows PecoFence's `pecofence-cli`. Instance names
let tests run an isolated copy beside the player's own, which a singleton app
can't. Counting CLI games as assisted keeps the champions table human.

## 23. A full instance answers busy

**Date:** 2026-11-05

**Decision:** An instance answers up to 16 requests at once. It turns more away
with the `busy` error code, and the CLI exits with code 5. `busy` is part of
protocol version 2. `describe` lists the error codes from the `ErrorCode` enum,
and a test pins every error code to its exit code.

**Why:** A busy app answers at once without playing anything, so a retry is
safe. A move that timed out may still land, and `internal` means something
failed in the app or on disk. An agent has to tell these apart by code, not by
the hint's text. A new code is a change an older CLI can't read, so the protocol
version moved.

**Alternatives:** `internal` with a hint, which reads as a failure; and
`timeout` with exit code 4, which hides that a retry is safe.

## 24. A move is checked in one order on both paths

**Date:** 2026-11-05

**Decision:** Before a move plays, `crates/polymine-ipc/src/moves.rs` refuses a
finished game with `not_playable`, then an empty cell list with `usage`, then a
cell off the board with `invalid_cell`. The app and headless games both call it,
so a bad move gets the same error from either.

**Why:** `polymine-ipc` promises that the app and a headless game answer alike.
With a check on each path, `open 99999` on a finished game got `invalid_cell`
from the app and `not_playable` headless. Playability goes first because a
finished game refuses every move, whatever cells it names.

**Alternatives:** checking the cells first, which tells an agent to fix a cell
id on a game it can't play anyway.

## 25. Network requests go through ureq with rustls

**Date:** 2026-11-03

**Decision:** Every network request but the updater's ([decision 57][d57]) goes
through `crates/polymine-net`, a blocking `ureq` 3 client with rustls, the ring
crypto provider, and `rustls-platform-verifier`. A policy from the caller allows
HTTPS on port 443 to listed hosts only. It caps time, response size, and
redirects, and rechecks every redirect hop. Requests send
`User-Agent: Polymine/<version>`, keep no cookies, and read no proxy from the
environment. ISC is on the license allowlists in `deny.toml` and `about.toml`.

**Why:** A blocking client fits the shell, which already runs slow commands off
the main thread, and the CLI, which has no async runtime. Tests drive it with a
plain `std::net` server. Tokio ships in the app already, but reqwest would add
hyper, tower, and their helpers. On the same TLS stack, a minimal HTTPS GET
built stripped for macOS measured 2.3 MB and 33 crates with ureq, against 3.2 MB
and 114 crates with reqwest. reqwest's default TLS also uses aws-lc-rs, whose C
build and OpenSSL-licensed code ring avoids. The platform verifier checks
certificates against the system's trust store on Windows and macOS, including
roots an administrator adds, so no bundled root list goes stale. It also keeps
webpki-roots and its CDLA license out. ISC grants the same rights as MIT;
rustls-webpki, untrusted, and ring use it. `polymine-cli` depends on the crate
for `sync`, so `npm run notices` lists these crates.

[d57]: #57-the-players-own-copy-updates-itself-from-signed-github-releases

**Alternatives:** reqwest with rustls on Tauri's tokio runtime, native-tls with
each platform's TLS library, and `tauri-plugin-http`, which ties requests to the
app and leaves the CLI and tests without them.

## 26. Histories sync ranked games through a gist

**Date:** 2026-11-03

**Decision:** `polymine-cli sync` shares a history through a GitHub gist the
player owns. It sends and takes only ranked records (decision 16). It adds the
games the gist lacks after the lines the gist already holds, and it only appends
to the local file. A record is one game when every field this build knows
matches. The gist keeps every line as it was, including lines this build can't
read and unranked records, and those never reach the local file. The token comes
from `POLYMINE_GITHUB_TOKEN`.

**Why:** A gist needs no server of our own, and the history is already JSON
lines. Merging by record never drops or doubles a game, whichever machine syncs
first. Appending keeps the local file safe while the app writes to it.
Statistics read only ranked records, and the app caps unranked ones, so syncing
them would bring back what the cap dropped. Rewriting the gist from the records
this build parses would delete lines a newer build wrote and strip the fields it
added. Matching on known fields keeps a newer build's copy of a game from
counting as a second game. A keychain for the token and an in-app sync wait for
a Settings UI.

**Alternatives:** writing the union back to the gist, which loses what this
build can't parse; comparing raw lines, which doubles a game whenever two builds
write it differently; and pruning unranked lines from the gist, which deletes
records another machine may still want.

## 27. Native chrome that follows the platform

**Date:** 2026-11-01

**Decision:** The window follows the system's light or dark mode. It uses Mica
on Windows 11 and `sidebar` vibrancy with an overlay title bar on macOS, and
falls back to an opaque window color elsewhere. A theme with
`--window-material: frosted`, such as Frost, switches to a frosted blur: Acrylic
on Windows and the under-window material on macOS. Controls follow Fluent
metrics on Windows and AppKit metrics on macOS.

**Why:** A UX review found that a dark web page in a window reads as foreign on
both platforms. A forced navy theme ignores a light-mode system, and generic
gradient styling looks like no platform at all.

## 28. No menu bar on Windows

**Date:** 2026-11-01

**Decision:** Windows gets no native menu bar; its commands live in the
toolbar's overflow menu. macOS keeps a full native menu bar, including Edit and
Window menus.

**Why:** Current Windows 11 apps use a toolbar and overflow menu, and a classic
Win32 menu bar looks dated. macOS apps need a menu bar. Without an Edit menu,
the clipboard shortcuts stop working in text fields.

## 29. Player data lives in a Polymine folder

**Date:** 2026-11-03

**Decision:** Settings, history, the saved game, named saves, player themes, and
the window state live in a `Polymine` folder in the platform's config and data
folders, such as `%APPDATA%\Polymine`. They don't go in folders named after the
app identifier `dev.uvw.polymine`. The folders Tauri manages from the identifier
keep its name: the runtime folder, the logs, and the WebView cache.
[design.md](design.md#data-and-runtime-folders) lists every path.

**Why:** The player sees these folders, and the reverse-domain name reads like
noise. Tauri derives its own folders from the identifier, and the macOS bundle
ID is the identifier, so it stays reverse-domain. The window-state plugin always
writes into the identifier's folder, so Polymine saves its window state itself.

## 30. Keep Pixi, render on demand

**Date:** 2026-11-01

**Decision:** The board stays on PixiJS. Its ticker stops when nothing moves,
and cells share one `GraphicsContext` per shape and state.

**Why:** An idle ticker runs at the display's refresh rate and cost about 15% of
a core. Shared contexts keep large custom boards cheap. SVG, Canvas 2D, raw
WebGL, and native `wgpu` were weighed and rejected.

## 31. Minimum cell size, then scroll

**Date:** 2026-11-01

**Decision:** Cells shrink to fit down to a 5 px inradius; larger boards scroll.
The window's minimum size is 800 x 600.

**Why:** An 11 px floor kept dense boards from fitting a smaller window, which
the maintainer wanted more than readable digits at a glance. Zoom brings digits
back when they get too small.

## 32. Results show in the toolbar

**Date:** 2026-11-01

**Decision:** The end-of-game result replaces the mine counter and clock in the
toolbar instead of a card over the board.

**Why:** A card covers the bottom rows, and the space reserved for it pushes the
board off center in every state.

## 33. Keyboard play by direction

**Date:** 2026-11-01

**Decision:** Arrow keys, or W, A, S, and D, move to the neighbor whose
direction is nearest the key's, preferring closer neighbors.

**Why:** It works on every tiling without per-tiling key maps.

## 34. The wheel and a pinch resize the window

**Date:** 2026-11-03

**Decision:** The plain wheel, Ctrl and the wheel, and a trackpad pinch over the
board resize the window around its center, keeping its aspect ratio. The zoom
keys zoom the cells inside the window, and so does a touch-screen pinch. Shift
and the wheel, or a middle-button drag, scroll a board larger than the window.
Each side stops at its own limit, the 800 by 600 minimum or the work area, and
input past the point where both sides stop is dropped. Nothing happens while the
window is maximized or fullscreen, or while a dialog is open.

**Why:** The maintainer wanted the window, not the cells, to follow the wheel,
and the board already refits its cells whenever the window resizes. Ctrl and the
wheel resize too, because WebView2 sends a precision-touchpad pinch that way, as
all Chromium builds do. WKWebView sends a pinch as WebKit gesture events
instead, since wry leaves `allowsMagnification` off. Letting one side stop at
its limit while the other carries on keeps the ratio between the screen's and
the minimum's. The scale is measured from the frame when the input began, so
turning back within one gesture restores the ratio. A mouse wheel notch resizes
by 4%: at 10% each notch jumped too far, the maintainer found on 2026-11-14.

**Alternatives:** a modifier for the wheel, which the maintainer turned down;
anchoring at the pointer or a corner instead of the center; fixed 25% steps; and
stopping both sides as soon as either reaches a limit, which leaves a tall
window at the minimum width unable to shrink at all.

## 35. Themes are folders of CSS variables that pair chrome and board

**Date:** 2026-11-03

**Decision:** A theme sets the chrome look and the board palette together. It is
a folder with a `theme.css` that holds a header comment and one `:root` rule of
custom properties, plus optional SVG glyphs and a `preview.png`. The header
names the theme and its `Format`, 1 today, so a later change to the format can
be detected. Every variable is optional and defaults to Graphite's untinted
look. Frost is the default theme. Built-in and player themes take the same path:
they differ only in where the files come from and in the `Relaxed:` header line,
which only built-in themes may use. A fixed look, such as Midnight's, sets the
chrome through an allowlist of chrome tokens. Settings shows every theme's name
from its header, so theme names aren't translated.

**Why:** Players can write and share CSS variables without the code. The same
parser checks built-in and player themes, so a player's theme can do what a
built-in one does. A version number in the header lets an older build skip a
theme it would draw wrong instead of guessing. Pairing chrome with the board
lets a theme keep a whole look, as Midnight keeps the game's first one.

**Alternatives:** a JSON theme file, which can't use `color-mix()`,
`light-dark()`, or the accent; and a stylesheet the app injects, which would let
a theme restyle anything and load resources.

## 36. Theme variables resolve away from the app's styles

**Date:** 2026-11-03

**Decision:** The UI reads hex, `rgb()`, `light-dark()`, and
`color-mix(in srgb, …)` colors itself. It resolves any other color on a hidden
element inside an empty `about:blank` frame, where a theme sees only its own
variables and `--system-accent`. Values that aren't colors take plain numbers,
lengths, and keywords. Chrome tokens go on `<html>` as inline properties, and no
theme file is ever added as a stylesheet.

**Why:** The browser handles any CSS color, but it stores the alpha of `rgb()`
colors in 8 bits and prints mixed channels to six digits. Either changes
Midnight's sheen and some tinted edges by a level. Reading the common forms
directly keeps the built-in themes exact and makes the tests run the same code
as the app. On an element in the page itself, a theme would also inherit the
app's tokens and the Reduce Motion transitions, which delay every read.

## 37. Board colors are opaque, and layers have opacities

**Date:** 2026-11-03

**Decision:** Board colors are opaque; one with alpha loses it, with a warning.
See-through layers come from `--board-plate-opacity`, `--cell-closed-opacity`,
and `--cell-open-opacity`. The sheen is the one board color with alpha. Each
built-in theme writes its accent tint in its CSS as
`color-mix(in srgb, <color>, var(--system-accent, <color>) <amount>)`.

**Why:** Mixing a see-through color with the opaque accent changes its alpha, so
Frost would turn more solid when tinted. One opacity per layer also reads better
than the same alpha repeated on four closed-cell colors. The sheen is a
highlight laid over the cell, which a color with alpha says directly. Writing
the tint in each theme lets a theme use the accent its own way, such as closed
cells in the accent itself.

## 38. Player themes come from a folder with hard limits

**Date:** 2026-11-03

**Decision:** Player themes live in `themes` in the instance's data folder.
`polymine-ipc` checks each folder before the UI sees it:

1. Only the known file names, matched exactly, no symbolic or hard links, and no
   subfolders.
2. 32 KiB for `theme.css` and each SVG, and 64 KiB for a README or license file.
3. 256 KiB and 1024 by 1024 pixels for the preview.
4. 1 MiB per theme, and at most 64 themes.

SVG files load only as images, and every `href` and `url()` in one must name an
`id` in the same file. A built-in id wins over a player folder with the same
name. The UI reads the folder at startup, when Settings opens, and when the
window comes to the front, and lists themes that didn't load with the reason.

**Why:** Theme files are untrusted, and downloaded themes will land in the same
folder. Checking the folder in a crate without Tauri lets a download use the
same rules before it moves a theme into place. An SVG loaded as an image can't
run scripts or fetch anything, which a sanitizer would have to prove for every
SVG feature. A reference outside the file loads nothing, but the webview can
draw a broken-picture box in its place. A `data:` URL counts as outside: it
embeds a second file, often base64, that no check reads. Reading the folder on
focus lets a player edit a theme and see it by switching back. A hard link
passes every check a plain file does but can share its contents with a file
anywhere on the volume.

## 39. Themes never carry shader code

**Date:** 2026-11-03

**Decision:** Board effects are GPU shaders that ship with the app. A theme,
built-in or a player's, picks and tunes them with variables such as
`--board-effects`; it never supplies shader code, now or later. Experimental
effects may ignore the readability and flash limits the theme tests apply, until
one ships in a bundled theme.

**Why:** A shader can't reach files or the network, but a bad one can hang the
GPU or lose the WebGL context. Theme folders are meant to be safe to share. The
maintainer wants experiments free of guardrails while keeping player themes to
data.

## 40. Experimental themes show only in development builds

**Date:** 2026-11-04

**Decision:** A built-in theme that tries out a board effect, such as
Ferrofluid, is a folder in `ui/src/themes` named in `EXPERIMENTAL_THEMES`.
Development builds list it after the other built-in themes; release builds leave
it out unless built with `VITE_EXPERIMENTS=1`, which the maintainer uses to try
an experiment in an installed app. The theme tests and the color filter tests
skip it.

**Why:** A hidden setting needs a field in Rust, a control, and a story for
release builds, all for a look still changing every hour. A folder listed only
where the maintainer and agents run lets the effect be tried in the real app,
and decision 39 already frees experiments from the readability checks.

**Alternatives:** a hidden setting, which can come once an experiment is worth
trying in a release build; a player theme in the data folder, which the repo
can't ship; and a bundled theme, which would have to pass every theme test.

## 41. Theme tests hold every built-in theme to readability bars

**Date:** 2026-11-03

**Decision:** The theme tests check every built-in theme in light and dark mode,
untinted and with each of 20 macOS and Windows accents. Digits reach 4.5:1 on
open cells, closed cells reach 3:1 on open ones, and the flag reaches 3:1 on
closed cells. Count colors stay apart under deuteranopia, protanopia, and
tritanopia. They stay 2.5 OKLab units apart when digits carry the count, and 10
apart when color alone carries it, which also holds in normal vision. A theme
relaxes a check only through its `Relaxed:` header line, for a look kept on
purpose, and the reason goes in this file.
[How theming works](themes/how-theming-works.md#tests) lists every check and
what relaxing it lowers.

Midnight relaxes `cell-contrast` and `number-separation` to keep the game's
first look. Pride and Spectrum relax `cell-contrast`, since their tiles stay
dark under the count colors. Datum relaxes `number-separation`: its near-black
inks sit too close for some pairs, and the dot-matrix glyph's shape carries the
count. Rupture and Diode relax `cell-contrast` for dark tiles on a black board,
which their rim light or dome highlight sets apart, and Deboss for one khaki
card pressed up and in. Frost, Swatch, Glass, and the editor themes give their
reasons in decisions 45, 46, 48, 50, and 53.

**Why:** Testing themes as data keeps a new theme from regressing legibility.
Digits need only side-by-side separation, about one just-noticeable step. A
player names a color-only count from one small cell against the key, so 10,
about five steps, leaves room for that and for the simulation's error. At 2.5,
Spectrum's 2 and 4 sat 3.5 apart under protanopia. One strong accent misses the
spread from yellow to dark gray that real accents cover. A player who needs the
separation a relaxed theme gives up turns on the color filter (decision 42).

**Alternatives:** holding only the main themes to the color vision checks and
letting the rest opt out, which leaves a player without help on most themes; and
one separation bar for every theme.

## 42. A color filter solves each theme's pairs under the deficiency

**Date:** 2026-11-03

**Decision:** A Color filter setting, off by default, remaps the board colors of
any theme, built-in or a player's, for deuteranopia, protanopia, or tritanopia.
It checks the pairs of colors a player must tell apart against the theme tests'
bars (decision 41), under the Machado simulation and in normal vision. A failing
pair's two colors take the smallest step in OKLab that clears the bar with some
headroom, in the manner of Kuhn, Oliveira, and Fernandes's mass-spring
recoloring for dichromats. A board that passes comes back unchanged, and a pair
the theme keeps below a bar keeps most of what it has. SVG glyphs get an
error-shifting daltonization per pixel when their textures are drawn. A theme
may still relax the separation check for its look, because a player who needs
the separation turns on the filter.
[How theming works](themes/how-theming-works.md#color-filters) gives the pairs,
the bars, the headroom, and the solver.

**Why:** A solver on the theme's own pairs gives a result the tests can check
and leaves alone what already works. Midnight's 1 and 4 go from 1.3 to 3.0 apart
for a deuteranope, and its 2 and 6 from 1.4 to 4.1 for a tritanope. Seeded
random palettes built so their colors collide, at 0.2 to 3 units apart, all
clear their bars. The filter also catches what the theme tests miss, since they
check contrast only in normal vision and reds darken under protanopia. Glyph
colors carry no meaning the filter can read, so a fixed per-pixel rule is the
honest option. Applying it when a texture is drawn keeps it exact in linear
light and free per frame.

**Alternatives:** daltonizing every board color, which moves colors that already
pass and guarantees no bar; a simulation filter, which shows the problem instead
of fixing it; a palette per deficiency in each theme, which every author would
have to write; a Pixi `ColorMatrixFilter` on glyph sprites, which works on
gamma-encoded values and costs a render pass per sprite; and pushing failing
digit pairs far past 2.5, which treats a pair just under the bar much better
than one just over it.

## 43. Color-only themes ring high counts and keep their key under the board

**Date:** 2026-11-03

**Decision:** A `colors` theme gives each count to 14 a look of its own. The
`--number-ring-from` variable draws counts from that one up as rings: the color
fills a band inside the cell's edge and the middle stays open. Pride and
Spectrum ring 9 to 14 in the colors of 1 to 6. The tests hold counts drawn alike
to the OKLab distance of 10 from decision 41, under normal vision and the three
deficiencies; a ring and a fill pass on shape. The key sits in a strip under the
board, sized to the counts the tiling can reach, and the Show the count key
switch hides it for a harder game. The cell under the pointer or the keyboard
focus shows its count as a digit, and its chip in the key lights up.

**Why:** Crosses reach 14 neighbors and triangles 12, and eight colors can't
cover every count. A search found 14 colors that clear the bar, at 10.4, but in
no order. Pride's cool-to-hot and Spectrum's red-to-violet would be lost, and a
player would have 14 colors to learn. A ring in a known color reads as "8 more",
works on every cell shape, and still shows on the smallest cells. A legend in
the board's corner covers cells on full boards. The strip never does, and the
digit answers "which count is this" where the player is looking, without eye
travel to the key.

**Alternatives:** 14 separate colors; dots or stripes, which blur on small
triangles; a legend in the toolbar, which has no room at 800 by 600 and hides
with the toolbar.

## 44. Cells take one light, drawn from one shared texture

**Date:** 2026-11-03

**Decision:** Themes can light their cells with optional variables, so the
format stays 1. One light angle sets the direction for every layer. A glare
covers the part of a closed cell nearest the light. A rim light runs inside the
edges that face a second angle. A shade rounds closed cells off away from the
light and sinks open cells under it. Digits can cast a shadow, and a glint can
sweep a closed cell under the pointer, never with Reduce Motion on. Every layer
is off by default. Each layer is a profile across the cell along the light,
written as a row of one shared 256-texel texture. A matrix per shape lays the
row across the shape. The shade is baked into the cell's fill. The theme tests
and the color filter check the flag, digits, and closed against open cells on
every color the shade and glare can put under them. They skip the flat sheen.
[How theming works](themes/how-theming-works.md#light-on-cells) describes the
layers.

**Why:** Every tiling's cells are convex polygons, so a profile along the light
fits each one where an image or a box-shaped gradient would not. One texture
keeps every cell in the same batches: a batch holds 16 textures, and digit
textures take most of them. Baking the shade into the fill adds no vertices. On
a 200 by 200 board, a theme with every layer on took 430 to 476 ms per theme
switch and 394 MB of heap. Graphite took 414 to 455 ms and 362 MB. Checking
marks against the glare shows that a lit tile puts the flag's cloth on the
glare, so only a dark outline keeps it visible there. Checking marks on the flat
sheen too would fail Catppuccin Latte's flag, at 2.2:1 on its 30% sheen.

**Alternatives:** a Pixi `FillGradient` per layer, which builds a texture per
gradient and fits it to each shape's bounding box, not along the light; a blur
filter for the inner shadow, which costs a render pass; and per-vertex colors,
which Pixi `Graphics` doesn't take.

## 45. Frost puts its look ahead of readability over bright desktops

**Date:** 2026-11-03

**Decision:** Frost's open cells are nearly clear (6% tint), and Frost relaxes
`number-readability`, the check that see-through numbers reach 4.5:1 over a
white or a black desktop.

**Why:** The maintainer wants Frost to look like glass. A dark tint on open
cells or a halo around each digit kept the numbers readable but made the theme
look opaque. Players who need the contrast can pick Graphite or Datum.

## 46. Swatch fills closed cells with the system accent

**Date:** 2026-11-03

**Decision:** Swatch is a built-in theme with flat closed cells in the accent
itself, `var(--system-accent, #007aff)`, on a pale floor in light mode and a
dark one in dark mode. It relaxes `cell-contrast`. The theme tests run every
built-in theme against macOS's eight accents, as `controlAccentColor` gives them
in light and dark mode, and 12 Windows accents. Settings previews resolve with
the accent while the tint switch is on.

**Why:** Accents run from yellow, 1.5:1 on a white floor, to dark gray, 1.9:1 on
a dark one, so no floor gives every accent 3:1. Hue carries the difference
there, as it does in Pride. The white flag with a dark edge clears 4.5:1 on any
accent, by one or the other. Testing one strong accent misses this spread. A
preview without the accent would show Swatch in blue for every player.

**Alternatives:** an accent darkened or lightened toward 3:1, which stops being
the player's own color; and a `preview.png`, which can't show the player's
accent.

## 47. Glossy glazes tiles in the accent, deep in light mode and light in dark

**Date:** 2026-11-03

**Decision:** Glossy is a built-in theme after Frost. It has solid tiles glazed
in the system accent, with a bowed glare, a rim light along the lower edges, a
shade underneath, and recessed matte open cells.

1. In light mode, the glaze is the accent mixed 55% into a deep navy, on a
   porcelain floor.
2. In dark mode, the glaze is the accent mixed 65% into white, on an ink floor.
   The tile shade mixes toward a slate gray instead of black.
3. The flag is cream in light mode and red in dark, with a dark outline.
4. Digits are new dark colors in light mode, checked against the floor's shaded
   top, and Graphite's in dark mode. A white shadow reads as engraved in light
   mode, and a black one as raised enamel in dark.

It passes every theme test with no `Relaxed:` line.

**Why:** Frost is see-through glass, and Glossy is its solid, polished opposite.
Accents run from yellow to dark gray. Only a deep glaze on a light floor, or a
light glaze on a dark one, keeps 3:1 for all of them with the shade included. A
yellow accent becomes amber glass in light mode, and dark gray a pewter tile in
dark mode. The glare whitens the top of a tile, so the flag's fill carries it on
the shaded tile and its outline under the glare.

**Alternatives:** the accent itself as the tile, as in Swatch, which can't clear
3:1 against one floor for every accent; and a fixed candy color, which ignores
the player's accent.

## 48. Glass lights see-through cells and relaxes cell and digit contrast

**Date:** 2026-11-03

**Decision:** Glass is a built-in theme after Glossy, made only of a
`theme.css`. It puts Frost's frosted window under 10% closed cells and 5% open
ones. Glossy's bowed white glare runs at 85% fading to 6%, and a rim light in
the accent runs along the lower edges. It has no shade. Open cells and digits
follow the mode, since the frosted material does: pale open cells with deep
digits in light mode, dark ones with Frost's pastels in dark mode. Light-mode
closed cells are white, and dark mode tints them with the accent. Glass relaxes
`cell-contrast` and `number-readability`. Light-mode closed and open colors
reach 1.51:1, against 3:1. Digits over a black desktop reach 1.44:1 in light
mode, and over a white one 1.00:1 in dark mode, against 4.5:1.

**Why:** The maintainer wants glass that remixes Glossy with Frost. The glare
and the rim draw at their own opacity over the cell, so they brighten the glass
instead of graying it. A shade would mix into the cell's fill and fade with it.
Closed cells read as glass by their light, not by a darker or lighter fill, so
3:1 between the two layers' colors would need an opaque tile. Digits are chosen
for the material in each mode, so the opposite desktop washes them out, as in
Frost (decision 45).

**Alternatives:** Frost's light pastels in both modes, which vanish on the light
material; and a stronger closed fill, which reads as a gray film.

## 49. Editor themes take their sources' names and official palettes

**Date:** 2026-11-03

**Decision:** 12 built-in themes follow popular code editor color schemes. The
dark ones are Atom One Dark, One Dark Pro, Dracula, Monokai, GitHub Dark, and
Solarized Dark. The light ones are Atom One Light, Alucard, GitHub Light,
Solarized Light, Catppuccin Latte, and Monokai Light. Each fixes its mode and
paints an opaque window in chrome tokens of its own. Each uses its source's
official palette, except Monokai Light, which adapts Monokai's (decision 53).
Its header credits the author and names the source in a `Source:` line. Where an
official color misses a theme test bar, it moves in OKLab lightness only,
keeping hue and chroma. `theme.css` then names the original and the color used.
Schemes with fewer than 12 usable colors mix a syntax color half and half with
the text or darkest color. The themes mix the system accent only into the
closed-cell hover. The third-party notices list each palette with its license.
Folder ids are kebab case. Older custom ids, such as `velvet`, map to them, and
a player's folder can't take one.

**Why:** The maintainer decided popular coding themes need no custom names, and
a name that promises Dracula should deliver Dracula's colors. Syntax hues sit at
one lightness, while numbers need 4.5:1 on an open cell and must stay apart
under color vision deficiency. Moving lightness alone keeps each color
recognizable while it clears the bar. Tinting more than the hover would pull a
scheme's signature colors toward the player's accent. The id map keeps players
on the theme they chose, and reserving the old ids stops a player's folder from
taking over that choice. Monokai's theme file carries no license, so Polymine
uses only its color values and says so in the notices.

**Alternatives:** custom names that never use the scheme's name, which hides
where the colors come from; relaxing the checks to keep every official color
exact, which would leave light schemes' pastel digits under 3:1; and one theme
per scheme that follows the system's mode, which pairs schemes that weren't
designed together.

## 50. Editor themes part cells like panes

**Date:** 2026-11-03

**Decision:** Editor themes part closed cells from open ones the way the editor
parts its panes. Closed cells take a neighboring pane color of the editor, and
open cells take its background. The dark themes' closed cells are pits darker
than the board, and the light themes' are tiles. Cells are flat: a closed edge a
hair off the closed fill, and no bevel, sheen, shade, rim light, or light angle.
Each editor theme relaxes `pane-contrast`, which lowers the floor between closed
and open cells to 1.06:1, in normal vision and under each filter's simulation.
The question mark must reach 3:1 on a closed cell.

**Why:** The maintainer found gray closed cells far too bright against the
syntax colors. A 3:1 edge in the comment gray made a bright grid on a dark
editor, and a shade's gradient on closed cells looked ugly. The maintainer asked
for separation like VS Code's panes. An editor's surfaces sit within 1.3:1 of
its background, and even black reaches only 1.50:1 on One Dark's background, so
no honest fill reaches 3:1. GitHub Dark's inset canvas on its canvas, 1.09:1, is
the closest pair of panes among the editors, and the filters pull a pair about
0.02 closer. So 1.06:1 keeps every theme at least that far apart. Editors draw
their panes flat, and the fills alone reach 1.09 to 1.24:1.

**Alternatives:** a 3:1 closed edge in the comment gray, which the maintainer
found too bright; no floor at all, which would let a closed cell vanish into the
board; a shade at a quarter of the strength, which the maintainer turned down in
side-by-side samples of One Dark Pro and GitHub Light; and lighter open cells,
which leave the editor background and weaken the digits.

## 51. Editor theme counts follow the syntax colors

**Date:** 2026-11-03

**Decision:** An editor theme's count colors follow its syntax colors in one
shared order, the keyword color first, skipping a token whose color an earlier
count took. The colors come from each editor's published theme.
[How theming works](themes/how-theming-works.md#adding-an-editor-theme) gives
the order.

**Why:** The maintainer found the classic blue, green, red count order unrelated
to how the editors look, since the keyword color dominates their code views.

**Alternatives:** the classic minesweeper order in each scheme's nearest hues.

## 52. Themes get a page of their own, in sections by where they come from

**Date:** 2026-11-08

**Decision:** Settings gives themes their own page, which replaces Appearance.
It opens on the current theme: a large preview with its full description and
author, a star to make it a favorite, and beside it the options that change how
it draws. Those are the accent tint, the count key, the color filter, and New
theme each game, which switches to a random theme with each new game, from the
favorites or from all themes. Below, a heading carries the search field and
Surprise me, and one row of chips picks what the grid shows: All, Recent,
Favorites, Light, Dark, B&W, or See-through, one at a time. The grid lists every
theme in one scroll, in sections named Signature, Code, and Custom, each with
its count. Signature holds the app's own looks, Code the editor themes (decision
49), and Custom the player's themes; `EDITOR_THEMES` in `builtin.ts` sends each
built-in theme to its section, and Custom shows only when the themes folder
holds a theme. A card draws a small hex board with the theme's own glyphs and
light, and its name. A click chooses the theme, and nothing happens on hover.
The shell keeps the recent list, and the window can't write it.

**Why:** Ten signature themes brought the count to 31, and the maintainer wants
room for many more. A page of its own scrolls freely, and search, chips, and
favorites keep any theme a few clicks away. The first version stacked three
option cards, a search, and two rows of chips above the grid, so one row of
themes showed. Its cards cut each description off mid-word. Hover flyouts and a
try-on that redrew the board behind Settings made the page lag. The maintainer
rejected that version on 2026-11-14, and approved this one from a mockup. The
current theme leads because the dialog covers the board, so the page is the only
place to see what's chosen, and the options sit beside it so their effect shows
at once. Source chips went because the sections already name the source. The
previews are drawn rather than cut from screenshots: a picture can't follow the
accent, the light or dark mode, or the color filter, which Glossy, Swatch, and
Frost all depend on, and it goes stale when a theme changes. A player's
`preview.png` still replaces the drawn board. Player themes get their own
section because a player looks for a theme they added in one place. The group
list lives in code, not in a `Group:` header line, because only built-in themes
need a group.

**Alternatives:** keeping Appearance as its own section, which left two switches
on a page; tabs on Appearance, which scroll at 31 themes and hide the other
settings; trying a theme on while the pointer rests on its card, which lagged;
flyouts with each theme's description; a Recent row, which took a row for what a
chip shows; source chips and mode toggles that combine; preview pictures cut
from the real board; a separate gallery window; loading a player theme's glyphs
only once its card scrolls into view, which matters only with many player
themes; and a `Group:` line in each `theme.css`.

## 53. The Code section sets a dark theme over a light one in each column

**Date:** 2026-11-08

**Decision:** The Code section's pairs each put a dark theme over a light one:
Atom One Dark over Atom One Light, Dracula over Alucard, GitHub Dark over GitHub
Light, One Dark Pro over Catppuccin Latte, Monokai over Monokai Light, and
Solarized Dark over Solarized Light. The grid has five columns on the Themes
page, so the first five pairs fill two rows and the last one starts a new pair
of rows. `EDITOR_COLUMNS` in `builtin.ts` holds the pairs, `editorPlacement`
gives each card its row and column, and a test checks each light theme sits
under its dark one. A search or a chip drops the placement, so the cards that
match close up.

Alucard is the light theme in Dracula's spec, with Alucard Classic's palette
from `dracula/dracula-theme` under that repository's MIT license, and counts in
Dracula's order. Solarized Dark is Solarized's own dark mode. Monokai has no
light variant, so Monokai Light is Polymine's: Monokai's foreground becomes the
background, and its syntax colors keep their hues and darken to 4.5:1. Solarized
Dark relaxes `number-separation`, because Solarized's fixed accents run together
for deuteranopes, and Monokai Light passes every check.

**Why:** The maintainer asked for matching themes to sit one above the other.
Explicit rows and columns keep that at any column count, while the page's order
stays the reading order for the keyboard and screen readers. One Dark Pro ships
dark variants only, so Catppuccin Latte, which has no dark sibling here, fills
its column. Solarized Dark keeps Solarized's published accents rather than
bending them apart, as decision 41 allows for a look kept on purpose; the
maintainer asked that color-blind tuning go to the main themes first. A player
who needs the separation turns on the color filter (decision 42).

**Alternatives:** pairs side by side, two to a row, which loses the column; six
columns, which shrinks every card on the page; a popular light theme with no
dark sibling, such as Rosé Pine Dawn, under One Dark Pro; and Monokai Pro's
light filter, which is commercial.

## 54. Windows releases ship the NSIS installer only

**Date:** 2026-11-03

**Decision:** The Windows bundle builds only the NSIS `setup.exe`, and the
release adds the portable ZIP. No MSI ships.

**Why:** Tauri's installer hooks run only in the NSIS installer, so an MSI
installs Polymine without putting `polymine-cli` on `PATH` and without offering
to remove the player's data on uninstall. NSIS installs per user with no admin
prompt, and winget and the Microsoft Store both take its `.exe`. MSIX, the
Store's own format, is still to evaluate
([#15](https://github.com/uvw/polymine/issues/15)).

**Alternatives:** shipping the MSI beside the NSIS installer as an equal choice,
which hands some players an install without the CLI on `PATH`.

## 55. The window icon follows the theme

**Date:** 2026-11-07

**Decision:** The static app icon is a steel mine on a dark plate with a faint
triangle lattice. While Polymine runs on Windows or Linux, the window's icon is
the same mine drawn in the active theme's colors: its board plate, closed cell,
mine, and mine spark. The plate matches light or dark mode. Every theme gets
one, and a theme may set `--icon-plate`, `--icon-metal`, `--icon-mine`, and
`--icon-spark` to choose its colors. The icon is drawn from a template, never
from a theme's own SVG. macOS has no window icon, and the Dock keeps the static
one.

**Why:** The maintainer wanted the icon to match the theme, and picked the dark
"Poly grid" plate from the concept sheets in `docs/icons`. Deriving the colors
gives player themes an icon for free. Variables keep a theme's input to colors
that pass the usual checks. An `icon.svg` would need a new file type, its own
size limits, and a way to read well at 16 pixels.

**Alternatives:** a static icon only; an optional `icon.svg` in the theme
folder; and changing the macOS Dock icon at run time, which needs AppKit calls
and can wait ([#14](https://github.com/uvw/polymine/issues/14)).

## 56. Each data folder is an instance of its own

**Date:** 2026-11-07

**Decision:** A portable copy adds a short tag of its data folder's path to its
socket name and registry entry. Any instance with a data folder of its own,
portable or under `POLYMINE_DATA_DIR`, skips the one-per-user lock and keeps its
webview data in that folder. Named instances keep theirs in the runtime folder.
Only the player's own instance uses the lock and Tauri's default webview folder.
A debug build is the `dev` instance unless named, so development never touches
the player's data.

**Why:** a portable copy shared the installed app's lock, pipe, registry entry,
and webview folder, so opening it brought the installed window forward, on
different data. WebView2 also refuses to share one folder between instances
started with different browser options, which crashed a second instance. The tag
is FNV-1a over the folder's path, so the CLI beside a copy computes the same one
even when another Rust version built it. `POLYMINE_DATA_DIR` adds no tag,
because tests and agents start a named instance with it and then call the CLI
without it.

**Alternatives:** a portable copy that refuses to start while the installed one
runs; and leaving the identity shared and saying so in the docs.

## 57. The player's own copy updates itself from signed GitHub releases

**Date:** 2026-11-22

**Decision:** The installed app checks
`https://github.com/uvw/polymine/releases/latest/download/latest.json` on
startup, at most once a day, and when the player clicks Check for updates.
`tauri-plugin-updater` does it from Rust, with its own reqwest client; the
webview gets no updater permission and still makes no requests. Only the default
instance of a release build checks: never a named instance, a portable copy, a
copy with its own data folder, or a debug build. The `checkForUpdates` setting
turns the automatic check off, and the last check's time lives in
`updates.json`, not in the settings. A found release shows a notice with Install
and restart, Later, and its release notes. Nothing installs until the player
asks. The update must carry a minisign signature from the key in
`tauri.conf.json` that names the version `latest.json` announces. Windows runs
the NSIS installer in passive mode.

The release workflow's build jobs sign their updater artifacts with a throwaway
key, since Tauri writes them only when it can sign. A separate job, the only one
that sees `TAURI_SIGNING_PRIVATE_KEY`, signs them again with the release key and
writes `latest.json`.

**Why:** The maintainer wanted updates from the day the repository goes public.
Players otherwise stay on whatever they first installed, since neither the DMG
nor the NSIS installer updates itself. The plugin knows each platform's install
step: replacing the app bundle on macOS, and handing over to the installer on
Windows. A signed version stops a tampered manifest from pairing a new version
number with an older release. Keeping the key out of the build jobs means
nothing compiled from a pull request's dependencies runs beside it. Named and
portable copies are for tests, agents, and USB sticks, where an update the
player didn't ask for would surprise. The plugin's reqwest client is the one
place outside `polymine-net`: wrapping it would mean writing the download,
signature, and install steps again, and it already uses rustls with ring and the
system's certificate verifier.

**Alternatives:** an update check through `polymine-net` that only links to the
release page, which leaves every install by hand; the plugin's JavaScript API,
which would give the webview a network permission; installing in the background
without asking; and giving the build jobs the signing key.
