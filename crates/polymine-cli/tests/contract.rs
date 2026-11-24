//! The command line's contract, checked on the built program: JSON errors on
//! stderr, exit codes, and which target a command plays.

use std::process::{Command, Output};

use serde_json::Value;

/// Runs `polymine-cli` with its own data folder and no instance from the
/// caller's environment, plus `env`.
fn run(args: &[&str], env: &[(&str, &str)]) -> Output {
    let data = tempfile::tempdir().unwrap();
    run_in(data.path(), args, env)
}

fn run_in(data: &std::path::Path, args: &[&str], env: &[(&str, &str)]) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_polymine-cli"));
    command
        .args(args)
        .env("POLYMINE_DATA_DIR", data)
        .env_remove("POLYMINE_INSTANCE");
    for (key, value) in env {
        command.env(key, value);
    }
    command.output().unwrap()
}

fn json(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes)
        .unwrap_or_else(|e| panic!("{e}: {}", String::from_utf8_lossy(bytes)))
}

#[test]
fn local_wins_over_an_instance_from_the_environment() {
    let out = run(
        &["--local", "practice", "--compact", "new", "--seed", "7"],
        &[("POLYMINE_INSTANCE", "lab")],
    );
    assert_eq!(out.status.code(), Some(0), "{out:?}");
    assert_eq!(json(&out.stdout)["status"], "ready");
}

#[test]
fn an_explicit_instance_still_conflicts_with_local() {
    let out = run(&["--instance", "lab", "--local", "practice", "status"], &[]);
    assert_eq!(out.status.code(), Some(2));
    assert_eq!(json(&out.stderr)["error"]["code"], "usage");
}

#[test]
fn argument_errors_are_json_usage_errors() {
    for args in [
        &["opne"][..],
        &["open"],
        &["new", "--level", "hard"],
        &["--timeout", "soon", "status"],
        &["theme"],
        &["theme", "use"],
        &[],
    ] {
        let out = run(args, &[]);
        assert_eq!(out.status.code(), Some(2), "{args:?}");
        assert!(out.stdout.is_empty(), "{args:?}");
        let error = &json(&out.stderr)["error"];
        assert_eq!(error["code"], "usage", "{args:?}");
        assert!(error["message"].as_str().is_some_and(|m| !m.is_empty()));
        assert!(error["hint"].as_str().is_some_and(|h| h.contains("--help")));
    }
    let typo = run(&["opne"], &[]);
    let hint = json(&typo.stderr)["error"]["hint"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(hint.contains("'open'"), "{hint}");
}

#[test]
fn help_and_version_print_plain_text() {
    let help = run(&["--help"], &[]);
    assert_eq!(help.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&help.stdout).contains("Usage:"));
    let version = run(&["--version"], &[]);
    assert_eq!(version.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&version.stdout).starts_with("polymine-cli "));
}

#[test]
fn paths_fall_back_to_the_environment_when_nothing_runs() {
    let data = tempfile::tempdir().unwrap();
    let instance = format!("contract-{}", std::process::id());
    let out = run_in(
        data.path(),
        &["--instance", &instance, "--compact", "paths"],
        &[],
    );
    assert_eq!(out.status.code(), Some(0), "{out:?}");
    let paths = json(&out.stdout);
    assert_eq!(paths["source"], "environment");
    assert_eq!(paths["dataDir"], serde_json::json!(data.path()));
    assert_eq!(
        paths["themes"],
        serde_json::json!(data.path().join("themes"))
    );
    let log = paths["log"].as_str().unwrap();
    assert!(log.starts_with(data.path().to_str().unwrap()), "{log}");
    assert!(paths.get("instanceError").is_none());
    // The log follows the same folders: here, one nobody wrote yet.
    let missing = run_in(data.path(), &["--instance", &instance, "log"], &[]);
    assert_eq!(missing.status.code(), Some(2));
    let message = json(&missing.stderr)["error"]["message"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(message.contains(log), "{message}");
}

#[test]
fn themes_need_the_app() {
    let out = run(&["--local", "practice", "theme", "use", "graphite"], &[]);
    assert_eq!(out.status.code(), Some(2));
    assert_eq!(json(&out.stderr)["error"]["code"], "usage");
}
