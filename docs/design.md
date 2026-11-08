# Polymine design

## Summary

Polymine is a spiritual successor to FastMines: minesweeper on many tilings,
with an assistant that can hint or play. It is a desktop app for Windows and
macOS. It has the classic levels, smart click, the assistant, statistics with a
champions table, built-in themes, themes players make, and a color filter for
color vision deficiency. The window looks native on each platform. It follows
the system's light or dark mode and uses Mica on Windows 11 and vibrancy on
macOS.

This file describes how Polymine works today. The reasons behind each choice are
in [decisions.md](decisions.md), and open work is in [todo.md](todo.md). An
[interactive diagram](architecture/overview.html) maps the parts and flows.

## Contents

1. [Goals](#goals)
2. [Non-goals for now](#non-goals-for-now)
3. [Stack](#stack)
4. [Engine](#engine): [tilings](#tilings-as-data),
   [levels](#levels-and-mine-density), [rules](#rules), and [solver](#solver)
5. [App shell](#app-shell): [session](#session-and-clock),
   [history](#history-and-statistics), [players](#players),
   [boards that fill the window](#boards-that-fill-the-window),
   [commands](#commands), [saved games](#saved-games), [settings](#settings),
   [logs](#logs), [folders](#data-and-runtime-folders), and
   [window state](#window-state)
6. [Command line](#command-line)
7. [Network](#network)
8. [Window and chrome](#window-and-chrome):
   [toolbar and menus](#toolbar-and-menus), [dialogs](#dialogs), and
   [Settings](#the-settings-dialog)
9. [Languages](#languages)
10. [Themes](#themes): [built-in themes](#built-in-themes),
    [readability](#readability), [color-only counts](#color-only-counts),
    [light on cells](#light-on-cells), [editor themes](#editor-themes),
    [the system accent](#the-system-accent),
    [see-through themes](#see-through-themes), [window icon](#window-icon), and
    [loading and checks](#loading-and-checks)
11. [Board rendering](#board-rendering)
12. [Input and accessibility](#input-and-accessibility)
13. [Licensing and clean room](#licensing-and-clean-room)

## Goals

1. Keep the FastMines gameplay: non-square tilings, preset and custom levels, a
   safe first click, flags and question marks, smart click, the assistant, and
   statistics with champions.
2. Look modern and native on Windows 11 and macOS, with tasteful animation.
3. Stay fast on large boards and quiet when idle.
4. Stay maintainable: a pure engine with heavy tests, a thin app shell, and
   typed contracts between Rust and TypeScript.
5. Release under MIT or Apache 2.0.

## Non-goals for now

1. The FastMines look and its skin format.
2. Importing FastMines save files, statistics, or skins.
3. Mobile and browser builds. The structure allows both later.

## Stack

| Layer         | Choice                               | Why                                                                     |
| ------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| Engine        | Rust library, `crates/polymine-core` | Fast solver, strong typing, compiles to WASM for a future browser build |
| Desktop shell | Tauri 2                              | Native window, menus, materials and dialogs; small installers           |
| UI            | Svelte 5, TypeScript, Vite           | Little boilerplate for a small UI                                       |
| Board         | PixiJS 8 (WebGL)                     | Smooth animation and particles for thousands of polygons                |
| Contracts     | `tauri-specta` generates TypeScript  | One source of truth for every type and command that crosses the bridge  |
| Network       | `ureq` and rustls in `polymine-net`  | A small blocking HTTPS client; the operating system checks certificates |

Game state lives in the Rust backend. Each click is one command that returns the
changed cells, so the UI holds no rules of its own.

## Engine

### Tilings as data

Polymine has 18 tilings. A tiling is a small patch of polygons repeated on a
rectangular lattice. Each polygon fills one logical slot, so a board of `cols` x
`rows` logical cells maps every cell to one polygon. Two cells are neighbors
when their polygons share an edge or a corner. The engine derives neighbor
offsets from the geometry once per tiling, so a new tiling needs only
coordinates.

Tests check every tiling for full coverage without overlaps, symmetric neighbor
links, and the expected neighbor counts. In the table, Tiling is the name the
picker shows and Id is what the CLI takes.
[Levels and mine density](#levels-and-mine-density) explains the complexity and
win rate columns.

| Tiling       | Id                      | Cells                                                | Neighbors | Complexity | Assistant wins |
| ------------ | ----------------------- | ---------------------------------------------------- | --------- | ---------- | -------------- |
| Squares      | `square`                | Unit squares                                         | 8         | 1          | 75%            |
| Bricks       | `offsetSquare`          | Rows of squares shifted half a square                | 6         | 1          | 80%            |
| Herringbone  | `herringbone`           | Two-by-one bricks in a zigzag, turned 45°            | 6         | 1          | 80%            |
| Pinwheel     | `pinwheel`              | Two-by-one bricks in pinwheels of four               | 7         | 3          | 45%            |
| Kites        | `kite`                  | 120-90-60-90 kites, six to a hexagon                 | 9         | 3          | 37%            |
| Trapezoids   | `trapezoid`             | Half hexagons in rows, alternating up and down       | 6         | 1          | 79%            |
| Spinners     | `trapezoidTriangle`     | Half hexagons in threes, turning inside triangles    | 8         | 3          | 38%            |
| Rings        | `trapezoidHexagon`      | Half hexagons in eights, filling larger hexagons     | 6 to 11   | 3          | 37%            |
| Triangles    | `triangle`              | Equilateral triangles                                | 12        | 1          | 82%            |
| Sawtooth     | `offsetTriangle`        | Rows of equilateral triangles, none flipped          | 8         | 1          | 91%            |
| Crosses      | `rightTriangle`         | Squares cut along both diagonals                     | 14        | 4          | 26%            |
| Shards       | `obtuseTriangle`        | 120° rhombuses cut along their long diagonal         | 12        | 1          | 75%            |
| Cairo        | `cairo`                 | Pentagons with angles 120, 120, 90, 120, and 90      | 7         | 2          | 60%            |
| Florets      | `floret`                | Pentagon type 5, six to a flower                     | 8         | 3          | 37%            |
| Hexagons     | `hexagon`               | Regular hexagons                                     | 6         | 1          | 79%            |
| Snub squares | `snubSquare`            | Squares and triangles, 3.3.4.3.4                     | 9 or 12   | 1          | 81%            |
| Bands        | `squareTriangle`        | Rows of squares between rows of triangles, 3.3.3.4.4 | 9 or 12   | 2          | 61%            |
| Rosettes     | `squareTriangleHexagon` | Hexagons joined by squares, 3.4.6.4                  | 6 to 12   | 5          | 16%            |

The 45° tilings are drawn unturned, where their lattice is easy to state, then
rotated. Herringbone and pinwheel lattices both become rectangles after the
turn.

A tiling with an oblique lattice, or with more than one shape, is described as a
motif and two lattice vectors. The catalog copies the motif along the lattice,
keeps every polygon whose center falls in the rectangular period, and sorts
those into logical rows. The pentagon florets are turned so one lattice vector
runs horizontally, which keeps their period at two flowers.

The Cairo tiling is built on a checkerboard of unit squares. Each square holds a
short segment through its center, horizontal or vertical by parity, with its
ends joined to the nearest corners. Every grid edge then gets one pentagon, made
of a trapezoid from one side and a triangle from the other.

### Levels and mine density

Presets match the square sizes of FastMines: Beginner 10 x 10, Amateur 20 x 15,
Professional 30 x 20, and Crazy 45 x 25. Other tilings get about the same cell
count and aspect ratio.

Difficulty comes from two sources:

1. The level sets the mine density, the same on every tiling: 13%, 16%, 19%, and
   23%.
2. The tiling's shape adds its own difficulty, rated from 1, which plays like
   squares, to 5.

The `complexity` example measures each rating. The assistant plays 400 Amateur
and 400 Professional games per tiling on the same seeds. Its mean win rate maps
to a rating in steps at 70%, 50%, 35%, and 20%, and those means are the tiling
table's win rates. The picker shows each rating as pips under the tiling's
thumbnail.

### Rules

1. Mines are placed on the first open, away from the clicked cell and its
   neighbors when the board has room. Games built from a fixed layout skip this
   protection.
2. Mines also stay off twin cells when the board has room. Twins are cells with
   exactly the same neighbors, counting each other when they touch, so no number
   tells them apart. Board edges create them on some tilings, such as kites at a
   corner.
3. Mine placement uses ChaCha8 seeded per game, so a seed always rebuilds the
   same board. Tests pin one seed's layout on a square Beginner board, a custom
   board with few mines, and a large sparse board. `rand` picks its sampling
   algorithm by those counts, so a dependency update that moves any layout fails
   a test.
4. Opening a cell with no adjacent mines floods outward. Each change carries its
   ring number so the UI can animate a ripple.
5. Right click cycles flag, question mark (optional), and clear. No mark can be
   set before the first open, by right click or by the assistant.
6. Smart click on an open number flags its closed neighbors when they must all
   be mines, then opens the rest once the flags match. The click that opens a
   number only flags: one click can open a number and flag the mines around it,
   but never opens its neighbors, so a wrong flag nearby can't lose it. With
   smart click off, a number opens its neighbors only when the flags already
   match.
7. Opening a mine loses and reveals every mine and wrong flag, ordered by
   distance from the explosion.
8. The game is won when every safe cell is open. Marks never win on their own,
   since flags on the mines would let a player settle any guess by trying
   layouts until one wins. A win flags every mine.

### Solver

The solver sees only open numbers, the total mine count, and whether the
placement kept mines off twin cells. That last fact follows from the board, the
first click, and the mine count, as rule 2 states, so a player can know it too.
It ignores marks.

1. When the placement kept twins clear, every closed twin starts out safe, and
   the mines spread over the other cells.
2. Local rules settle cells forced by one number, or by one number nested inside
   another.
3. The rest of the frontier splits into regions that share no numbers. Each
   region is enumerated exactly, counting solutions by mine count.
4. Regions combine with the free cells away from numbers, weighted by the ways
   to place the leftover mines. That gives exact probabilities and exact
   certainties. The weights stay in log space, since on large boards they span
   more than a float holds. Certainties come from which mine counts are
   possible, never from the size of a weight.
5. A region too large for the search budget is treated as unconstrained. Its
   certainties stay sound, and its probabilities become estimates. The budget
   covers a whole call, smallest regions first, so a large board stays fast. A
   guess from such a call has `exact` false, and the hint shows its odds as
   "about 23%".

The assistant first removes a flag from any cell it proves safe. It then opens
certain safe cells, flags certain mines, and opens the cell with the lowest mine
probability. When the player has flagged every uncertain cell, it removes the
flag least likely to sit on a mine.

Property tests play complete games on every tiling and check that no certain
move is ever wrong. On small boards they also compare every probability and
certainty with a brute force over all layouts the placement rules allow. On a
release build the solver wins about 96% of square Beginner games. On Crazy
boards its moves average 0.3 to 37 ms, depending on the tiling, and the slowest
single move takes about half a second.

## App shell

`src-tauri` holds the current session (game, clock, pause state, and whether the
assistant helped), the settings, the game history, named saves, and the player
themes folder.

### Session and clock

The clock starts on the first open and stops on pause and at the end. At startup
the shell applies the window material (Mica or vibrancy) and tells the UI
through `get_environment` whether it took, so the UI knows whether it may paint
a transparent background.

### History and statistics

1. Each finished game appends one JSON line to `history.jsonl`. A game left
   unfinished, by a new game or by closing the window, leaves no record. A
   record that fails to write stays in memory, and the next append or save
   writes it. A file that can't be read at startup still gets the session's
   games, and each append tries to read it again.
2. Loading streams the file, skips lines that aren't valid JSON or UTF-8, and
   keeps only ranked records in memory, each repeated line once. Statistics and
   champions are computed from those on demand, so new views never need a
   migration.
3. Unranked records are only counted. They are assisted and custom games, plus
   the abandoned games older files hold. Once the file holds 3,000 of them, it
   is rewritten with every ranked record, every line this build can't read, and
   the newest 2,000 unranked records. The rewrite goes to a temporary file that
   is synced and renamed over the old one, so a crash leaves one whole file or
   the other. Appends and the rewrite take a lock in `history.jsonl.lock`, as
   `polymine-cli sync` does, so a rewrite never drops a line synced meanwhile.
4. Assisted games and custom levels don't count toward statistics or champions.
   Average time and clicks count wins only; the share of the board opened counts
   every game. A win that enters the champions table opens the table once the
   win animation ends, on that board, with the new row marked.

### Players

Players are profiles that hold only a name. Settings keep the list in `profiles`
and the active player in `playerName`, which names every record. The shell trims
the names, drops blank and repeated ones, and adds the active name when it's
missing, so settings with no list get a list of one. Removing a player keeps
their games in the history.

Stats opens on the active player, with "All players" beside it. A new record
opens it on all players, since its rank counts everyone. `polymine-cli stats`
counts every player.

### Boards that fill the window

Boards sized to fill the window are custom games. The Fill window button in the
custom level dialog and the "Size custom games to fill the window" setting both
make them. `Board::fit` finds the largest columns and rows whose real bounds fit
the board area when the smallest cell's inradius is 12 px. The mine count keeps
the custom level's density. With the setting on, a custom game nobody has
touched yet follows the window once it stays one size for 400 ms.

### Commands

The shell's logic lives in `src-tauri/src/app.rs`, a plain struct that tests
drive directly. `commands.rs` wraps it as Tauri commands. `get_environment`,
`get_accent`, and `window_in_front` live in `environment.rs`, `accent.rs`, and
`foreground.rs`, since they read the platform rather than the session.

Commands that can take long on a big board, such as moves, hints, new games, and
snapshots, run on Tauri's thread pool instead of the main thread, so the window
stays responsive. The UI queues its game calls, so they land in order.

### Saved games

1. An unfinished game is saved to `game.json` in the data folder as its
   configuration, seed, starting rules, moves, elapsed time, and whether it was
   helped. A rules change mid-game is logged among the moves, so each move
   replays under the rules it was played with. Mines come from the seed, so
   replaying the moves rebuilds the board exactly.
2. The game saves on pause, on exit, and every 5 seconds when moves happened in
   between. The same thread ticks every second and compares the wall clock with
   the monotonic clock. A gap of 10 seconds or more means the computer slept,
   and a game in play pauses as of the tick before, so time asleep never counts
   on either platform.
3. A fresh or finished game removes the file. The next start restores the game
   paused, and drops a save it can't replay.
4. Named saves keep games under a name in a `saves` folder beside `game.json`,
   each in the same format, through `src-tauri/src/saves.rs`. A name must make a
   file name on every platform, up to 40 characters. Loading one replaces the
   game in play, paused, and marks it assisted, so it never ranks
   ([decision 21](decisions.md#21-a-loaded-named-save-counts-as-assisted)).

### Settings

Without a settings file, the shell saves the defaults. About opens only when the
player asks for it. Settings save as JSON through a temporary file and a rename.
The theme is stored by id, and the UI falls back to its default for an unknown
id.

On load, a value the build doesn't understand takes its field's default while
the other fields load, and a copy of the file goes to `settings.json.bad`. A
file that isn't JSON moves there, and the defaults replace it.

### Logs

Logs go through `log` and `tauri-plugin-log` to stdout and the log folder. A
panic hook logs each panic with its place and a backtrace, since release builds
on Windows have no console. A panic in an autosave round is logged, and the next
round runs as usual.

The UI's console warnings and errors, uncaught errors, and unhandled promise
rejections go to the same log through `@tauri-apps/plugin-log`, from
`ui/src/lib/log.ts`. The console still shows them, and a failed log call is
dropped.

### Data and runtime folders

The player's files live in a `Polymine` folder: settings, `history.jsonl`, the
saved `game.json`, `window.json`, and the `saves` and `themes` folders. Files
that matter only while the app runs, the logs, and the WebView cache keep the
app identifier `dev.uvw.polymine` as their folder name
([decision 30](decisions.md#30-player-data-lives-in-a-polymine-folder)).

| Folder      | Windows                                | macOS                                            |
| ----------- | -------------------------------------- | ------------------------------------------------ |
| Data        | `%APPDATA%\Polymine`                   | `~/Library/Application Support/Polymine`         |
| Runtime     | `%LOCALAPPDATA%\dev.uvw.polymine`      | `~/Library/Application Support/dev.uvw.polymine` |
| Logs        | `%LOCALAPPDATA%\dev.uvw.polymine\logs` | `~/Library/Logs/dev.uvw.polymine`                |
| CLI sockets | A named pipe, no folder                | `/tmp/polymine-<uid>`                            |

1. The runtime folder holds the `instances` registry and the CLI's headless
   `games`.
2. A named instance keeps its settings and history in `instances/<name>` under
   the data folder.
3. `POLYMINE_DATA_DIR`, or a file named `portable` next to the executable, puts
   everything in one folder instead: settings, history, the saved game, named
   saves, player themes, `logs`, and the CLI's headless games. A portable copy
   uses a `data` folder beside the executable and doesn't save the window
   position. Releases ship a portable Windows ZIP with that marker.
4. A portable copy takes a short tag of its data folder's path into its socket
   name and registry entry, so it runs beside an installed copy, and the CLI
   shipped beside each copy finds its own. An instance with a folder of its own,
   portable or under `POLYMINE_DATA_DIR`, also skips the one-per-user lock that
   brings the installed window forward on a second launch.
5. The webview's data stays in Tauri's default folder only for the player's own
   instance. A copy with a folder of its own keeps it in `webview/<instance>`
   there, and a named instance in `webview/<name>` under the runtime folder,
   since WebView2 refuses to share one folder between instances started with
   different browser options.
6. Sockets live in `/tmp/polymine-<uid>`, since a socket path under a long home
   folder overflows the 104 bytes macOS allows.
7. On Windows, the NSIS uninstaller also removes `%APPDATA%\Polymine` when the
   player ticks "Delete the application data", through
   `src-tauri/windows/hooks.nsh`. An update keeps it.

### Window state

`window.json` holds the window's size, position, and maximized state. The shell
notes them whenever the window moves or resizes. It saves them when the window
closes or the app quits, since Cmd+Q, the Quit menu, and a system shutdown never
close the window first.

1. macOS saves the bounds in points, so they hold across displays of different
   scale. Windows saves physical pixels.
2. The window starts hidden and shows once that state is applied, so it doesn't
   jump. A saved position that isn't on any monitor is skipped.
3. Decorations aren't part of the state; they come from the platform config.
4. `tauri-plugin-single-instance` focuses the running window on a second launch.

## Command line

`polymine-cli` is a console program of its own, because the app is a GUI program
on Windows and can't reliably write to a terminal. It drives a running instance
over a local socket, or plays headless games that replay from a seed. Every
launch of the app is an instance, `default` unless named, and named instances
keep their own data. A debug build, such as `npm run app`, is the `dev` instance
unless named, so development never touches the player's own data.
[CLI.md](CLI.md) describes the commands, instances, the protocol, the output
contract, exit codes, and how `sync` shares a history through a GitHub gist.

The window hears about CLI moves through an event sent outside the game lock, so
events can arrive out of order. Every action result and snapshot carries a
`revision` that grows with each change, across new games too. The window drops
an update older than one it has shown and reloads the board from a snapshot
instead.

## Network

`crates/polymine-net` makes every network request, and it has no Tauri
dependency. `polymine-cli sync` uses it. `src-tauri` doesn't depend on it, so
the app itself makes no requests.

1. A `Client` sends each request under a `Policy` the caller builds:
   1. The allowed hosts.
   2. A connect timeout, 10 seconds.
   3. A total timeout that covers redirects and the body, 30 seconds.
   4. A response cap, 4 MiB.
   5. A redirect limit, five.

   It refuses anything but HTTPS on port 443 to a listed host, and any URL with
   credentials in it. Redirects are followed by hand, for GET only, and each hop
   meets the same checks. A bearer token goes to the first origin only.

2. Requests carry `User-Agent: Polymine/<version>` and nothing about the player
   or the machine. The client keeps no cookies and reads no proxy from the
   environment. TLS is rustls with the system's certificate verifier.
3. Failures map to one `Error` enum: offline, timeout, not allowed, too large,
   rate limited (with the wait GitHub asked for), HTTP status, bad response,
   invalid URL, refused content, and disk errors.
4. A `Cache` keeps GET responses in a folder the caller names. It stores one
   file per URL and `Accept` header, named by a hash of both. Every hit is
   revalidated with `If-None-Match` or `If-Modified-Since`, so a 304 serves the
   stored body and nothing stale is served. Writes go through a synced temporary
   file and a rename. Past the size bound, the least recently used entries go.
5. `GitHub` downloads a repository folder or a gist:
   1. A repository download pins the branch or tag to a commit, lists the folder
      through the git trees API, and fetches each file from
      `raw.githubusercontent.com` at that commit.
   2. The caller's `Limits` set the file count, the per-file and total size, the
      folder depth, and the allowed names. Other names are skipped and reported.
   3. Symlinks, submodules, paths with `..`, and names Windows can't hold are
      refused.
   4. Files land in a hidden folder beside the target. It takes the target's
      name once complete and is removed on failure.
   5. A token goes to `api.github.com` and `raw.githubusercontent.com` only. The
      caller passes it in; the crate never reads one from the environment.
6. `JsonApi` sends typed GET, POST, and PATCH requests under one base URL, with
   an optional bearer token. Gist sync uses it, and a leaderboard can.
7. The client blocks, so callers run it on a worker thread.

Tests talk to a loopback HTTP server with GitHub-shaped fixtures. `polymine-cli`
tests `sync` against the same server through the crate's `test-support` feature.
Plain HTTP to a loopback address is a policy switch that exists only in test
builds, so no test touches the real network and no release build can turn it on.

## Window and chrome

The window is transparent so the system material shows through. Chrome colors
are CSS tokens built with `light-dark()`, so they follow the OS setting. When no
material is available (Windows 10, Linux), the UI paints an opaque window color
instead.

| Area          | Windows 11                                       | macOS                                            |
| ------------- | ------------------------------------------------ | ------------------------------------------------ |
| Material      | Mica                                             | `sidebar` vibrancy                               |
| Title bar     | None: the toolbar draws the caption buttons      | Overlay: traffic lights sit in the 40 px toolbar |
| Menus         | No menu bar; the toolbar's overflow menu         | Full native menu bar, with Edit and Window menus |
| Controls      | 32 px, 4 px radius, Segoe UI Variable Text 14 px | 28 px, 6 px radius, system font 13 px            |
| Accent        | `#005FB8` light, `#60CDFF` dark                  | `#007AFF` light, `#0A84FF` dark                  |
| Dialog footer | Stretched buttons, primary first                 | Right-aligned, primary last                      |

### Toolbar and menus

The toolbar is 40 px tall on both platforms. From left to right it holds:

1. The tiling and level picker.
2. Mines left and the clock, as figures with icons instead of captions.
3. Icon buttons for Hint and Bot.
4. An overflow menu, which also lists New game and, once there are two players,
   picks the player.

Labels live in tooltips and in what screen readers announce.

The figures are buttons. Mines left starts a new game, and the clock pauses and
resumes. On hover or focus, a figure's icon swaps for a glyph of its action:
restart on mines left, pause on the clock. While paused, the clock shows a play
glyph in the accent color. The highlight hugs the glyph and number, while the
figure keeps its width as digits change. Screen readers hear the action, then
the figure. Before the first open, the clock is a plain figure.

When a game ends, the result replaces the figures in the toolbar's center, so
nothing covers the board. The result is the New game button for that moment,
with a restart icon on an accent square at its end.

The "Hide the toolbar until the pointer reaches the top" setting slides the
toolbar up and gives the board the window, leaving a 6 px strip. Hovering or
focusing the strip brings the toolbar back, so the window still drags and the
caption buttons stay in reach. While paused, dots in the accent color drift
slowly behind the pause card, and stand still with Reduce Motion.

On macOS and Windows the toolbar is the title bar. The window drags from
anywhere between the controls, and a double-click maximizes it. On Windows:

1. `tauri.windows.conf.json` makes the window frameless and keeps its shadow.
2. The toolbar draws the caption buttons at Windows 11 size, 46 px wide and
   flush with the corner.
3. The window still resizes from the invisible border outside its edges, as
   native windows do.
4. The window loses only the maximize button's Snap Layouts flyout.

The macOS menu bar lists the single-key shortcuts beside their items: Pause or
resume (P) in the Game menu, and Hint (H) and Let the bot play (B) in the Bot
menu. One press can reach both the menu and the window's keydown handler, so
each of these actions ignores a second call within 200 ms.

The picker shows the levels as tiles of one to four mines, plus Custom, above
the tilings. Each tiling is a thumbnail in the active theme's colors, six to a
row: closed cells on the open color, with edges in the board plate's color.
Where the plate sits within 3:1 of the closed cells, as in the editor themes,
the edges take the first count's color, which is the keyword color in an editor
theme. Failing that, they take the focus color.

The shell sends a small board of every tiling once at startup, and the thumbnail
crops to its middle, where the pattern is complete. Pips under each thumbnail
show the tiling's complexity, and screen readers hear it as the tile's
description. Arrow keys move through the thumbnails by row and column. Stats
filters by tiling with the same grid.

Menus open in the browser's top layer, so a dialog's scrolling body never clips
them.

### Dialogs

A dialog is a native modal `<dialog>` that fills the window and draws the
backdrop, with the visible box centered inside it below the title bar. The rest
of the page goes inert, so on macOS and Windows the dialog stands in for the
title bar while it's open.

1. The `<dialog>`, which covers the backdrop and the toolbar strip, and the
   dialog's title carry `data-tauri-drag-region`. It drags the window from the
   element itself and not from its children, so the dialog's controls keep
   working.
2. A double-click there maximizes the window, as on the toolbar. Clicking the
   backdrop doesn't close the dialog.
3. On Windows the dialog draws its own caption buttons over the toolbar's, after
   its content in tab order. The macOS traffic lights sit above the page and
   need nothing.

The Saves dialog opens from the toolbar's overflow menu and the macOS Game menu,
or with Ctrl+S on Windows and Linux and Cmd+S on macOS.

1. A name field and a Save button keep the game in play. Only a game in play can
   be saved, so the field is off before the first open and after the end.
2. The field checks the name as the shell will (`ui/src/lib/saves.ts`) and says
   what's wrong with it. A name already taken, in any case, turns Save into
   Replace.
3. Each save in the list shows its tiling's thumbnail, drawn like the tiling
   picker's, with its tiling, level, time played, and when it was saved.
4. Load replaces the game and closes the dialog. Delete asks again in the row
   before it removes the file.
5. A note above the list says a loaded game counts as assisted.

### The Settings dialog

Settings is a fixed-size dialog, up to 900 by 700 pixels, with a sidebar of
three sections: General, Themes, and Bot. General holds the player picker with
Add and Remove, the active player's name, and the language, then the Rules and
Window groups. The sidebar names the section, so the pane starts with its
settings. Only the section's pane scrolls. General and Bot fit without scrolling
at the window's 800 by 600 minimum on macOS. The sidebar is a vertical tab list:
arrow keys, Home, and End move between sections, and the dialog reopens on the
last one.

On/off settings are switches in rows, label left and switch right, with one line
of help where a rule needs it. The color filter, the idle action, and the
language are drop-downs. macOS groups rows in one inset box with hairline
dividers; Windows draws each row as its own card with a Fluent toggle. Changes
apply as they're made, and a language change reloads the window.

### The Themes page

Themes starts with the accent tint switch and the color filter, side by side,
since both change every preview below. Then it lists every theme in one scroll,
in sections that each show their count ([decision 53][decision-53]):

1. Signature, for Polymine's own looks.
2. Code, for the themes that take an editor's color scheme.
3. Custom, for the player's themes, shown only when the themes folder holds one.

[decision-53]:
  decisions.md#53-themes-get-a-page-of-their-own-in-sections-by-where-they-come-from

The Code section sets each dark theme over its light one in four columns, and
the pairs past the fourth start a new pair of rows ([decision 54][decision-54]).
`EDITOR_COLUMNS` in `builtin.ts` lists the pairs, and `editorPlacement` gives
each card its row and column. A filter drops the placement, so the cards that
match close up.

[decision-54]:
  decisions.md#54-the-code-section-sets-a-dark-theme-over-a-light-one-in-each-column

Above the sections:

1. A search field matches every word typed against each theme's name,
   description, and author.
2. Chips pick a source: All, Signature, Code, Custom, or Favorites. Two more
   pick a mode, Light or Dark, and a theme that follows the system matches
   either.
3. Surprise me chooses a random theme, other than the current one, from those
   showing.

A Recent row shows the last five themes chosen, newest first. The shell records
them when the theme changes, and the row hides while a search or a chip is on. A
search that matches nothing says so.

Each theme is a card in a four-column grid. The card draws a small hex board in
the theme's colors, with its glyphs, font, glare, and shade, and its name and
description below. The board takes the accent while the tint switch is on, and
goes through the chosen color filter, as the real board does. A player theme's
`preview.png` replaces the drawn board, and its glyphs load when the page opens.
A star on each card adds the theme to the favorites. Cards out of view skip
layout and painting, so the grid stays quick at any length.

Resting the pointer on a card for 300 ms, or reaching it by keyboard, tries the
theme on: the board and the window behind Settings show it without choosing it.
Leaving the cards, pressing Escape, or closing Settings puts the chosen theme
back. Clicking a card chooses it. Arrow keys move between the cards and try each
one on without choosing it, unlike a plain radio group, so a player can look
through the themes from the keyboard; Space or Enter chooses.

A theme's name, description, and author show in a flyout with an arrow. It opens
after the pointer rests on the theme's card for half a second, or at once on
keyboard focus.

1. The flyout opens below the card, or above it when only that side has room,
   and stays inside the dialog.
2. It is a Fluent tooltip on Windows and an AppKit popover on macOS.
3. The pointer can move onto it, and Escape closes it before the dialog.
4. Each theme's radio takes its name as its accessible name and the flyout's
   description line as its accessible description.

New theme each game, at the bottom of the page, can switch themes for every new
game, the bot's included: Off, From favorites, or From all themes. Favorites
need two or more to rotate, or every theme takes part. An Open themes folder
link beside it opens the folder in Finder or Explorer. Themes that didn't load
are listed below with the reason.

## Languages

Every UI string comes from `t()` in `ui/src/lib/i18n`, and every `<code>.json`
file there is a language, named by its own `language.name` key. The Language
setting is `system` or a code. `system` takes the first of the browser's
preferred languages that has a file, by full tag and then by base language.
English is the fallback for any key a file lacks.

Strings already on screen don't switch, so `main.ts` sets the language before
the app mounts, and changing it reloads the window. Tests keep literal text out
of components and every key the code asks for in `en.json`.

## Themes

A theme is a folder with a `theme.css` of CSS custom properties, plus optional
SVG files for the mine, the flag, the question mark, and each number, and an
optional `preview.png`. The variables set:

1. The board's colors, shapes, and font, and the number style.
2. The window material, and whether the theme follows the system's light or dark
   mode.
3. The light on cells.
4. For a fixed look, the window chrome tokens.

Players add folders to the `themes` folder in their data folder.
[Creating a theme](themes/creating-a-theme.md) lists every variable for players,
and [How theming works](themes/how-theming-works.md) covers the code.

### Built-in themes

Polymine has 31 built-in themes, folders in `ui/src/themes` read at build time.
Experimental themes are folders there too, named in `EXPERIMENTAL_THEMES`. Only
development builds, and release builds made with `VITE_EXPERIMENTS=1`, list
them, after the rest, and the theme tests skip them ([decision
41][decision-41]).

[decision-41]:
  decisions.md#41-experimental-themes-show-only-in-development-builds

| Theme            | Chrome                                        | Board                                                       |
| ---------------- | --------------------------------------------- | ----------------------------------------------------------- |
| Frost, default   | System, with a light Acrylic or vibrancy      | Faint glass cells over the blurred desktop                  |
| Glossy           | System: follows light or dark mode            | Glazed tiles in the accent, with a glare and a rim light    |
| Glass            | System, with a light Acrylic or vibrancy      | Clear glass cells with a bright glare and an accent rim     |
| Graphite         | System: follows light or dark mode            | Recessed graphite tray, color-blind-checked numbers         |
| Datum            | Always black, with a faint grid               | Black and paper white, dot-matrix digits with a slipped row |
| Swatch           | System: follows light or dark mode            | Flat tiles in the system accent itself, classic digits      |
| Pride            | System: follows light or dark mode            | Indigo tiles; open cells show counts as rainbow fills       |
| Spectrum         | System: follows light or dark mode            | Slate tiles; fills in spectrum order, red to violet         |
| Midnight         | Always dark navy with glows and gradients     | The game's first look, deep navy with neon numbers          |
| Elevation        | Always pale mint with gray planes             | Gray planes, black block digits in an oblique extrusion     |
| Facet            | Always white                                  | Teal chrome tiles with a hard glare, a chrome-shard mine    |
| Quanta           | Always electric blue                          | Deep blue wells, pale monospace digits, barcode flags       |
| Loop             | Follows the mode: flat dark or light gray     | Flat gray, hot or acid digits, a twisted ribbon mine        |
| Umbra            | Always charcoal                               | Black block tiles, black block digits with gray gaps        |
| Deboss           | Always khaki card                             | Pressed khaki, inked deboss digits, black label marks       |
| Interference     | Always pale blue paper                        | Hairline-filled digits that shimmer into moiré              |
| Diode            | Always dark, with a magenta and cyan wash     | Unlit LED lenses, glowing lamp-matrix digits                |
| Rupture          | Always black with scanlines                   | Steel tiles, sliced digits with split color ghosts          |
| Corrode          | Always grimy dark under scanlines             | Worn tiles, warped and grain-eaten smeared digits           |
| Atom One Dark    | Always One Dark's tab-bar slate, blue buttons | Border-color pits, purple-first syntax digits, an atom      |
| Dracula          | Always Dracula purple-gray, purple-to-pink    | Darkest-panel pits, pink-first candy digits, a bat mine     |
| GitHub Dark      | Always inky canvas, green buttons             | Inset-canvas wells, red-first code-review digits            |
| One Dark Pro     | Always flat slate, gray buttons               | Sidebar pits, purple-first Vivid digits, a breakpoint flag  |
| Monokai          | Always warm charcoal with a neon glow         | Tray-color pits, pink-first 2006 neon digits                |
| Solarized Dark   | Always base03 teal                            | Base02 tiles, green-first Solarized accents, a sun mine     |
| Atom One Light   | Always pale gray, blue buttons                | Pale pane tiles, purple-first One Light digits, an atom     |
| Alucard          | Always Alucard cream, purple-to-pink          | Panel tiles, pink-first deep candy digits, a bat mine       |
| GitHub Light     | Always white, green buttons                   | Pale inset tiles, red-first review digits                   |
| Catppuccin Latte | Always Latte mantle, mauve buttons            | Crust tiles, mauve-first Latte accents, paw flags           |
| Monokai Light    | Always Monokai's foreground, pink buttons     | Tray tiles, pink-first deepened 2006 digits                 |
| Solarized Light  | Always base3 cream                            | Base2 tiles, green-first Solarized accents, a sun mine      |

### Readability

Tests check every built-in theme in light and dark mode, without an accent and
with each of 20 macOS and Windows accents. They hold digits, cells, and marks to
contrast bars, and count colors to a separation under color vision deficiency. A
theme can relax a check only for a look kept on purpose.
[How theming works](themes/how-theming-works.md#tests) owns the bars and the
relaxations, and
[decision 42](decisions.md#42-theme-tests-hold-every-built-in-theme-to-readability-bars)
records why each theme relaxes what it does.

A color filter in Themes remaps any theme's board colors for deuteranopia,
protanopia, or tritanopia. It is off by default. It moves the colors a player
must tell apart until each pair clears the theme tests' bar under that
deficiency, and leaves a board that already passes exactly as it is. SVG glyphs
get an error-shifting daltonization per pixel. Window chrome and `preview.png`
stay as they are. [How theming works](themes/how-theming-works.md#color-filters)
describes the pairs, the bars, and the solver.

### Color-only counts

Pride and Spectrum show counts as colors instead of digits. Pride runs cool to
hot, and Spectrum red to violet, each with white for 8. Counts 9 to 14 are rings
in the colors of 1 to 6: the color fills a band inside the cell's edge and the
middle stays open, which reads on every cell shape.

A key under the board shows each count the board can reach, one to 14 on
Crosses, and never covers a cell. The cell under the pointer or the keyboard
focus shows its count as a digit, and its chip in the key lights up.

### Light on cells

A theme can light its cells from one direction. Every layer is off unless the
theme sets it:

1. A glare covers the part of a closed cell nearest the light, cut straight,
   bowed like a dome, or round.
2. A rim light runs inside the edges that face a second angle.
3. A shade rounds closed cells off away from the light and sinks open cells
   under it.
4. A glint can sweep a closed cell under the pointer, except with Reduce Motion
   on.
5. Digits can cast a soft shadow.

Glossy, the solid counterpart to Frost's glass, uses every layer. Its tiles are
glazed in the accent, deep in light mode and light in dark mode, so every accent
from yellow to dark gray keeps 3:1 against the floor with the shade included.
Glass puts the glare and an accent rim on Frost's see-through cells. It has no
shade, since a shade mixes into the cell's fill and fades with it.

### Editor themes

Twelve themes borrow the palettes of popular code editor color schemes:

1. Atom One Dark and Atom One Light.
2. One Dark Pro, in its Flat look with its Vivid syntax colors.
3. Dracula and its light theme, Alucard.
4. The original 2006 Monokai, and Monokai Light, Polymine's own light variant
   with Monokai's foreground as its background.
5. GitHub Dark and GitHub Light, after GitHub's Dark Default and Light Default.
6. Solarized Dark and Solarized Light.
7. Catppuccin Latte.

Each header credits the scheme's author and names its source in a `Source:`
line, and the third-party notices carry each palette's license. Each theme fixes
its mode and paints an opaque window with chrome tokens from the editor's UI
colors. Most draw digits in a monospace font; Catppuccin Latte uses a rounded
one.

The number colors follow the scheme's syntax tokens in a shared order, the
keyword color first. The board parts closed from open cells the way the editor
parts its panes, as
[How theming works](themes/how-theming-works.md#adding-an-editor-theme)
describes. Where an official color misses a test bar, it moves in OKLab
lightness only, by a small step that clears the bar, and its `theme.css` names
the original and the color used. The light schemes' accents mostly miss 4.5:1 on
their own backgrounds, so they move most. A scheme with fewer than 12 usable
colors mixes a syntax color half and half with its text or darkest color for the
rest.

Settings that name an older id, such as `velvet`, open the theme it maps to, and
a player's folder can't take one of those ids.

### The system accent

A theme can take the system accent color, and every shipping built-in theme
does. The shell reads it natively, through `UISettings` on Windows and
`NSColor.controlAccentColor` on macOS, since CSS `AccentColor` returns only
Chromium's default. It comes with `get_environment`, and `get_accent` reads it
again whenever the window regains focus.

Themes see it as `--system-accent`, set only while the "Tint the theme with the
system accent color" setting is on. Each theme mixes it in with `color-mix()`
where its look wants it, and its `theme.css` says how much. The editor themes
mix it only into the closed-cell hover, so each scheme keeps its own colors.
Every theme leaves the numbers alone. When a theme sets no `--accent` of its
own, the accent also replaces the chrome's `--accent` tokens, with black or
white text by contrast.

Swatch fills closed cells with the system accent, flat and with a 3 px gap, on a
pale floor in light mode and a dark one in dark mode. Its white flag with a dark
edge clears 4.5:1 on any accent. Its digits take the classic minesweeper hues in
light mode and Graphite's in dark mode.

### See-through themes

Frost and Glass ask the shell for a blurring window material: a lightly tinted
Acrylic on Windows and the under-window vibrancy on macOS, the clearest material
AppKit has. Every other theme gets the default Mica or sidebar material back. A
bright desktop behind the window can wash out the numbers. Cells can't blur on
their own, because a canvas can't sample what's behind the window.

Board colors are opaque. See-through layers come from three opacities, for the
plate, closed cells, and open cells, so mixing in the accent never changes how
see-through a layer is. Each layer of light (the glare, glint, rim, shades, and
digit shadow) has its own opacity too. The sheen is the one board color with
alpha.

### Window icon

The app icon in `ui/public/icon.svg` is a steel mine on a dark plate with a
faint triangle lattice. `scripts/app-icon.mjs` turns it into the installer,
executable, and bundle icons, with `ui/public/icon-small.svg`, four thick spikes
and no shading, in the `.ico`'s 16 and 24 pixel images.

While Polymine runs, `ui/src/lib/themes/icon.ts` draws the same mine, without
the lattice, in the active theme's colors. The window shows it through Tauri's
`setIcon`. The plate follows the mode: a dark board's plate turns light in light
mode, and a light one turns dark in dark mode. A theme can set the `--icon-*`
variables to choose the colors. macOS has no window icon, so its Dock keeps the
static one. [docs/icons](icons/README.md) holds the concept sheets.

### Loading and checks

The UI resolves a theme's variables itself where it can, and on a hidden element
in an empty frame otherwise. So `color-mix()`, `light-dark()`, and any CSS color
work, while a theme sees only its own variables. Chrome tokens go on `<html>` as
inline properties; no theme file becomes a stylesheet.

Player themes are untrusted. `polymine-ipc` checks each folder before the UI
sees it: only known file names, no links or subfolders, and size limits per file
and per folder. SVG files load only as images, which can't run scripts or fetch
anything. A folder that breaks a rule, or a `theme.css` that breaks the format,
is skipped with its reason in Settings and the log. A built-in id wins over a
player folder with the same name. Polymine reads the folder at startup, when
Settings opens, and when the window comes to the front.

## Board rendering

1. On a new game, Rust sends every cell's polygon and neighbors once. Each
   action then returns only the changed cells.
2. Cells are Pixi `Graphics` objects that share one `GraphicsContext` per shape
   and state, so a board draws a few dozen shapes however many cells it has. A
   theme's light on cells comes from one shared gradient texture, laid across
   each shape by a matrix, so lit cells stay in the same batches. Each shared
   drawing sets `batchMode` to `batch`, since Pixi otherwise draws a shape of
   200 or more vertices on its own, one draw call per cell.
3. Cells sit in render groups of 1,024. Pixi batches a group again whenever one
   of its cells changes its drawing, so a hover on a 200 by 200 board batches
   one group, about 3 ms, instead of the whole board. A rebuild frees the shared
   drawings before the cells: a drawing drops all its listeners at once, while
   each cell freed first unsubscribes alone. Freed in that order, a theme switch
   on that board takes about half a second.
4. Pixi's ticker runs only while something moves. It stops a few frames after
   the last animation, hover, or pan, so an idle board costs no CPU or GPU. A
   hint ring pulses three times over 3 seconds, then holds steady so the ticker
   can stop.
5. Cells shrink to fit the window down to a 5 px inradius. A board that would
   need smaller cells scrolls instead, with Shift and the wheel or a
   middle-button drag.
6. Zoom enlarges the cells from the fitted size up to a 64 px inradius, keeping
   the middle of the view in place.
7. With reduced motion on, cells fade in over 120 ms, and the shake, glow,
   particles, confetti, entrance ripple, hint pulse, and glint are skipped.
8. A theme's `--board-effects` names GPU shaders that ship with the app
   ([decision 40](decisions.md#40-themes-never-carry-shader-code)). The
   `ferrofluid` effect, in `ui/src/lib/board/ferrofluid.ts`, turns closed cells
   into a pool of glossy black fluid that spikes toward the pointer. Open cells
   keep the theme's drawing as drained plates. Its own win and loss effects,
   timed in `ui/src/lib/board/splash.ts`, replace the sparks, the glow, and the
   confetti. [How theming works](themes/how-theming-works.md#board-effects)
   describes the shader.

## Input and accessibility

1. Mouse: left click opens or smart-clicks, right click marks, and dragging with
   the left button held moves the press. Shift and the wheel, or a middle-button
   drag, scroll a board larger than the window.
2. The wheel and a trackpad pinch over the board resize the window, in
   `ui/src/lib/windowZoom.ts`:
   1. The plain wheel, a two-finger trackpad swipe, and Ctrl with the wheel all
      count. WKWebView sends a pinch as WebKit `gesturechange` events with a
      scale. Chromium, and so WebView2, sends it as a wheel with Ctrl held,
      whose scale is `exp(-deltaY / 100)`. A Ctrl and mouse wheel notch is
      capped at about 20%. The plain wheel moves 10% per 100 px.
   2. Input adds up between animation frames, and one resize at a time goes to
      the window. A resize keeps the window's center and aspect ratio, measured
      from the frame when the input began, until the input pauses for 300 ms.
   3. Each side stops at its own limit: the 800 by 600 minimum, or the monitor's
      work area. Past the point where both sides stop, input is dropped, so
      turning back responds at once. A window that grows past a screen edge
      moves back inside it.
   4. Nothing happens while the window is maximized or fullscreen, or while a
      dialog is open. The webview's own page zoom stays off on both platforms.
   5. On Windows, a double click on the window's edge fits the window to the
      board, in `ui/src/lib/windowFit.ts`. A side edge sets the width the board
      has at the scale the height allows, and the top or bottom edge sets the
      height. A corner trims the room on both axes at the board's scale. Only
      the double-clicked edges move, within the same limits. The shell
      subclasses the window in `src-tauri/src/edge_fit.rs` to take
      `WM_NCLBUTTONDBLCLK` before Windows stretches the window to the screen's
      height, and sends the UI a `fit-window` event with the edge.
3. Right click anywhere on the field, gaps included, starts a new game once a
   game has ended, and resumes a paused game.
4. The game pauses when the window loses focus or minimizes, and when a dialog
   opens. Focus means the window's, so moving or resizing the window doesn't
   pause. On Windows, Tauri's focus events follow the webview, which a move or
   resize takes focus from. So the UI pauses only once `window_in_front` says
   another window is in front, and checks again every 300 ms until the page has
   focus back. Settings can turn off the pause on focus loss. The bot is never
   paused this way. New game on a paused game resumes it; picking a tiling or
   level still starts a new one.
5. Keyboard on the board: arrow keys or W, A, S, and D move to the neighbor
   nearest that direction on any tiling, Enter or Space opens, and F flags. The
   focus ring appears only for keyboard focus. A mouse or touch press hides it.
   The next key shows it again on the pressed cell, or in the middle after a
   press off every cell.
6. Touch: a tap opens, and holding a finger on a cell for 450 ms flags it. A
   finger that moves more than 10 px before the hold ends cancels it. Two
   fingers spreading or closing by a quarter take one zoom step.
7. Global keys come from `App.svelte` and, on macOS, the menu accelerators in
   `ui/src/lib/menu.ts`. The README's [Keys](../README.md#keys) table lists them
   for players. Dialog keys toggle, as in FastMines: pressed again inside their
   dialog, they close it. From inside another dialog they do nothing.
8. A click by the player stops autoplay. When the player is idle, the assistant
   can show a hint or take over and play; the idle time is set in Settings.
9. The window title shows Victory or Defeat after a game.
10. A polite live region announces the focused cell, hints, and the result.
11. The board is one `role="application"` widget with the role description
    "minefield" and a label that names its keys.

## Licensing and clean room

FastMines is GPL. Polymine ports behavior, never code. Geometry comes from the
math of each tiling, the level densities are Polymine's own, and all strings and
art are new. `cargo-deny` checks that dependencies stay permissive. The only
exception is MPL-2.0, which applies per file and which Tauri's HTML parsing
crates and `dirs` need.

The About window shows the licenses of everything that ships: the npm packages
that reach the UI bundle, the Rust crates in the app and the CLI, and the
palettes the editor themes borrow. `npm run notices` writes them to
`ui/src/lib/notices/THIRD-PARTY-NOTICES.txt` with cargo-about and the Vite
build's module list. CI fails when the committed file is out of date. Crates
that only other workspace members use stay out. Each MPL-2.0 entry says where
its source code is. The dialog loads the file as a separate chunk only when
asked.
