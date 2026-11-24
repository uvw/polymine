//! The command line, as `clap` parses it.

use clap::{Parser, Subcommand, ValueEnum};
use polymine_core::{Level, TilingId};

const AFTER_HELP: &str =
    "Agents: read `polymine-cli skill` first; `polymine-cli describe` lists every command.";

#[derive(Debug, Parser)]
#[command(name = "polymine-cli", version, about = "Plays Polymine from a terminal and prints JSON.", after_help = AFTER_HELP)]
pub struct Cli {
    /// Drive the running instance with this name. Defaults to
    /// `POLYMINE_INSTANCE`, which `--local` overrides.
    #[arg(long, global = true, conflicts_with = "local")]
    pub instance: Option<String>,
    /// Play a headless game saved under this name instead of driving the app.
    #[arg(long, global = true, value_name = "GAME")]
    pub local: Option<String>,
    /// Keep only these keys of the result, as dotted paths. Lists are
    /// projected element by element: `--fields cells.id,cells.state`.
    #[arg(long, global = true, value_delimiter = ',')]
    pub fields: Vec<String>,
    /// Indented JSON. The default when stdout is a terminal.
    #[arg(long, global = true, conflicts_with = "compact")]
    pub pretty: bool,
    /// One line of JSON. The default when stdout is piped.
    #[arg(long, global = true)]
    pub compact: bool,
    /// Milliseconds to wait for the app's reply.
    #[arg(long, global = true, default_value_t = 10_000)]
    pub timeout: u64,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
#[value(rename_all = "camelCase")]
pub enum TilingArg {
    Square,
    OffsetSquare,
    Herringbone,
    Pinwheel,
    Kite,
    Trapezoid,
    TrapezoidTriangle,
    TrapezoidHexagon,
    Triangle,
    OffsetTriangle,
    RightTriangle,
    ObtuseTriangle,
    Cairo,
    Floret,
    Hexagon,
    SnubSquare,
    SquareTriangle,
    SquareTriangleHexagon,
}

impl TilingArg {
    pub fn id(self) -> TilingId {
        let name = self
            .to_possible_value()
            .expect("every value has a name")
            .get_name()
            .to_owned();
        serde_json::from_value(serde_json::Value::String(name)).expect("names match TilingId")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum LevelArg {
    Beginner,
    Amateur,
    Professional,
    Crazy,
}

impl LevelArg {
    pub fn level(self) -> Level {
        match self {
            Self::Beginner => Level::Beginner,
            Self::Amateur => Level::Amateur,
            Self::Professional => Level::Professional,
            Self::Crazy => Level::Crazy,
        }
    }
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// The instance or saved game, and the game's status.
    Status,
    /// Every cell: id, state, number, center and neighbor ids.
    #[command(
        after_help = "Example: polymine-cli board --fields status,cells.id,cells.state,cells.number"
    )]
    Board,
    /// Starts a game. Without options, it keeps the current tiling and level.
    #[command(after_help = "Example: polymine-cli new --tiling kite --level amateur --seed 7")]
    New {
        #[arg(long)]
        tiling: Option<TilingArg>,
        #[arg(long)]
        level: Option<LevelArg>,
        /// Replays the same mine layout every time.
        #[arg(long)]
        seed: Option<u64>,
    },
    /// Clicks cells: opens a closed cell, or chords an open number.
    #[command(after_help = "Example: polymine-cli open 55 56")]
    Open {
        #[arg(required = true)]
        cells: Vec<u32>,
    },
    /// Puts flags on closed cells.
    Flag {
        #[arg(required = true)]
        cells: Vec<u32>,
    },
    /// Takes flags off.
    Unflag {
        #[arg(required = true)]
        cells: Vec<u32>,
    },
    /// The assistant's next move and its mine risk, without playing it.
    Hint,
    /// Lets the assistant play one move.
    Step,
    /// Statistics and champions. Needs a running instance.
    Stats {
        #[arg(long)]
        tiling: Option<TilingArg>,
        #[arg(long)]
        level: Option<LevelArg>,
    },
    /// Lists a running instance's themes, or switches its theme.
    Theme {
        #[command(subcommand)]
        command: ThemeCommand,
    },
    /// Registered instances. Entries no app listens for any more are removed.
    Instances,
    /// Where the instance's log, player themes, and the headless games live.
    /// A running instance says where its folders are; otherwise they come
    /// from this shell's environment.
    Paths,
    /// The last lines of an instance's log, found as `paths` finds it.
    Log {
        #[arg(long, default_value_t = 50)]
        lines: usize,
    },
    /// Puts this program on PATH: a link in ~/.local/bin on macOS and Linux,
    /// its folder in the user's PATH on Windows. Says whether the folder is
    /// on PATH.
    Link {
        /// The folder for the link, instead of ~/.local/bin.
        #[arg(long)]
        dir: Option<std::path::PathBuf>,
    },
    /// Takes this program off PATH again: removes the link `link` made, or
    /// its folder from the user's PATH on Windows.
    Unlink {
        /// The folder the link is in, instead of ~/.local/bin.
        #[arg(long)]
        dir: Option<std::path::PathBuf>,
    },
    /// Shares the instance's ranked games through a GitHub gist: merges the
    /// gist's history.jsonl with the local one and adds every ranked game to
    /// both. Needs a token with the gist scope in `POLYMINE_GITHUB_TOKEN`.
    Sync {
        /// The gist's id, the last part of its URL.
        #[arg(long)]
        gist: String,
    },
    /// Every command, flag, exit code and error code, as JSON.
    Describe,
    /// The usage guide for coding agents, as Markdown.
    #[command(after_help = "Example: polymine-cli skill > .claude/skills/polymine-cli/SKILL.md")]
    Skill,
}

#[derive(Debug, Subcommand)]
pub enum ThemeCommand {
    /// Every theme the instance can show, where each comes from, and the one
    /// it shows.
    List,
    /// Switches the instance's theme, as Settings does, and saves it. The
    /// window reads the themes folder again, so using the current theme
    /// reloads its files.
    #[command(after_help = "Example: polymine-cli theme use graphite")]
    Use {
        /// A theme id from `theme list`.
        id: String,
    },
}
