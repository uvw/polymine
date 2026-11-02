//! `polymine-cli`: plays Polymine from a terminal and prints JSON.
//!
//! A console program of its own, because the app is a GUI program on Windows
//! and can't reliably write to a terminal. Results go to stdout, errors to
//! stderr as `{"error": {"code", "message", "hint"}}`. `EXIT_CODES` lists the
//! exit codes.

mod cli;
mod local;
mod sync;
#[cfg(windows)]
mod user_path;

use std::io::IsTerminal;
use std::time::Duration;

use clap::error::ErrorKind;
use clap::{CommandFactory, Parser};
use polymine_core::CellId;
use polymine_ipc::instance::{self, INSTANCE_ENV, InstanceName};
use polymine_ipc::{ErrorBody, ErrorCode, Registry, Request, Response, transport};
use serde_json::{Map, Value, json};

use cli::{Cli, Command};

const SKILL: &str = include_str!("../../../skills/polymine-cli/SKILL.md");

fn main() {
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(e) if matches!(e.kind(), ErrorKind::DisplayHelp | ErrorKind::DisplayVersion) => {
            e.exit()
        }
        Err(e) => {
            let args: Vec<String> = std::env::args().collect();
            let flag = |name: &str| args.iter().any(|a| a == name);
            let pretty =
                flag("--pretty") || (!flag("--compact") && std::io::stdout().is_terminal());
            eprintln!("{}", render(&json!({ "error": usage_error(&e) }), pretty));
            std::process::exit(exit_code(ErrorCode::Usage));
        }
    };
    let pretty = cli.pretty || (!cli.compact && std::io::stdout().is_terminal());
    let code = match run(&cli) {
        Ok(Output::Json(value)) => {
            println!("{}", render(&project(&value, &cli.fields), pretty));
            0
        }
        Ok(Output::Text(text)) => {
            print!("{text}");
            0
        }
        Err(error) => {
            eprintln!("{}", render(&json!({ "error": error }), pretty));
            exit_code(error.code)
        }
    };
    std::process::exit(code);
}

enum Output {
    Json(Value),
    Text(String),
}

/// Codes that call for a different next step get an exit code of their own.
/// Busy isn't timeout: a busy app answered at once, so retrying is safe, while
/// a timed-out move may still land.
fn exit_code(code: ErrorCode) -> i32 {
    match code {
        ErrorCode::Usage => 2,
        ErrorCode::NotRunning => 3,
        ErrorCode::Timeout => 4,
        ErrorCode::Busy => 5,
        ErrorCode::VersionMismatch
        | ErrorCode::InvalidCell
        | ErrorCode::NotPlayable
        | ErrorCode::InvalidValue
        | ErrorCode::Internal => 1,
    }
}

/// What each exit code means, as `describe` lists them.
const EXIT_CODES: [(i32, &str); 6] = [
    (0, "ok"),
    (1, "the request failed"),
    (2, "usage"),
    (3, "not running"),
    (4, "timeout"),
    (5, "busy"),
];

fn render(value: &Value, pretty: bool) -> String {
    if pretty {
        serde_json::to_string_pretty(value)
    } else {
        serde_json::to_string(value)
    }
    .expect("JSON values always serialize")
}

fn cells(ids: &[u32]) -> Vec<CellId> {
    ids.iter().copied().map(CellId).collect()
}

fn run(cli: &Cli) -> Result<Output, ErrorBody> {
    let request = match &cli.command {
        Command::Status => Request::Status,
        Command::Board => Request::Board,
        Command::New {
            tiling,
            level,
            seed,
        } => Request::NewGame {
            tiling: tiling.map(cli::TilingArg::id),
            level: level.map(cli::LevelArg::level),
            seed: *seed,
        },
        Command::Open { cells: ids } => Request::Open { cells: cells(ids) },
        Command::Flag { cells: ids } => Request::Flag { cells: cells(ids) },
        Command::Unflag { cells: ids } => Request::Unflag { cells: cells(ids) },
        Command::Hint => Request::Hint,
        Command::Step => Request::Step,
        Command::Stats { tiling, level } => Request::Stats {
            tiling: tiling.map(cli::TilingArg::id),
            level: level.map(cli::LevelArg::level),
        },
        Command::Instances => return Ok(Output::Json(instances())),
        Command::Paths => return Ok(Output::Json(paths(&instance_name(cli)?))),
        Command::Log { lines } => return log(&instance_name(cli)?, *lines).map(Output::Text),
        Command::Link { dir } => return link(dir.as_deref()).map(Output::Json),
        Command::Unlink { dir } => return unlink(dir.as_deref()).map(Output::Json),
        Command::Sync { gist } => return sync::sync(&instance_name(cli)?, gist).map(Output::Json),
        Command::Describe => return Ok(Output::Json(describe())),
        Command::Skill => return Ok(Output::Text(SKILL.to_owned())),
    };
    let response = match &cli.local {
        Some(game) => local::handle(&local::games_dir(), game, request),
        None => transport::call(
            &instance_name(cli)?,
            &request,
            Duration::from_millis(cli.timeout.max(100)),
        ),
    };
    match response {
        Response::Result(value) => Ok(Output::Json(value)),
        Response::Error(error) => Err(error),
    }
}

