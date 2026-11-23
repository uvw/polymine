# polymine-cli

`polymine-cli` plays Polymine from a terminal and prints JSON. It drives a
running Polymine window, where every move animates, or plays headless games of
its own. Coding agents use it through the skill it prints with
`polymine-cli skill`.

## Putting it on PATH

The installers bundle `polymine-cli` with the app; the README's
[Command line](../README.md#command-line) section says where.

On Windows, the installer runs `polymine-cli link` to put the install folder on
the user's `PATH`. The uninstaller runs `polymine-cli unlink` to take it off,
and an update leaves it in place. `link` and `unlink` edit the user's `PATH` in
the registry and keep its type, so `%VARIABLES%` in it stay unexpanded. They
ignore `--dir` on Windows.

On macOS and Linux, `link` links the executable into `~/.local/bin`, or the
folder `--dir` names, and `unlink` removes that link. Its reply's `onPath` says
whether that folder is on `PATH` already. A stock macOS `PATH` lacks
`~/.local/bin`, so the reply then carries a `hint` with the line to add.

## Targets

| Flag                | Plays                                                 |
| ------------------- | ----------------------------------------------------- |
| none                | The default instance: Polymine as normally launched   |
| `--instance <NAME>` | A named instance, also set by `POLYMINE_INSTANCE`     |
| `--local <GAME>`    | A headless game saved under that name. No app needed. |

`--local` wins over an instance set only by `POLYMINE_INSTANCE`, while
`--instance` with `--local` is a usage error. The CLI never falls back from one
target to another. When the instance isn't running, it exits with code 3.

## Instances

Every launch is an instance. A normal launch is `default`. Starting the app with
`POLYMINE_INSTANCE=<name>`, or `--instance <name>`, starts a named instance that
runs beside the default one:

1. It keeps its settings and history in `instances/<name>` under the app's data
   folder, so it never touches the player's games.
2. `POLYMINE_DATA_DIR=<folder>` puts settings, history, logs, and the CLI's
   headless games in one folder instead, for tests that start from nothing.
3. On Windows and Linux its window title ends with the name in parentheses. It
   skips the saved window position, and its log is `Polymine-<name>.log`.
4. It registers itself in a per-user `instances` folder and removes the entry on
   exit. `polymine-cli instances` sends `status` to every registered instance
   and lists the ones that answer, with an `error` field for one that answered
   with an error. It deletes an entry only when nothing listens on its socket.

Names use 1 to 24 ASCII letters, digits, `-`, or `_`. A second copy of a named
instance exits at once.

## How it talks to the app

Each instance listens on a local socket:

1. On Windows, a named pipe called `dev.uvw.polymine.<SID>.<instance>` that only
   that user can open. The name is predictable, so the CLI opens the pipe for
   identification only, which never lets the server act as the caller, and
   refuses a pipe whose server runs as another account. Another account on the
   same machine can't open the pipe. If it takes the pipe's name first, the CLI
   refuses it, the player's own instance plays on without the CLI, and a named
   instance stops.
2. On macOS and Linux, `<instance>.sock` in the sockets folder that
   [design.md](design.md#data-and-runtime-folders) names. The app won't listen
   there, and the CLI won't connect there, unless only the user owns and can
   open the folder.

A portable copy adds a short tag of its data folder's path after `<instance>`,
as in `default.170b647e`. The CLI shipped beside it finds the same marker and
computes the same tag, so the copy beside it is the one it reaches.

A named instance whose socket fails to start logs the error and exits. The
default instance keeps running without the CLI.

Every call opens one connection, sends one JSON request line, reads one JSON
reply line, and exits. Nothing stays resident. `--timeout <ms>` sets how long
the CLI waits for the reply: 10000 ms by default, and never less than 100 ms.
The app reads at most 64 KiB per request and gives a client 5 seconds to send
it. It answers up to 16 requests at once and turns more away with a `busy`
error.

Requests carry a protocol version, and the app refuses other versions with
`version_mismatch`. It reads the version before the rest of the request, so a
request from another version gets `version_mismatch` even when its shape
changed. The app answers through the same code its window uses, then tells the
window what changed, so moves animate as if clicked.

A move is checked in the same order on the app and headless paths. A finished
game is `not_playable`, then an empty cell list is `usage`, then a cell off the
board is `invalid_cell`. The commands always send at least one cell, so only a
raw protocol request can get the `usage` error. Moves, hints, and steps from the
CLI mark the game as assisted, so it never enters the champions table. A move
resumes a paused game.

## Headless games

`--local <game>` saves a game as a small JSON file holding its configuration,
seed, and moves. Its name uses 1 to 32 ASCII letters, digits, `-`, or `_`. Every
call replays it on the engine, which is exact because mine placement is seeded.
The files live in a `games` folder in the runtime folder, in a portable copy's
`data` folder, or under `POLYMINE_DATA_DIR`;
[design.md](design.md#data-and-runtime-folders) gives the paths. Anyone who
reads a file can rebuild its mines from the seed, so headless games are for
practice and agents, not records.

## Commands

| Command                              | What it does                                        |
| ------------------------------------ | --------------------------------------------------- |
| `status`                             | The instance or game, its folders and game status   |
| `board`                              | Every cell: id, state, number, center and neighbors |
| `new [--tiling] [--level] [--seed]`  | Starts a game                                       |
| `open <cell>...`                     | Clicks cells: opens closed ones, chords numbers     |
| `flag <cell>...`, `unflag <cell>...` | Puts flags on or takes them off                     |
| `hint`                               | The assistant's next move, not played, or `null`    |
| `step`                               | The assistant plays one move, or replies `null`     |
| `stats [--tiling] [--level]`         | Statistics and champions, from a running instance   |
| `instances`                          | Running instances                                   |
| `paths`                              | The instance, its socket, log, and folders          |
| `link [--dir]`                       | Puts `polymine-cli` on `PATH`                       |
| `unlink [--dir]`                     | Takes it off `PATH` again                           |
| `sync --gist <id>`                   | Shares the history through a GitHub gist            |
| `log [--lines N]`                    | The end of an instance's log, 50 lines by default   |
| `describe`                           | Every command, flag, exit code and error code       |
| `skill`                              | The usage guide for coding agents                   |

`stats` defaults to the running game's tiling and level. For a custom game it
reads Beginner, since custom levels keep no statistics.

## Sharing history

`polymine-cli sync --gist <id>` shares an instance's ranked games through a
GitHub gist, so two machines end up with the same champions table. It reads the
gist's `history.jsonl` and adds the ranked games the gist lacks from the
instance's own. It appends the ranked games the instance lacked to its
`history.jsonl`. Assisted, custom, and abandoned games stay on their machine,
since statistics and champions never read them. A running app picks the added
games up on its next start.

Records merge by identity: two are the same game when every field this build
knows matches. No game is lost or doubled, even one a newer build wrote with
more fields. The gist keeps every line it held as it was, lines this build can't
read included.

To set it up, put a GitHub token with the `gist` scope in
`POLYMINE_GITHUB_TOKEN`. Create the gist first, private or not, and pass the id
from its URL.

`sync` reads and writes the files itself, so the app doesn't have to run, and
`--local` doesn't apply. It writes to the gist only when the gist lacks games. A
history the GitHub API truncates, past about a megabyte, is read whole from the
gist's raw URL, up to 64 MiB. A missing token or a malformed id is a `usage`
error, and a network or GitHub failure is `internal`.

The reply holds these fields:

1. `gist`: the gist's id.
2. `file`: the path of the local `history.jsonl`.
3. `games`: how many ranked games both now hold.
4. `addedToGist` and `addedHere`: how many games each side gained.
5. `skippedLines`: how many local lines didn't parse.
6. `skippedGistLines`: how many gist lines this build can't read. The gist keeps
   them.

## Output contract

1. Results go to stdout as JSON: indented in a terminal, one line when piped.
   `--pretty` and `--compact` force either.
2. `--fields a,b.c` keeps only those dotted keys. Lists are projected element by
   element, and a missing key comes out as `null`.
3. A move's reply lists only the cells that changed, with `changed` false when
   none did, and the game's `status` and `counters`. `step` wraps that reply as
   `move`, beside the `suggestion` it played.
4. Errors go to stderr as `{"error": {"code", "message", "hint"}}`, and `hint`
   is optional. Bad flags and arguments report this way too, with code `usage`.
   Besides `--help` and `--version`, `log` prints the log's last lines and
   `skill` prints Markdown, both as plain text on stdout. Every other command
   prints only JSON there, so piping it into `jq` is safe.

## Exit codes

| Code | Meaning                                         |
| ---- | ----------------------------------------------- |
| 0    | Success                                         |
| 1    | The request failed; the error's `code` says why |
| 2    | Usage: bad flags or arguments, or missing setup |
| 3    | The instance isn't running                      |
| 4    | No reply in time                                |
| 5    | The instance is busy; retry in a moment         |

Missing setup is a game, a log, or a GitHub token that isn't there, or `stats`
with `--local`, since headless games keep no statistics.

Busy has its own code, apart from timeout. A busy app answered at once without
playing anything, so a retry is safe. A move that timed out may still land.

## Error codes

| Code               | Meaning                                         |
| ------------------ | ----------------------------------------------- |
| `not_running`      | No instance of that name answers                |
| `timeout`          | The instance didn't reply in time               |
| `busy`             | The instance turned the request away unplayed   |
| `usage`            | A malformed request or missing setup            |
| `version_mismatch` | The CLI and the app speak different protocols   |
| `invalid_cell`     | A cell id is outside the board                  |
| `not_playable`     | The game is over                                |
| `invalid_value`    | A value is out of range                         |
| `internal`         | Something failed in the app, on disk, or online |

## For coding agents

Save the skill where your agent finds it, for example in Claude Code:

```sh
mkdir -p .claude/skills/polymine-cli
polymine-cli skill > .claude/skills/polymine-cli/SKILL.md
```

The skill's last section is a short snippet for a project's `AGENTS.md`. A
permission rule such as `Bash(polymine-cli:*)` lets the agent play without
asking for each move.
