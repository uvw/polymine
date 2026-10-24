//! Writes `ui/src/lib/bindings/index.ts`, so the UI's types follow the Rust
//! ones on every `cargo test`.

#[test]
fn exports_typescript_bindings() {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../ui/src/lib/bindings/index.ts");
    polymine_app::export_bindings(&path).expect("could not write the TypeScript bindings");
}