/// A clap error as the documented `usage` error. Clap's tips become the hint.
fn usage_error(error: &clap::Error) -> ErrorBody {
    const HELP: &str = "`polymine-cli --help` lists the commands; `polymine-cli <command> --help` shows their flags";
    if error.kind() == ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand {
        return ErrorBody::new(ErrorCode::Usage, "name a command").with_hint(HELP);
    }
    let text = error.render().to_string();
    let body = text.split("\n\nUsage:").next().unwrap_or_default();
    let body = body
        .split("\n\nFor more information")
        .next()
        .unwrap_or_default();
    let (mut message, mut tips) = (Vec::new(), Vec::new());
    for line in body.lines().map(str::trim).filter(|l| !l.is_empty()) {
        match line.strip_prefix("tip: ") {
            Some(tip) => tips.push(tip),
            None => message.push(line.strip_prefix("error: ").unwrap_or(line)),
        }
    }
    tips.push(HELP);
    ErrorBody::new(ErrorCode::Usage, message.join(" ")).with_hint(tips.join("; "))
}

/// The instance to drive: `--instance`, else [`INSTANCE_ENV`], else the
/// default one.
fn instance_name(cli: &Cli) -> Result<InstanceName, ErrorBody> {
    let from_env = std::env::var(INSTANCE_ENV).ok();
    InstanceName::from_option(cli.instance.as_deref().or(from_env.as_deref()))
        .map_err(|e| ErrorBody::new(ErrorCode::Usage, e.to_string()))
}

/// Running instances, pruned as [`list_instances`] describes.
fn instances() -> Value {
    let registry = Registry::shared();
    json!(list_instances(&registry, |socket| {
        transport::call_at(socket, &Request::Status, Duration::from_secs(2))
    }))
}

/// Lists the registered instances, asking each one for its `status` through
/// `call`. An entry whose socket nobody listens on is gone, so it's pruned.
/// Any other reply, even a busy one, a version mismatch, or a timeout, comes
/// from a live app, so its entry stays and shows the error it gave.
fn list_instances(registry: &Registry, call: impl Fn(&str) -> Response) -> Vec<Value> {
    registry
        .list()
        .into_iter()
        .filter_map(|entry| {
            let mut listed = json!(entry);
            match call(&entry.socket) {
                Response::Result(_) => {}
                Response::Error(error) if error.code == ErrorCode::NotRunning => {
                    let _ = registry.remove(&entry.name);
                    return None;
                }
                Response::Error(error) => listed["error"] = json!(error),
            }
            Some(listed)
        })
        .collect()
}

fn paths(name: &InstanceName) -> Value {
    json!({
        "instance": name,
        "socket": transport::socket_address(name),
        "registry": Registry::shared().dir(),
        "log": instance::log_file(name),
        "games": local::games_dir(),
        "dataOverride": instance::data_dir_override(),
        "themes": themes_dir(name),
    })
}

/// Where the instance's app reads player themes from.
fn themes_dir(name: &InstanceName) -> Option<std::path::PathBuf> {
    let (config, data) = instance::app_dirs();
    let (_, data) = instance::instance_dirs(name, config, data);
    data.as_deref().map(polymine_ipc::themes::themes_dir)
}

