/**
 * The shell's rules for save names (`valid_name` in `src-tauri/src/saves.rs`),
 * checked as the player types. The shell checks again when it writes.
 */

export const MAX_SAVE_NAME = 40;

const BAD_CHARS = /[<>:"/\\|?*\p{Cc}]/u;
/** Names Windows reserves for devices, which no file may take. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export type SaveNameProblem = "empty" | "long" | "chars" | "reserved" | "dot";

/** What keeps `name` from naming a save, or null when it can. */
export function saveNameProblem(name: string): SaveNameProblem | null {
  const trimmed = name.trim();
  if (trimmed === "") return "empty";
  if ([...trimmed].length > MAX_SAVE_NAME) return "long";
  if (BAD_CHARS.test(trimmed)) return "chars";
  if (RESERVED.test(trimmed)) return "reserved";
  if (trimmed.endsWith(".")) return "dot";
  return null;
}

/** Whether two names land on the same file. Windows and macOS ignore case. */
export function sameSaveName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
