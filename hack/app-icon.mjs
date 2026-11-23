// Regenerates the app's icons in src-tauri/icons from ui/public/icon.svg, then
// puts ui/public/icon-small.svg into icon.ico's 16 and 24 pixel slots, where
// the full mine blurs into a blob.
//
//   node hack/app-icon.mjs

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const SMALL_SIZES = [16, 24];
const icons = "src-tauri/icons";

// Runs the Tauri CLI's script with node directly, so no shell parses the paths.
function tauriIcon(args) {
  const cli = join("node_modules", "@tauri-apps", "cli", "tauri.js");
  const run = spawnSync(process.execPath, [cli, "icon", ...args], { stdio: "inherit" });
  if (run.status !== 0) process.exit(run.status ?? 1);
}

tauriIcon(["ui/public/icon.svg"]);
// `tauri icon` also writes mobile icons, which this desktop app doesn't ship.
for (const folder of ["android", "ios"]) {
  rmSync(join(icons, folder), { recursive: true, force: true });
}

const small = mkdtempSync(join(tmpdir(), "polymine-icon-"));
tauriIcon(["ui/public/icon-small.svg", "-o", small, ...SMALL_SIZES.flatMap((n) => ["-p", `${n}`])]);

// An .ico is a 6-byte header, a 16-byte entry per image, then the images, each
// a PNG here. Width and height bytes are 0 for 256.
const ico = readFileSync(join(icons, "icon.ico"));
const count = ico.readUInt16LE(4);
const images = Array.from({ length: count }, (_, i) => {
  const entry = ico.subarray(6 + 16 * i, 22 + 16 * i);
  const size = entry[0] || 256;
  const data = SMALL_SIZES.includes(size)
    ? readFileSync(join(small, `${size}x${size}.png`))
    : ico.subarray(entry.readUInt32LE(12), entry.readUInt32LE(12) + entry.readUInt32LE(8));
  return { entry: Buffer.from(entry), data };
});
rmSync(small, { recursive: true, force: true });

let offset = 6 + 16 * count;
for (const image of images) {
  image.entry.writeUInt32LE(image.data.length, 8);
  image.entry.writeUInt32LE(offset, 12);
  offset += image.data.length;
}
writeFileSync(
  join(icons, "icon.ico"),
  Buffer.concat([ico.subarray(0, 6), ...images.map((i) => i.entry), ...images.map((i) => i.data)]),
);
console.log(
  `Wrote ${icons}, with icon-small.svg at ${SMALL_SIZES.join(" and ")} pixels in icon.ico.`,
);