fn log(name: &InstanceName, lines: usize) -> Result<String, ErrorBody> {
    let path = instance::log_file(name)
        .ok_or_else(|| ErrorBody::new(ErrorCode::Internal, "no log folder on this system"))?;
    let text = std::fs::read_to_string(&path).map_err(|e| {
        ErrorBody::new(
            ErrorCode::Usage,
            format!("can't read {}: {e}", path.display()),
        )
        .with_hint("the log appears once the instance has run")
    })?;
    let all: Vec<&str> = text.lines().collect();
    let start = all.len().saturating_sub(lines);
    let mut tail = all[start..].join("\n");
    tail.push('\n');
    Ok(tail)
}

#[allow(
    clippy::needless_pass_by_value,
    reason = "map_err passes the error by value"
)]
fn internal(e: std::io::Error) -> ErrorBody {
    ErrorBody::new(ErrorCode::Internal, e.to_string())
}

/// Puts this executable on PATH. Windows has no user-writable folder on PATH
/// by default, so it adds the executable's own folder to the user's PATH.
#[cfg(windows)]
fn link(_dir: Option<&std::path::Path>) -> Result<Value, ErrorBody> {
    let folder = exe_folder()?;
    let (path, expand) = user_path::registry::read().map_err(internal)?;
    let next = user_path::with_folder(&path, &folder);
    if let Some(next) = &next {
        user_path::registry::write(next, expand).map_err(internal)?;
    }
    Ok(json!({
        "changed": next.is_some(),
        "folder": folder,
        "onPath": true,
        "hint": "open a new terminal to pick up the change",
    }))
}

/// Takes this executable's folder off the user's PATH again. The uninstaller
/// runs it.
#[cfg(windows)]
fn unlink(_dir: Option<&std::path::Path>) -> Result<Value, ErrorBody> {
    let folder = exe_folder()?;
    let (path, expand) = user_path::registry::read().map_err(internal)?;
    let next = user_path::without_folder(&path, &folder);
    if let Some(next) = &next {
        user_path::registry::write(next, expand).map_err(internal)?;
    }
    Ok(json!({ "changed": next.is_some(), "folder": folder }))
}

/// The folder this executable sits in, as text for the PATH.
#[cfg(windows)]
fn exe_folder() -> Result<String, ErrorBody> {
    let exe = std::env::current_exe().map_err(internal)?;
    exe.parent()
        .map(|p| p.display().to_string())
        .ok_or_else(|| ErrorBody::new(ErrorCode::Internal, "the executable has no folder"))
}

/// Puts this executable on PATH by linking it into `dir`, by default
/// `~/.local/bin`.
#[cfg(unix)]
fn link(dir: Option<&std::path::Path>) -> Result<Value, ErrorBody> {
    let exe = std::env::current_exe().map_err(internal)?;
    let dir = link_dir(dir)?;
    std::fs::create_dir_all(&dir).map_err(internal)?;
    let target = dir.join("polymine-cli");
    let changed = !std::fs::read_link(&target).is_ok_and(|t| t == exe);
    if changed {
        let _ = std::fs::remove_file(&target);
        std::os::unix::fs::symlink(&exe, &target).map_err(internal)?;
    }
    let on_path = std::env::var_os("PATH").is_some_and(|path| path_has(&path, &dir));
    let mut reply = json!({ "changed": changed, "link": target, "to": exe, "onPath": on_path });
    if !on_path {
        reply["hint"] = json!(format!(
            "{} isn't on PATH: add `export PATH=\"{}:$PATH\"` to your shell's profile, such as ~/.zshrc, then open a new terminal",
            dir.display(),
            dir.display()
        ));
    }
    Ok(reply)
}

/// Removes the link `link` made in `dir`. Anything else there isn't ours and
/// stays.
#[cfg(unix)]
fn unlink(dir: Option<&std::path::Path>) -> Result<Value, ErrorBody> {
    let exe = std::env::current_exe().map_err(internal)?;
    let target = link_dir(dir)?.join("polymine-cli");
    let ours = std::fs::read_link(&target).is_ok_and(|t| t == exe);
    if ours {
        std::fs::remove_file(&target).map_err(internal)?;
    }
    Ok(json!({ "changed": ours, "link": target }))
}

#[cfg(unix)]
fn link_dir(dir: Option<&std::path::Path>) -> Result<std::path::PathBuf, ErrorBody> {
    match dir {
        Some(dir) => Ok(dir.to_path_buf()),
        None => instance::home_bin_dir()
            .ok_or_else(|| ErrorBody::new(ErrorCode::Internal, "no home folder")),
    }
}

