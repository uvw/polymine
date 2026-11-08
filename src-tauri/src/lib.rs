//! Polymine desktop shell: owns the current game, settings, and history, and
//! exposes them to the web UI as Tauri commands and to `polymine-cli` over a
//! local socket.

mod accent;
mod app;
mod commands;
mod edge_fit;
mod environment;
mod error;
mod fatal;
mod files;
mod foreground;
mod history;
mod remote;
mod saves;
mod session;
mod settings;
mod sleep;
mod themes;
#[cfg(target_os = "macos")]
mod traffic_lights;
mod window_state;

use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// How often an unfinished game is saved while it changes.
const AUTOSAVE_INTERVAL: Duration = Duration::from_secs(5);

use polymine_ipc::instance::{self, INSTANCE_ENV};
use polymine_ipc::{InstanceName, Registration, Registry, Request, Response, transport};
use tauri::{Emitter, Manager};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

/// When the log rotates, and how many old logs it keeps beside the current one.
const LOG_FILE_BYTES: u128 = 1_000_000;
const LOG_FILES_KEPT: usize = 5;

/// The instance a debug build plays as when nothing names one, so `npm run app`
/// never writes the player's own settings and history.
const DEV_INSTANCE: &str = "dev";

/// The instance from `--instance <name>` or `POLYMINE_INSTANCE`. When neither is
/// set, a release build is the default instance and a debug build is
/// [`DEV_INSTANCE`]. An invalid name ends the process with a message.
fn startup_instance() -> InstanceName {
    let args: Vec<String> = std::env::args().collect();
    let from_args = args
        .iter()
        .position(|a| a == "--instance")
        .and_then(|i| args.get(i + 1).cloned());
    let value = from_args
        .or_else(|| std::env::var(INSTANCE_ENV).ok())
        .or_else(|| cfg!(debug_assertions).then(|| DEV_INSTANCE.to_owned()));
    InstanceName::from_option(value.as_deref()).unwrap_or_else(|e| fatal::exit(&e.to_string(), 2))
}

/// Starts the app. Blocks until the last window closes.
pub fn run() {
    log_panics();
    let instance = startup_instance();
    // A data folder of its own, for tests or a portable copy, takes the logs
    // too and keeps the window position out of the platform's folders.
    let own_data = instance::data_dir_override();
    let player_profile = instance.is_default() && own_data.is_none();
    let mut builder = tauri::Builder::default();
    if player_profile {
        // Must come first so a second launch hands off before anything else
        // starts. The lock is one per user, so named instances and copies
        // with their own data folder skip it and run beside this one; a second
        // launch of those finds its own pipe answering and exits.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }
    let webview_dir = webview_dir(&instance, own_data.as_deref());
    let (app_config, app_data) = instance::app_dirs();
    let (config_dir, data_dir) = instance::instance_dirs(&instance, app_config, app_data);
    // Named instances are for tests and must not move the player's window.
    let window_dir = config_dir.clone().filter(|_| player_profile);
    let file_name = Some(instance::log_file_stem(&instance));
    let log_target = match (&own_data, instance::log_dir()) {
        (Some(_), Some(path)) => TargetKind::Folder { path, file_name },
        _ => TargetKind::LogDir { file_name },
    };
    builder = builder.plugin(
        // The plugin's default deletes the whole log at 40 KB, panics included.
        tauri_plugin_log::Builder::new()
            .level(log::LevelFilter::Info)
            .max_file_size(LOG_FILE_BYTES)
            .rotation_strategy(RotationStrategy::KeepSome(LOG_FILES_KEPT))
            .targets([Target::new(TargetKind::Stdout), Target::new(log_target)])
            .build(),
    );
    let specta = specta_builder();
    let placement = window_dir
        .clone()
        .map(|dir| Arc::new(window_state::Tracker::new(dir)));
    let app = builder
        .on_window_event({
            let placement = placement.clone();
            move |window, event| {
                #[cfg(target_os = "macos")]
                match event {
                    tauri::WindowEvent::Resized(_)
                    | tauri::WindowEvent::ScaleFactorChanged { .. } => {
                        traffic_lights::center(window);
                    }
                    tauri::WindowEvent::Focused(_) | tauri::WindowEvent::ThemeChanged(_) => {
                        traffic_lights::center_after_layout(window);
                    }
                    _ => {}
                }
                let Some(placement) = placement.as_deref().filter(|_| window.label() == "main")
                else {
                    return;
                };
                match event {
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                        placement.update(window);
                    }
                    tauri::WindowEvent::CloseRequested { .. } => {
                        placement.update(window);
                        placement.save();
                    }
                    _ => {}
                }
            }
        })
        .setup({
            let instance = instance.clone();
            move |app| {
                let window = create_window(app, webview_dir)
                    .inspect_err(|e| log::error!("could not create the window: {e}"))
                    .ok();
                let material = window
                    .as_ref()
                    .is_some_and(|w| prepare_window(w, window_dir.as_deref()));
                let named = (!instance.is_default()).then(|| instance.to_string());
                app.manage(environment::Environment::current(material, named));
                app.manage(app::App::load(config_dir.as_deref(), data_dir.as_deref()));
                app.manage(themes::Themes::new(data_dir.as_deref()));
                let info = remote::InstanceInfo {
                    name: instance.clone(),
                    config_dir,
                    data_dir,
                };
                start_remote(app.handle(), info);
                start_autosave(app.handle().clone());
                Ok(())
            }
        })
        .invoke_handler(specta.invoke_handler())
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| fatal::start_failed(&e));
    app.run(move |handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(placement) = &placement {
                placement.save();
            }
            save_game(handle);
            let _ = Registry::shared().remove_own(&instance, std::process::id());
        }
    });
}

