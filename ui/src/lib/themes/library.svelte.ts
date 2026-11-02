/** Player themes from the data folder, kept in step with what's on disk. */
import { api } from "../api";
import type { ThemeSummary } from "../bindings";
import { RENAMED_BUILT_INS } from "./builtin";
import { warnOnce } from "./catalog";
import { isGlyphName, themeEntry } from "./entry";
import { ThemeError, type GlyphName } from "./format";
import type { SkippedTheme, ThemeEntry } from "./types";

const glyphNamesOf = (summary: ThemeSummary): GlyphName[] => summary.glyphs.filter(isGlyphName);

/** Whether `entry` still matches what the folder holds, glyph files aside. */
const unchanged = (entry: ThemeEntry, summary: ThemeSummary) =>
  entry.css === summary.css &&
  entry.preview === (summary.preview ?? null) &&
  entry.glyphNames.join() === glyphNamesOf(summary).join();

export class ThemeLibrary {
  /** Player themes that loaded, in folder name order. */
  user = $state.raw<readonly ThemeEntry[]>([]);
  /** Player themes that didn't, with the reason in the player's words. */
  skipped = $state.raw<readonly SkippedTheme[]>([]);
  /** The themes folder, when the platform has a data folder. */
  folder = $state<string | null>(null);

  constructor(private readonly builtIn: readonly ThemeEntry[]) {}

  /**
   * Reads the themes folder again. Themes that didn't change keep their
   * entries, so nothing redraws for them.
   */
  async load(): Promise<void> {
    let list;
    try {
      list = await api.listThemes();
    } catch (error) {
      warnOnce(`could not list the player's themes: ${String(error)}`);
      return;
    }
    const skipped: SkippedTheme[] = [...list.skipped];
    const skip = (id: string, reason: string) => {
      skipped.push({ id, reason });
      warnOnce(`skipped theme ${id}: ${reason}`);
    };
    const next: ThemeEntry[] = [];
    for (const summary of list.themes) {
      const { id } = summary;
      const old = this.user.find((entry) => entry.id === id);
      if (this.builtIn.some((entry) => entry.id === id) || RENAMED_BUILT_INS.has(id)) {
        skip(id, "a built-in theme has this name");
      } else if (old && unchanged(old, summary)) {
        next.push(old);
      } else {
        try {
          next.push(
            themeEntry(id, summary.css, false, {
              glyphNames: glyphNamesOf(summary),
              preview: summary.preview ?? null,
            }),
          );
        } catch (error) {
          if (!(error instanceof ThemeError)) throw error;
          skip(id, error.message);
        }
      }
    }
    const same = next.length === this.user.length && next.every((e, i) => e === this.user[i]);
    if (!same) this.user = next;
    if (JSON.stringify(skipped) !== JSON.stringify(this.skipped)) this.skipped = skipped;
    this.folder = list.folder ?? null;
  }

  /** Loads the SVG files of player theme `id`, when it has any. */
  async loadGlyphs(id: string | undefined): Promise<void> {
    const entry = this.user.find((e) => e.id === id);
    if (!entry || entry.glyphNames.length === 0) return;
    let files;
    try {
      files = await api.readTheme(entry.id);
    } catch (error) {
      warnOnce(`could not read theme ${entry.id}: ${String(error)}`);
      return;
    }
    const svgs: Partial<Record<GlyphName, string>> = {};
    for (const glyph of files.glyphs) if (isGlyphName(glyph.name)) svgs[glyph.name] = glyph.svg;
    let loaded: ThemeEntry;
    try {
      loaded = themeEntry(entry.id, files.css, false, {
        svgs,
        glyphNames: entry.glyphNames,
        preview: files.preview ?? null,
      });
    } catch (error) {
      if (!(error instanceof ThemeError)) throw error;
      warnOnce(`skipped theme ${entry.id}: ${error.message}`);
      return;
    }
    const current = this.user.find((e) => e.id === entry.id);
    const sameGlyphs = (a: ThemeEntry, b: ThemeEntry) =>
      a.css === b.css &&
      Object.keys(b.glyphs).length === Object.keys(a.glyphs).length &&
      Object.entries(b.glyphs).every(([name, g]) => a.glyphs[name as GlyphName]?.src === g.src);
    if (!current || sameGlyphs(current, loaded)) return;
    this.user = this.user.map((e) => (e === current ? loaded : e));
  }
}
