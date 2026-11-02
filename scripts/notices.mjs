// Writes the third-party notices the About dialog shows: the npm packages that
// reach the Vite bundle, the Rust crates that ship in the app and the CLI, and
// the color palettes of the themes named after editor color schemes.
// Needs cargo-about (see about.toml). CI reruns it and fails on drift.
//
//   npm run notices

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "ui/src/lib/notices/THIRD-PARTY-NOTICES.txt");
const rule = "-".repeat(80);

// Packages published without a license file, with the text from their
// upstream repository.
const LICENSE_OVERRIDES = {
  "@pixi/colord": ["scripts/notices/pixi-colord.LICENSE.md"],
  "@tauri-apps/plugin-log": [
    "scripts/notices/tauri-apps-plugin-log.LICENSE_APACHE-2.0",
    "scripts/notices/tauri-apps-plugin-log.LICENSE_MIT",
  ],
};

// Bundler runtime helpers have virtual ids; they come from these packages.
const VIRTUAL_PACKAGES = { "\0vite/": "vite", "\0rolldown/": "rolldown" };

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** The package directories behind every module that reaches the bundle. */
async function bundledPackages() {
  // The UI imports this file, so it has to exist before the first build.
  if (!existsSync(output)) writeFileSync(output, "");
  const result = await build({
    configFile: join(root, "vite.config.ts"),
    root: join(root, "ui"),
    logLevel: "warn",
    build: { write: false, emptyOutDir: false },
  });
  const dirs = new Set();
  for (const { output: files } of [result].flat()) {
    for (const file of files) {
      if (file.type !== "chunk") continue;
      for (const id of file.moduleIds) {
        if (!file.modules[id]?.renderedLength) continue;
        const dir = packageDir(id);
        if (dir) dirs.add(dir);
      }
    }
  }
  return [...dirs];
}

function packageDir(id) {
  if (id.startsWith("\0")) {
    const prefix = Object.keys(VIRTUAL_PACKAGES).find((p) => id.startsWith(p));
    if (!prefix) fail(`No package known for the virtual module ${JSON.stringify(id)}.`);
    return join(root, "node_modules", VIRTUAL_PACKAGES[prefix]);
  }
  const path = id.split("?")[0].replaceAll("\\", "/");
  const at = path.lastIndexOf("/node_modules/");
  if (at < 0) return null;
  const rest = path.slice(at + "/node_modules/".length).split("/");
  const name = rest[0].startsWith("@") ? rest.slice(0, 2).join("/") : rest[0];
  return `${path.slice(0, at)}/node_modules/${name}`;
}

function repositoryUrl(repository) {
  const url = typeof repository === "string" ? repository : repository?.url;
  if (!url) return null;
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
  return url
    .replace(/^git\+/, "")
    .replace(/^(git|ssh):\/\/(git@)?/, "https://")
    .replace(/\.git$/, "");
}

/**
 * A license text with one line ending and no runs of blank lines. Crates often
 * ship one license in several files that differ only in blank lines, and
 * cargo-about picks whichever the platform lists first, so without this the
 * notices would differ between Windows and macOS.
 */
const tidy = (text) => text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n");

/** The package's license files, minus any notices for code it doesn't bundle. */
function licenseTexts(dir, name) {
  const files = readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying)/i.test(f) && !f.endsWith(".spdx"))
    .sort()
    .map((f) => join(dir, f));
  if (files.length === 0) files.push(...(LICENSE_OVERRIDES[name] ?? []).map((f) => join(root, f)));
  if (files.length === 0) fail(`${name} has no license file; add one to LICENSE_OVERRIDES.`);
  // Vite's license file goes on to list the dependencies bundled into its
  // build tools, none of which reach the browser.
  return files.map(
    (f) => tidy(readFileSync(f, "utf8")).split(/\n# Licenses of bundled dependencies/)[0],
  );
}

