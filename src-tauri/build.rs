fn main() {
    tauri_build::build();
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