/// Whether the `PATH`-style list `path` names `dir`, directly or through a
/// link.
#[cfg(unix)]
fn path_has(path: &std::ffi::OsStr, dir: &std::path::Path) -> bool {
    let canonical = std::fs::canonicalize(dir).ok();
    std::env::split_paths(path).any(|entry| {
        entry == dir || canonical.is_some() && std::fs::canonicalize(&entry).ok() == canonical
    })
}

/// Every command with its flags, plus the exit and error codes.
fn describe() -> Value {
    let root = Cli::command();
    let arg_json = |arg: &clap::Arg| {
        json!({
            "name": arg.get_long().map_or_else(|| arg.get_id().to_string(), |l| format!("--{l}")),
            "help": arg.get_help().map(ToString::to_string),
            "required": arg.is_required_set(),
            "values": arg.get_possible_values().iter().map(|v| v.get_name().to_owned()).collect::<Vec<_>>(),
        })
    };
    let commands: Vec<Value> = root
        .get_subcommands()
        .map(|c| {
            json!({
                "name": c.get_name(),
                "about": c.get_about().map(ToString::to_string),
                "args": c.get_arguments().filter(|a| !a.is_global_set() && a.get_id() != "help").map(arg_json).collect::<Vec<_>>(),
            })
        })
        .collect();
    let global: Vec<Value> = root
        .get_arguments()
        .filter(|a| !["help", "version"].contains(&a.get_id().as_str()))
        .map(arg_json)
        .collect();
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "protocol": polymine_ipc::protocol::VERSION,
        "globalFlags": global,
        "commands": commands,
        "exitCodes": EXIT_CODES.iter().map(|(code, meaning)| (code.to_string(), json!(meaning))).collect::<Map<_, _>>(),
        "errorCodes": ErrorCode::ALL,
    })
}

/// Keeps only the dotted `fields` of `value`. Lists are projected element by
/// element, and a missing key comes out as `null`.
fn project(value: &Value, fields: &[String]) -> Value {
    if fields.is_empty() {
        return value.clone();
    }
    let paths: Vec<Vec<&str>> = fields.iter().map(|f| f.split('.').collect()).collect();
    pick(value, &paths)
}

