---
name: polymine-cli
description: >-
  Plays and inspects games of Polymine, a Minesweeper-style game on 18 tilings,
  through polymine-cli. Covers the board, opening and flagging cells, the
  assistant's hints and steps, headless practice games, statistics, and gist
  sync. Use when the user asks to play Polymine or Minesweeper, to watch an
  agent play, to solve a board, to get a hint, or to check stats, champions, or
  game status, or mentions polymine-cli.
---

# polymine-cli

`polymine-cli` plays Polymine and prints JSON. It drives a running Polymine
window, where each move animates, or plays headless games of its own.
`polymine-cli describe` lists every command, flag, and code.

## Rules

1. **Say which target.** Without flags the CLI drives the default instance, or
   the one `POLYMINE_INSTANCE` names. `--instance <name>` picks another.
   `--local <name>` plays a headless game, with no app. `--local` overrides
   `POLYMINE_INSTANCE`, and `--instance` with `--local` is a usage error. The
   CLI never falls back to another target. `instances` deletes the entries of
   instances that no longer listen, so it changes state.
2. **Read before you click.** Never guess a cell id; take ids from `board`,
   `hint`, or a move's reply.
3. **Ask for less.** Play with
   `--fields status,counters,cells.id,cells.state,cells.number`, and fetch
   `cells.neighbors` once per game, since neighbors never change.
4. **Check the exit code.** Anything but 0 comes with a JSON error; see
   [Errors](#errors).
5. **Your games don't count as records.** In the app, every CLI move, `hint`,
   and `step` marks the game as assisted. Headless games keep no records.

## Start

```sh
polymine-cli status
polymine-cli new --tiling hexagon --level beginner  # --seed N replays a layout
polymine-cli board --fields mines,cells.id,cells.center,cells.neighbors
polymine-cli hint --fields cell
polymine-cli open <cell>
```

Before the first open, `hint` returns the center with `certain: true`. The first
open never hits a mine, and its neighbors stay clear when the board has room, so
it opens an area. `hint` and `step` reply `null` when the assistant has no move
left.

`new` without flags keeps the current tiling and level. Levels are `beginner`,
`amateur`, `professional`, and `crazy`. Tiling ids are camelCase;
`polymine-cli new --help` lists them.

The same flow headless:

```sh
polymine-cli --local practice new --tiling kite --seed 7
polymine-cli --local practice hint --fields cell
polymine-cli --local practice open <cell>
```

A headless name keeps its last saved game. A new name starts on `square` at
`beginner`.

`stats [--tiling <id>] [--level <level>]` reads statistics and champions. It
needs a running instance.

## Reading the board

- `state` is `closed`, `flagged`, `question`, `open`, and after a loss `mine`,
  `exploded`, or `wrongFlag`. Open cells carry `number`, the mines among their
  `neighbors`.
- Neighbors share an edge or a corner: 8 on squares, 6 on hexagons, 12 on
  triangles, and mixed elsewhere. Use the lists, not a grid.
- `center` is the cell's position in board units.
- `counters.minesLeft` is mines minus flags. `status` is `ready`, `playing`,
  `won`, or `lost`.

## Moves

```sh
polymine-cli open <cell> <cell>
polymine-cli flag <cell>
polymine-cli unflag <cell>
polymine-cli hint                 # the assistant's move, not played
polymine-cli step                 # the assistant plays one move
```

- A cell with no adjacent mines opens its whole area.
- `open` skips a flagged cell, so unflag it first.
- `open` on an open number chords it: if its flags match, its other neighbors
  open. A wrong flag there loses the game.
- Smart click is always on in headless games and follows the player's setting in
  the app. With it, a number you open or click flags the neighbors that must all
  be mines, so `open` can place flags.
- `flag` does nothing before the first open and replies `changed: false`.
- `unflag` also clears a `?`.
- Only opening every safe cell wins; flags never win on their own.
- A move resumes a paused game. A list stops at the move that ends the game.

A move replies with `changed`, the changed `cells`, `status`, and `counters`.
`step` wraps that reply as `move`, beside its `suggestion`.

`hint` replies with `action` (`open`, `flag`, or `unflag`), `cell`, `certain`,
`mineProbability`, and `exact`. Certain moves come first, including `unflag` for
a wrong flag. With `certain` false it's the safest guess, and `exact` is false
when the odds are estimated.

## Playing well

- A number equal to its unopened neighbors (`closed`, `flagged`, or `question`)
  means all are mines.
- A number equal to its flagged neighbors means the rest are safe.
- Compare numbers that share neighbors: the difference often settles a cell.

## Errors

Errors go to stderr as `{"error":{"code","message","hint"}}`, and `hint` is
optional.

| Exit | Code               | Next step                                        |
| ---- | ------------------ | ------------------------------------------------ |
| 1    | `invalid_cell`     | Take a real id from `board`                      |
| 1    | `not_playable`     | Start another game with `new`                    |
| 1    | `invalid_value`    | Bring the value into range                       |
| 1    | `version_mismatch` | Use the CLI that came with this Polymine         |
| 1    | `internal`         | Read `message`, then `log`                       |
| 2    | `usage`            | Fix the arguments or the missing setup           |
| 3    | `not_running`      | Ask the user to start Polymine, or use `--local` |
| 4    | `timeout`          | Read `board` before resending (below)            |
| 5    | `busy`             | Nothing was played; retry                        |

Missing setup is no headless game under that name, no log, no token, or `stats`
with `--local`.

A timed-out move may have landed, and `open` again on a cell that opened as a
number chords it. Raise `--timeout <ms>` (default 10000) on slow machines, and
check `log` if timeouts keep happening.

## Sync

`sync --gist <id>` shares ranked games through a GitHub gist. Run it only when
the user asks.

1. The user creates the gist first. The id is the last part of its URL.
2. It needs `POLYMINE_GITHUB_TOKEN` with the `gist` scope.
3. It reads the files itself, so the app needn't run, and `--local` doesn't
   apply. A running app shows the added games on its next start.
4. The reply counts `addedToGist` and `addedHere`.
5. A missing token or a malformed id exits 2. A network or GitHub failure exits
   1 with `internal`.

## AGENTS.md snippet

```text
Polymine is playable with `polymine-cli` (JSON output). Exit 3 means it isn't
running; use `--local <name>` for a headless game. Run `polymine-cli skill` for
the rules. Take cell ids from `board` or `hint`; never guess them.
```
