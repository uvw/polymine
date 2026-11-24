// End-to-end check of polymine-cli against a running app. It starts a named
// instance with a scratch data folder, so real settings and games stay
// untouched. It plays a seeded game through the CLI and checks the JSON replies
// and exit codes. Build first: cargo build -p polymine -p polymine-cli
//
//   node hack/cli-smoke.mjs [debug|release]

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const profile = process.argv[2] ?? "debug";
const target = process.env.CARGO_TARGET_DIR ?? "target";
const exe = (name) => join(target, profile, process.platform === "win32" ? `${name}.exe` : name);
const instance = `smoke-${process.pid}`;
const data = mkdtempSync(join(tmpdir(), "polymine-smoke-"));

const app = spawn(exe("polymine"), [], {
  env: { ...process.env, POLYMINE_INSTANCE: instance, POLYMINE_DATA_DIR: data },
  stdio: "ignore",
});

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: ${detail}`}`);
  if (!ok) failures++;
}

function cli(...args) {
  const run = spawnSync(exe("polymine-cli"), ["--instance", instance, "--compact", ...args], {
    encoding: "utf8",
  });
  const parse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  return { code: run.status, out: parse(run.stdout), err: parse(run.stderr) };
}

// Where the instance registers and listens. Killing the app skips its exit
// handler, which would remove both, so the script does.
const paths = cli("paths").out;

try {
  let ready = cli("status");
  for (let i = 0; i < 60 && ready.code !== 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    ready = cli("status");
  }
  check("the instance answers", ready.code === 0, JSON.stringify(ready));
  check("it is the named instance", ready.out?.instance === instance, JSON.stringify(ready.out));

  const board = cli("new", "--tiling", "square", "--level", "beginner", "--seed", "42");
  check("a seeded game starts", board.out?.status === "ready", JSON.stringify(board.out));
  check("the board has 100 cells", board.out?.cells?.length === 100, board.out?.cells?.length);

  const opened = cli("open", "55");
  check("opening a cell plays", opened.out?.status === "playing", JSON.stringify(opened.out));

  const after = cli("board", "--fields", "cells.id,cells.state");
  check(
    "the cell shows open",
    after.out?.cells?.[55]?.state === "open",
    JSON.stringify(after.out?.cells?.[55]),
  );
  const closed = after.out?.cells?.find((c) => c.state === "closed")?.id;

  const flagged = cli("flag", String(closed));
  check(
    "a flag goes on",
    flagged.out?.cells?.[0]?.state === "flagged",
    JSON.stringify(flagged.out),
  );

  const step = cli("step");
  check(
    "the assistant moves",
    typeof step.out?.suggestion?.cell === "number",
    JSON.stringify(step.out),
  );

  const themed = cli("theme", "use", "graphite");
  check("a theme switch lands", themed.out?.theme === "graphite", JSON.stringify(themed));
  const listed = cli("theme", "list", "--fields", "current");
  check("the theme list shows it", listed.out?.current === "graphite", JSON.stringify(listed));
  const unknown = cli("theme", "use", "made-up");
  check(
    "an unknown theme exits 1",
    unknown.code === 1 && unknown.err?.error?.code === "invalid_value",
    JSON.stringify(unknown),
  );

  const asked = cli("paths");
  check(
    "paths asks the instance",
    asked.out?.source === "instance" && asked.out?.dataDir === data,
    JSON.stringify(asked.out),
  );

  const bad = cli("open", "99999");
  check("a cell off the board exits 1", bad.code === 1, bad.code);
  check("it says why", bad.err?.error?.code === "invalid_cell", JSON.stringify(bad.err));

  const typo = cli("opne");
  check("a bad argument exits 2", typo.code === 2, typo.code);
  check("it says why in JSON", typo.err?.error?.code === "usage", JSON.stringify(typo.err));

  const missing = spawnSync(exe("polymine-cli"), ["--instance", `${instance}-gone`, "status"], {
    encoding: "utf8",
  });
  check("a missing instance exits 3", missing.status === 3, missing.status);
} finally {
  if (app.exitCode === null && app.signalCode === null) {
    const exited = new Promise((resolve) => app.once("exit", resolve));
    app.kill();
    await exited;
  }
  if (paths?.registry) rmSync(join(paths.registry, `${instance}.json`), { force: true });
  if (paths?.socket && process.platform !== "win32") rmSync(paths.socket, { force: true });
  // The webview's helper processes can hold its cache in the data folder for a
  // while after the app is killed. A leftover folder in the temp folder fails
  // no check.
  try {
    rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    console.log(`note: left ${data} behind (${error.code})`);
  }
}

console.log(failures === 0 ? "all checks passed" : `${failures} checks failed`);
process.exit(failures === 0 ? 0 : 1);