/** The licenses `about.toml` accepts for crates, which hold for npm packages too. */
const ACCEPTED = new Set(
  [
    ...(
      readFileSync(join(root, "about.toml"), "utf8").match(/accepted = \[([^\]]*)\]/)?.[1] ?? ""
    ).matchAll(/"([^"]+)"/g),
  ].map((m) => m[1]),
);

/**
 * Whether an SPDX expression such as `MIT OR Apache-2.0` lets Polymine ship the
 * package: one side of an OR, and every part of an AND, must be accepted.
 */
function licenseAccepted(expression) {
  return String(expression ?? "")
    .replace(/[()]/g, "")
    .split(/\s+OR\s+/)
    .some((choice) => choice.split(/\s+AND\s+/).every((id) => ACCEPTED.has(id.trim())));
}

async function npmNotices() {
  const packages = (await bundledPackages()).map((dir) => {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return { ...pkg, dir };
  });
  for (const pkg of packages) {
    if (!licenseAccepted(pkg.license)) {
      fail(`${pkg.name} is licensed ${pkg.license}, which about.toml doesn't accept.`);
    }
  }
  packages.sort((a, b) => a.name.localeCompare(b.name, "en"));
  return packages.map((pkg) => {
    const url = repositoryUrl(pkg.repository);
    const head = `${pkg.name} ${pkg.version} (${pkg.license})${url ? `\n${url}` : ""}`;
    const texts = licenseTexts(pkg.dir, pkg.name).map((t) => t.replace(/^\s*\n/, "").trimEnd());
    return [`${rule}\n${head}`, ...texts].join("\n\n");
  });
}

// The Rust packages that ship. Other workspace members, and crates only they
// use, stay out of the notices.
const SHIPPED_MANIFESTS = ["src-tauri/Cargo.toml", "crates/polymine-cli/Cargo.toml"];

/**
 * cargo-about's license data as JSON. It writes to a file because on Windows
 * it refuses to write to a redirected stdout.
 */
