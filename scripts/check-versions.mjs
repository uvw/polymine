// Fails unless Cargo.toml, tauri.conf.json, and package.json share one
// version. Given a tag such as v0.0.2, it also fails unless the tag names that
// version. Tauri names installers after tauri.conf.json, so a missed bump would
// ship files labeled with the old version under the new tag.
//
// It also fails when a Tauri crate and its npm package disagree on major and
// minor version, which stops `tauri build`. Dependabot bumps them in separate
// pull requests, so either can land first.
//
//   node scripts/check-versions.mjs [tag]

import { readFileSync } from "node:fs";
import process from "node:process";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const cargo = /^\[workspace\.package\][\s\S]*?^version = "([^"]+)"/m.exec(read("Cargo.toml"))?.[1];
const versions = {
  "Cargo.toml": cargo,
  "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
  "package.json": JSON.parse(read("package.json")).version,
};

// Tauri crates in Cargo.lock and the npm packages that must match them.
const TAURI_PAIRS = [
  ["tauri", "@tauri-apps/api"],
  ["tauri-plugin-log", "@tauri-apps/plugin-log"],
];
const lock = read("Cargo.lock");
const npmLock = JSON.parse(read("package-lock.json")).packages;
const minor = (version) => version?.split(".").slice(0, 2).join(".");
for (const [crate, pkg] of TAURI_PAIRS) {
  const rust = new RegExp(`^name = "${crate}"\\r?\\nversion = "([^"]+)"`, "m").exec(lock)?.[1];
  const js = npmLock[`node_modules/${pkg}`]?.version;
  if (!rust || !js || minor(rust) !== minor(js)) {
    console.error(`${crate} ${rust} and ${pkg} ${js} must share a major and minor version.`);
    process.exit(1);
  }
}

const distinct = new Set(Object.values(versions));
if (distinct.size !== 1 || distinct.has(undefined)) {
  console.error("Versions disagree:", versions);
  process.exit(1);
}
const [version] = distinct;
const tag = process.argv[2];
if (tag && tag !== `v${version}`) {
  console.error(`Tag ${tag} doesn't match version ${version}; expected v${version}.`);
  process.exit(1);
}
console.log(`Version ${version}${tag ? `, tag ${tag}` : ""}: consistent.`);