/// The commands the window calls. `tauri-specta` types them for the UI, and
/// [`export_bindings`] writes the TypeScript side.
fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
            commands::snapshot,
            commands::tiling_previews,
            commands::new_game,
            commands::primary,
            commands::secondary,
            commands::hint,
            commands::assist,
            commands::set_paused,
            commands::get_settings,
            commands::update_settings,
            commands::get_stats,
            commands::fit_board,
            commands::list_saves,
            commands::save_as,
            commands::load_save,
            commands::delete_save,
            environment::get_environment,
            environment::set_material,
            accent::get_accent,
            foreground::window_in_front,
            themes::list_themes,
            themes::read_theme,
            themes::open_themes_folder,
        ])
        // No command's signature brings these in: one is sent as an event,
        // the other is only built by the UI.
        .typ::<remote::ExternalChange>()
        .typ::<polymine_core::Bounds>()
        .error_handling(tauri_specta::ErrorHandlingMode::Throw)
        // Every 64-bit value the UI sees is a millisecond time or a change count,
        // far below 2^53.
        .dangerously_cast_bigints_to_number()
}

/// Writes the TypeScript types and command wrappers to `path`. The
/// `bindings` test calls it on every `cargo test`.
#[doc(hidden)]
pub fn export_bindings(path: &std::path::Path) -> Result<(), Box<dyn std::error::Error>> {
    specta_builder().export(
        specta_typescript::Typescript::default()
            .header("// Generated by `cargo test` through tauri-specta. Do not edit.\n"),
        path,
    )?;
    let text = std::fs::read_to_string(path)?;
    std::fs::write(path, serialized_names(&text))?;
    Ok(())
}

/// Points each `X = X_Serialize | X_Deserialize` union at `X_Serialize`. A
/// `#[serde(default)]` field may be missing on the way in, which the
/// `_Deserialize` shape allows, but the shell always sends it. The UI reads
/// what the shell sends and passes the same values back, which every
/// `_Deserialize` parameter accepts.
fn serialized_names(bindings: &str) -> String {
    let mut out = String::with_capacity(bindings.len());
    for line in bindings.lines() {
        let union = line
            .strip_prefix("export type ")
            .and_then(|rest| rest.split_once(" = "))
            .filter(|(name, rhs)| *rhs == format!("{name}_Serialize | {name}_Deserialize;"));
        match union {
            Some((name, _)) => {
                out.push_str("export type ");
                out.push_str(name);
                out.push_str(" = ");
                out.push_str(name);
                out.push_str("_Serialize;");
            }
            None => out.push_str(line),
        }
        out.push('\n');
    }
    out
}

/// Readies the hidden main window and shows it: the material and, for the
/// player's own profile, the saved size and position. Returns whether
/// the material took.
fn prepare_window(window: &tauri::WebviewWindow, window_dir: Option<&std::path::Path>) -> bool {
    let material = environment::apply_material(window);
    edge_fit::watch(window);
    if let Some(dir) = window_dir {
        window_state::restore(&window.as_ref().window(), dir);
    }
    if let Err(e) = window.show() {
        log::error!("could not show the window: {e}");
    }
    #[cfg(target_os = "macos")]
    traffic_lights::center_after_layout(&window.as_ref().window());
    material
}

/// Logs every panic with its place and a backtrace, then runs the previous
/// hook. Release builds on Windows have no console, so stderr alone loses it.
fn log_panics() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let place = info
            .location()
            .map_or_else(|| "an unknown place".to_owned(), ToString::to_string);
        let backtrace = std::backtrace::Backtrace::force_capture();
        log::error!(
            "panic at {place}: {}\n{backtrace}",
            panic_message(info.payload())
        );
        previous(info);
    }));
}

fn panic_message(payload: &(dyn std::any::Any + Send)) -> &str {
    payload
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
        .unwrap_or("no message")
}

fn save_game(handle: &tauri::AppHandle) {
    if let Err(e) = handle.state::<app::App>().save_game() {
        log::warn!("could not save the game: {e}");
    }
}