function cargoAbout(args) {
  const dir = mkdtempSync(join(tmpdir(), "polymine-notices-"));
  const file = join(dir, "about.json");
  try {
    const about = spawnSync(
      "cargo",
      ["about", "generate", "--locked", "--format", "json", "-o", file, ...args],
      { cwd: root, stdio: ["ignore", "inherit", "inherit"] },
    );
    if (about.error) fail(`Could not run cargo-about: ${about.error.message}`);
    if (about.status !== 0) fail(`cargo-about failed with exit code ${about.status}.`);
    return JSON.parse(readFileSync(file, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// cargo-about's Handlebars templates HTML-escape names, and the committed
// notices carry that escaping.
const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "`": "&#x60;",
  "=": "&#x3D;",
};
const escape = (text) => String(text).replace(/[&<>"'`=]/g, (c) => HTML_ESCAPES[c]);

function licenseNotice({ name, id, text, used_by: usedBy }) {
  const crates = usedBy.map(({ crate: { name, version } }) => {
    const [n, v] = [escape(name), escape(version)];
    return `- ${n} ${v}: https://crates.io/crates/${n}/${v}\n`;
  });
  const mpl =
    id === "MPL-2.0"
      ? "\nPolymine uses these crates unmodified. Their source code is available at the\n" +
        "crates.io links above" +
        usedBy
          .filter(({ crate }) => crate.repository)
          .map(({ crate }) => ` and at ${escape(crate.repository)}`)
          .join("") +
        ".\n"
      : "";
  return `${rule}\n${escape(name)} (${escape(id)})\n\nUsed by:\n${crates.join("")}${mpl}\n${tidy(text)}\n`;
}

function rustNotices() {
  const shipped = new Set(
    SHIPPED_MANIFESTS.flatMap((manifest) =>
      cargoAbout(["--manifest-path", manifest]).crates.map(({ package: pkg }) => pkg.id),
    ),
  );
  // One run over the whole workspace keeps cargo-about's grouping and order.
  return cargoAbout(["--workspace"])
    .licenses.map((license) => ({
      ...license,
      used_by: license.used_by.filter(({ crate }) => shipped.has(crate.id)),
    }))
    .filter((license) => license.used_by.length > 0)
    .map(licenseNotice)
    .join("")
    .trim();
}

// Color schemes whose colors the built-in themes of the same names use, with
// the license each palette's source carries.
const THEME_PALETTES = [
  {
    themes: "Atom One Dark and Atom One Light",
    palette: "Atom's One Dark and One Light syntax and UI themes, by GitHub's Atom team",
    url: "https://github.com/atom/atom/tree/master/packages",
    license: "MIT",
    files: ["scripts/notices/palettes/atom.LICENSE"],
  },
  {
    themes: "One Dark Pro",
    palette: "One Dark Pro, by Binaryify",
    url: "https://github.com/Binaryify/OneDark-Pro",
    license: "MIT",
    files: ["scripts/notices/palettes/onedark-pro.LICENSE"],
  },
  {
    themes: "Dracula and Alucard",
    palette:
      "Dracula and its light theme Alucard Classic, by Zeno Rocha and the Dracula Theme team",
    url: "https://draculatheme.com/spec, https://github.com/dracula/visual-studio-code, and https://github.com/dracula/dracula-theme",
    license: "MIT",
    files: [
      "scripts/notices/palettes/dracula-visual-studio-code.LICENSE",
      "scripts/notices/palettes/dracula-theme.LICENSE",
    ],
  },
  {
    themes: "Monokai and Monokai Light",
    palette: "Monokai, the 2006 TextMate theme by Wimer Hazenberg",
    url: "https://web.archive.org/web/20070226173053/http://www.monokai.nl/blog/wp-content/asdev/Monokai.tmTheme",
    note: "The theme file carries no license. Polymine uses its color values only.",
  },
  {
    themes: "GitHub Dark and GitHub Light",
    palette: "GitHub's VS Code theme, Dark Default and Light Default, on Primer primitives",
    url: "https://github.com/primer/github-vscode-theme and https://github.com/primer/primitives",
    license: "MIT",
    files: [
      "scripts/notices/palettes/github-vscode-theme.LICENSE",
      "scripts/notices/palettes/primer-primitives.LICENSE",
    ],
  },
  {
    themes: "Solarized Dark and Solarized Light",
    palette: "Solarized, by Ethan Schoonover",
    url: "https://ethanschoonover.com/solarized/",
    license: "MIT",
    files: ["scripts/notices/palettes/solarized.LICENSE"],
  },
  {
    themes: "Catppuccin Latte",
    palette: "Catppuccin's Latte palette, by the Catppuccin project",
    url: "https://github.com/catppuccin/palette",
    license: "MIT",
    files: ["scripts/notices/palettes/catppuccin-palette.LICENSE"],
  },
];

function paletteNotices() {
  return THEME_PALETTES.map(({ themes, palette, url, license, files = [], note }) => {
    const head = `${themes}\n${palette}${license ? ` (${license})` : ""}\n${url}`;
    const texts = files.map((f) => readFileSync(join(root, f), "utf8").trim());
    return [`${rule}\n${head}`, ...(note ? [note] : []), ...texts].join("\n\n");
  });
}

const npm = await npmNotices();
const rust = rustNotices();
const palettes = paletteNotices();
const text = [
  "Third-party notices for Polymine",
  "Polymine includes the open source software listed below, under the licenses\n" +
    "that follow. This file is generated by `npm run notices`.",
  `${"=".repeat(80)}\nWeb UI: npm packages\n${"=".repeat(80)}`,
  ...npm,
  `${"=".repeat(80)}\nApp and command line: Rust crates\n${"=".repeat(80)}`,
  rust,
  `${"=".repeat(80)}\nTheme palettes\n${"=".repeat(80)}`,
  "These built-in themes use the colors of the editor color schemes they are\n" + "named after.",
  ...palettes,
]
  .join("\n\n")
  .replaceAll("\r\n", "\n");
writeFileSync(output, `${text}\n`);
console.log(`Wrote ${npm.length} npm packages and the Rust crates to ${output}.`);
