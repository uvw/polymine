//! Links the app opens in the player's browser. The window never names the
//! address: each command opens one the shell knows, so no page can send the
//! player anywhere else.

use std::io;

use crate::error::AppError;

/// The project's home on GitHub, from the workspace's `Cargo.toml`.
pub const REPOSITORY: &str = env!("CARGO_PKG_REPOSITORY");

/// Opens the project's repository in the browser.
#[tauri::command]
#[specta::specta]
pub fn open_repository() -> Result<(), AppError> {
    open_url(REPOSITORY).map_err(AppError::OpenLink)
}

/// Opens `url` in the default browser.
pub fn open_url(url: &str) -> io::Result<()> {
    // No shell sits between, so nothing in the URL is a command. cmd's start
    // would cut it at an ampersand.
    let mut command = if cfg!(target_os = "macos") {
        std::process::Command::new("open")
    } else if cfg!(target_os = "windows") {
        let mut command = std::process::Command::new("rundll32.exe");
        command.arg("url.dll,FileProtocolHandler");
        command
    } else {
        std::process::Command::new("xdg-open")
    };
    let mut child = command.arg(url).spawn()?;
    // Reaps the opener when it exits, so it doesn't linger as a zombie.
    std::thread::spawn(move || child.wait());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_repository_is_the_projects_github_page() {
        assert_eq!(REPOSITORY, "https://github.com/uvw/polymine");
    }
}
