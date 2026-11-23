/**
 * The backend as the UI sees it. `commands` comes from the generated
 * bindings; this is the only module that calls into them.
 */
import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { commands, type ExternalChange, type UpdateProgress } from "./bindings";

export const hasShell = isTauri;

export const api = {
  /** Changes made from outside the window, by `polymine-cli`. */
  onExternalChange: (handler: (change: ExternalChange) => void): Promise<UnlistenFn> =>
    listen<ExternalChange>("polymine://external", (event) => handler(event.payload)),
  /** How far an update's download has come, while one installs. */
  onUpdateProgress: (handler: (progress: UpdateProgress) => void): Promise<UnlistenFn> =>
    listen<UpdateProgress>("polymine://update-progress", (event) => handler(event.payload)),
  environment: commands.getEnvironment,
  accent: commands.getAccent,
  windowInFront: commands.windowInFront,
  setTaskbarIcon: commands.setTaskbarIcon,
  setMaterial: commands.setMaterial,
  snapshot: commands.snapshot,
  tilingPreviews: commands.tilingPreviews,
  newGame: commands.newGame,
  primary: commands.primary,
  secondary: commands.secondary,
  hint: commands.hint,
  assist: commands.assist,
  setPaused: commands.setPaused,
  getSettings: commands.getSettings,
  updateSettings: commands.updateSettings,
  getStats: commands.getStats,
  fitBoard: commands.fitBoard,
  listSaves: commands.listSaves,
  saveAs: commands.saveAs,
  loadSave: commands.loadSave,
  deleteSave: commands.deleteSave,
  listThemes: commands.listThemes,
  readTheme: commands.readTheme,
  openThemesFolder: commands.openThemesFolder,
  checkForUpdate: commands.checkForUpdate,
  installUpdate: commands.installUpdate,
  openReleaseNotes: commands.openReleaseNotes,
  openRepository: commands.openRepository,
};
