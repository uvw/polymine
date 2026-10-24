/**
 * Native macOS menu bar. Windows and Linux use the toolbar's overflow menu
 * instead, as current Windows 11 apps do. Labels come from i18n; check marks
 * are pushed in through the returned function.
 */
import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import type { Level } from "./bindings";
import type { TilingId } from "./bindings";
import { t } from "./i18n";

export interface MenuActions {
  newGame(): void;
  setLevel(level: Level): void;
  customLevel(): void;
  saves(): void;
  setTiling(tiling: TilingId): void;
  statistics(): void;
  toggleSmartClick(): void;
  toggleQuestionMarks(): void;
  settings(): void;
  hint(): void;
  toggleAutoplay(): void;
  togglePause(): void;
  about(): void;
}

export interface MenuState {
  level: Level;
  tiling: TilingId;
  smartClick: boolean;
  questionMarks: boolean;
  autoplay: boolean;
}

export const LEVELS: readonly Level[] = ["beginner", "amateur", "professional", "crazy"];
export const TILINGS: readonly TilingId[] = [
  "square",
  "offsetSquare",
  "herringbone",
  "pinwheel",
  "kite",
  "trapezoid",
  "trapezoidTriangle",
  "trapezoidHexagon",
  "triangle",
  "offsetTriangle",
  "rightTriangle",
  "obtuseTriangle",
  "cairo",
  "floret",
  "hexagon",
  "snubSquare",
  "squareTriangle",
  "squareTriangleHexagon",
];

type Predefined = Parameters<typeof PredefinedMenuItem.new>[0] extends { item: infer I } | undefined
  ? I
  : never;

export async function installMacMenu(actions: MenuActions): Promise<(state: MenuState) => void> {
  const predefined = (item: Predefined) => PredefinedMenuItem.new({ item });
  const item = (text: string, action: () => void, accelerator?: string) =>
    MenuItem.new({ text, action, ...(accelerator ? { accelerator } : {}) });
  const check = (text: string, action: () => void, accelerator?: string) =>
    CheckMenuItem.new({ text, checked: false, action, ...(accelerator ? { accelerator } : {}) });

  const levelItems = await Promise.all(
    LEVELS.map((level) => check(t(`level.${level}`), () => actions.setLevel(level))),
  );
  const customItem = await check(t("menu.customLevel"), actions.customLevel);
  const tilingItems = await Promise.all(
    TILINGS.map((tiling) => check(t(`tiling.${tiling}`), () => actions.setTiling(tiling))),
  );
  const smartClick = await check(t("menu.smartClick"), actions.toggleSmartClick);
  const questionMarks = await check(t("menu.questionMarks"), actions.toggleQuestionMarks);
  const autoplay = await check(t("menu.autoplay"), actions.toggleAutoplay, "B");

  const menu = await Menu.new({
    items: [
      await Submenu.new({
        text: t("app.title"),
        items: [
          await item(t("menu.about"), actions.about),
          await predefined("Separator"),
          await item(t("menu.settings"), actions.settings, "Cmd+,"),
          await predefined("Separator"),
          await predefined("Services"),
          await predefined("Separator"),
          await predefined("Hide"),
          await predefined("HideOthers"),
          await predefined("ShowAll"),
          await predefined("Separator"),
          await predefined("Quit"),
        ],
      }),
      await Submenu.new({
        text: t("menu.game"),
        items: [
          await item(t("menu.newGame"), actions.newGame, "Cmd+N"),
          await item(t("menu.saves"), actions.saves, "Cmd+S"),
          await item(t("menu.pause"), actions.togglePause, "P"),
          await predefined("Separator"),
          ...levelItems,
          customItem,
          await predefined("Separator"),
          await item(t("menu.statistics"), actions.statistics),
        ],
      }),
      // Without an Edit menu, Cmd+C and Cmd+V stop working in text fields.
      await Submenu.new({
        text: t("menu.edit"),
        items: [
          await predefined("Undo"),
          await predefined("Redo"),
          await predefined("Separator"),
          await predefined("Cut"),
          await predefined("Copy"),
          await predefined("Paste"),
          await predefined("SelectAll"),
        ],
      }),
      await Submenu.new({ text: t("menu.tiling"), items: tilingItems }),
      await Submenu.new({ text: t("menu.options"), items: [smartClick, questionMarks] }),
      await Submenu.new({
        text: t("menu.assistant"),
        items: [await item(t("menu.hint"), actions.hint, "H"), autoplay],
      }),
      await Submenu.new({
        text: t("menu.window"),
        items: [
          await predefined("Minimize"),
          await predefined("Maximize"),
          await predefined("Separator"),
          await predefined("Fullscreen"),
          await predefined("Separator"),
          await predefined("BringAllToFront"),
        ],
      }),
    ],
  });
  await menu.setAsAppMenu();

  return (state: MenuState) => {
    LEVELS.forEach((level, i) => void levelItems[i]?.setChecked(state.level === level));
    void customItem.setChecked(state.level === "custom");
    TILINGS.forEach((tiling, i) => void tilingItems[i]?.setChecked(state.tiling === tiling));
    void smartClick.setChecked(state.smartClick);
    void questionMarks.setChecked(state.questionMarks);
    void autoplay.setChecked(state.autoplay);
  };
}
