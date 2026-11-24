fn main() {
    tauri_build::build();
    write_built_in_themes();
    // Tauri gives the app binary a Common Controls v6 manifest. Integration
    // tests that link the window runtime need it too, or Windows won't start
    // them.
    let msvc = std::env::var("CARGO_CFG_TARGET_ENV").is_ok_and(|e| e == "msvc");
    if msvc {
        let manifest =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows/tests.manifest");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
}

/// Writes the ids of the built-in themes, the folders in `ui/src/themes`, for
/// the CLI's `theme` commands. The window reads the same folders.
fn write_built_in_themes() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../ui/src/themes");
    println!("cargo:rerun-if-changed={}", dir.display());
    let mut ids: Vec<String> = std::fs::read_dir(&dir)
        .expect("ui/src/themes is readable")
        .filter_map(Result::ok)
        .filter(|entry| entry.path().join("theme.css").is_file())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    ids.sort();
    let out = std::path::Path::new(&std::env::var("OUT_DIR").expect("cargo sets OUT_DIR"))
        .join("built_in_themes.rs");
    let code = format!("pub const BUILT_IN_THEMES: &[&str] = &{ids:?};\n");
    std::fs::write(out, code).expect("OUT_DIR is writable");
}