/// Saves the game every few seconds, only when moves happened in between,
/// and pauses it when the computer sleeps.
fn start_autosave(handle: tauri::AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("polymine-autosave".into())
        .spawn(move || {
            let mut watch = sleep::SleepWatch::new(SystemTime::now(), Instant::now());
            let mut since_save = Duration::ZERO;
            loop {
                std::thread::sleep(sleep::TICK);
                // The panic hook logs a failed round; the next one tries again.
                let _ = std::panic::catch_unwind(AssertUnwindSafe(|| {
                    if let Some(at) = watch.tick(SystemTime::now(), Instant::now()) {
                        pause_for_sleep(&handle, at);
                    }
                    since_save += sleep::TICK;
                    if since_save >= AUTOSAVE_INTERVAL {
                        since_save = Duration::ZERO;
                        save_game(&handle);
                    }
                }));
            }
        });
    if let Err(e) = spawned {
        log::warn!("autosave is off: {e}");
    }
}

/// Pauses a game in play as of `at`, the last moment the computer was surely
/// awake, so the time asleep never counts. The window reloads to show it.
fn pause_for_sleep(handle: &tauri::AppHandle, at: Instant) {
    if !handle.state::<app::App>().pause_for_sleep(at) {
        return;
    }
    log::info!("the computer slept, so the game paused");
    if let Err(e) = handle.emit(remote::EXTERNAL_EVENT, remote::ExternalChange::Reload) {
        log::warn!("could not tell the window about the pause: {e}");
    }
    save_game(handle);
}

/// Where the window's webview keeps its data, or `None` for Tauri's default.
/// The Windows webview refuses to share one folder between instances started with
/// different browser options, and a portable copy keeps everything in its own
/// folder, so only the player's own instance uses the default.
fn webview_dir(
    instance: &InstanceName,
    own_data: Option<&std::path::Path>,
) -> Option<std::path::PathBuf> {
    let base = match own_data {
        Some(dir) => dir.join("webview"),
        None if instance.is_default() => return None,
        None => instance::runtime_dir().join("webview"),
    };
    Some(base.join(instance.as_str()))
}

/// Builds the main window from its configuration, which sets `create` to false
/// so the webview's data folder can be chosen here.
fn create_window(
    app: &tauri::App,
    data_dir: Option<std::path::PathBuf>,
) -> tauri::Result<tauri::WebviewWindow> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
        .expect("the configuration defines the main window");
    let mut window = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?;
    if let Some(dir) = data_dir {
        window = window.data_directory(dir);
    }
    window.build()
}

/// Listens for `polymine-cli` and registers the instance. A named instance
/// that is already running ends this second copy.
fn start_remote(handle: &tauri::AppHandle, info: remote::InstanceInfo) {
    let name = info.name.clone();
    if matches!(
        transport::call(&name, &Request::Status, Duration::from_secs(2)),
        Response::Result(_)
    ) {
        log::error!("instance {name} is already running");
        handle.exit(1);
        return;
    }
    let address = transport::socket_address(&name);
    let emitter = handle.clone();
    let listening = transport::serve(&address, move |request| {
        let app = emitter.state::<app::App>();
        let (response, changes) = remote::handle(&app, &info, request);
        for change in changes {
            if let Err(e) = emitter.emit(remote::EXTERNAL_EVENT, change) {
                log::warn!("could not tell the window about a change: {e}");
            }
        }
        response
    });
    if let Err(e) = listening {
        log::error!("polymine-cli can't reach this instance: {e}");
        // A named instance exists to be driven from outside, so it stops
        // rather than run unreachable. The player's own instance plays on.
        if !name.is_default() {
            handle.exit(1);
        }
        return;
    }
    let started_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64);
    let entry = Registration {
        name,
        pid: std::process::id(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        socket: address,
        started_ms,
    };
    // The exit handler removes the entry; a crash leaves it for
    // `polymine-cli instances` to prune.
    match Registry::shared().register(&entry) {
        Ok(guard) => std::mem::forget(guard),
        Err(e) => log::warn!("could not register the instance: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::{panic_message, serialized_names};

    #[test]
    fn panic_messages_come_from_text_payloads() {
        let text = std::panic::catch_unwind(|| panic!("plain")).unwrap_err();
        assert_eq!(panic_message(text.as_ref()), "plain");
        let formatted = std::panic::catch_unwind(|| panic!("cell {}", 7)).unwrap_err();
        assert_eq!(panic_message(formatted.as_ref()), "cell 7");
        let other = std::panic::catch_unwind(|| std::panic::panic_any(7_u8)).unwrap_err();
        assert_eq!(panic_message(other.as_ref()), "no message");
    }

    #[test]
    fn points_phase_unions_at_the_serialized_shape() {
        let bindings = "export type Settings = Settings_Serialize | Settings_Deserialize;\n\
                        export type Level = \"a\";\n";
        assert_eq!(
            serialized_names(bindings),
            "export type Settings = Settings_Serialize;\nexport type Level = \"a\";\n"
        );
    }
}