fn pick(value: &Value, paths: &[Vec<&str>]) -> Value {
    if let Value::Array(items) = value {
        return Value::Array(items.iter().map(|item| pick(item, paths)).collect());
    }
    if paths.iter().any(Vec::is_empty) {
        return value.clone();
    }
    let mut out = Map::new();
    for path in paths {
        let key = path[0];
        if out.contains_key(key) {
            continue;
        }
        let rest: Vec<Vec<&str>> = paths
            .iter()
            .filter(|p| p[0] == key)
            .map(|p| p[1..].to_vec())
            .collect();
        let child = value.get(key).map_or(Value::Null, |v| pick(v, &rest));
        out.insert(key.to_owned(), child);
    }
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fields_keep_dotted_paths_and_project_lists() {
        let value = json!({
            "status": "playing",
            "mines": 13,
            "cells": [{"id": 0, "state": "open", "neighbors": [1]}, {"id": 1, "state": "closed"}],
        });
        let fields = ["status", "cells.id", "cells.state", "gone"].map(String::from);
        assert_eq!(
            project(&value, &fields),
            json!({
                "status": "playing",
                "cells": [{"id": 0, "state": "open"}, {"id": 1, "state": "closed"}],
                "gone": null,
            })
        );
        assert_eq!(project(&value, &[]), value);
    }

    #[test]
    fn instances_prune_only_the_entries_nobody_answers_for() {
        use polymine_ipc::Registration;
        let dir = tempfile::tempdir().unwrap();
        let registry = Registry::at(dir.path());
        let names = ["busy", "gone", "newer", "playing", "slow"];
        let _guards: Vec<_> = names
            .iter()
            .map(|name| {
                let entry = Registration {
                    name: InstanceName::new(name).unwrap(),
                    pid: 1,
                    version: "0.0.0".into(),
                    socket: (*name).to_owned(),
                    started_ms: 0,
                };
                registry.register(&entry).unwrap()
            })
            .collect();
        let error = |code| Response::Error(ErrorBody::new(code, "no"));
        let listed = list_instances(&registry, |socket| match socket {
            "busy" => error(ErrorCode::Busy),
            "gone" => error(ErrorCode::NotRunning),
            "newer" => error(ErrorCode::VersionMismatch),
            "slow" => error(ErrorCode::Timeout),
            _ => Response::Result(json!({})),
        });
        let errors: Vec<(&str, &Value)> = listed
            .iter()
            .map(|e| (e["name"].as_str().unwrap(), &e["error"]["code"]))
            .collect();
        assert_eq!(
            errors,
            [
                ("busy", &json!("busy")),
                ("newer", &json!("version_mismatch")),
                ("playing", &Value::Null),
                ("slow", &json!("timeout")),
            ]
        );
        let left: Vec<String> = registry
            .list()
            .into_iter()
            .map(|e| e.name.to_string())
            .collect();
        assert_eq!(left, ["busy", "newer", "playing", "slow"]);
    }

    #[test]
    fn errors_map_to_documented_exit_codes() {
        assert_eq!(exit_code(ErrorCode::Usage), 2);
        assert_eq!(exit_code(ErrorCode::NotRunning), 3);
        assert_eq!(exit_code(ErrorCode::Timeout), 4);
        assert_eq!(exit_code(ErrorCode::Busy), 5);
        assert_eq!(exit_code(ErrorCode::InvalidCell), 1);
    }

    #[test]
    fn describe_lists_every_error_code_and_the_exit_codes_they_use() {
        let catalog = describe();
        let listed: Vec<ErrorCode> = serde_json::from_value(catalog["errorCodes"].clone()).unwrap();
        assert_eq!(listed, ErrorCode::ALL);
        let exits = catalog["exitCodes"].as_object().unwrap();
        let mut used: Vec<i32> = ErrorCode::ALL.iter().map(|&c| exit_code(c)).collect();
        used.push(0);
        used.sort_unstable();
        used.dedup();
        let described: Vec<i32> = exits.keys().map(|k| k.parse().unwrap()).collect();
        assert_eq!(described, used, "every exit code in use, and only those");
    }

    #[test]
    fn describe_lists_every_command_and_skips_global_flags_per_command() {
        let catalog = describe();
        let names: Vec<&str> = catalog["commands"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["name"].as_str().unwrap())
            .collect();
        for expected in [
            "status", "board", "new", "open", "flag", "unflag", "hint", "step", "stats", "skill",
        ] {
            assert!(
                names.contains(&expected),
                "{expected} missing from {names:?}"
            );
        }
        let new = catalog["commands"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == "new")
            .unwrap();
        let args: Vec<&str> = new["args"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a["name"].as_str().unwrap())
            .collect();
        assert_eq!(args, ["--tiling", "--level", "--seed"]);
        assert!(
            catalog["globalFlags"]
                .as_array()
                .unwrap()
                .iter()
                .any(|a| a["name"] == "--fields")
        );
    }

    #[test]
    fn every_tiling_flag_names_a_real_tiling() {
        use clap::ValueEnum;
        let ids: Vec<_> = cli::TilingArg::value_variants()
            .iter()
            .map(|t| t.id())
            .collect();
        assert_eq!(ids, polymine_core::TilingId::ALL);
    }

    #[test]
    fn the_skill_is_the_guide_in_the_repo() {
        assert!(SKILL.starts_with("---\nname: polymine-cli"));
    }

    #[test]
    fn the_skill_names_every_error_code() {
        for code in ErrorCode::ALL {
            let name = serde_json::to_value(code).unwrap();
            let name = name.as_str().unwrap();
            assert!(
                SKILL.contains(&format!("`{name}`")),
                "the skill doesn't mention `{name}`"
            );
        }
    }

    #[test]
    #[cfg(unix)]
    fn link_checks_the_folder_against_path() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("bin");
        std::fs::create_dir(&bin).unwrap();
        let path = |dirs: &[&std::path::Path]| std::env::join_paths(dirs).unwrap();
        assert!(path_has(
            &path(&[std::path::Path::new("/usr/bin"), &bin]),
            &bin
        ));
        assert!(!path_has(&path(&[std::path::Path::new("/usr/bin")]), &bin));
        // The same folder spelled through `..` still counts.
        let roundabout = bin.join("..").join("bin");
        assert!(path_has(&path(&[&roundabout]), &bin));
    }

    #[test]
    fn cli_definition_is_consistent() {
        Cli::command().debug_assert();
    }
}
