// Which save menu boot opens (mw-e30.11): `?menu=title` shows the title menu over the freshly built
// area (the sim paused behind it), `?menu=load` and `?menu=save` the slot screens.
//
// The title screen is the game's front door (mw-e01.2): a page that names no scene, no new-game choice
// (`?newgame`, `?class=`) and no menu opens the title over the game's start scene. Any of those
// parameters skips it, so dev and e2e URLs such as `?scene=testbed` boot straight into a scene as
// before (owner decision 2026-10-03, docs/design/ui.md). The pause menu's Save and Load are mw-e01.3.

/** A save menu boot can open. */
export type SaveMenuId = 'title' | 'load' | 'save';

/** What `?menu=` asked for. */
export type SaveMenuRequest =
  | { readonly kind: 'none' }
  | { readonly kind: 'open'; readonly menu: SaveMenuId }
  | { readonly kind: 'unknown'; readonly value: string };

const MENUS: readonly string[] = ['title', 'load', 'save'];

/** The URL search parameter naming the menu. */
export const MENU_PARAM = 'menu';

/** Reads `?menu=` from a location search string. */
export function saveMenuRequest(search: string): SaveMenuRequest {
  const value = new URLSearchParams(search).get(MENU_PARAM);
  if (value === null) return { kind: 'none' };
  return MENUS.includes(value)
    ? { kind: 'open', menu: value as SaveMenuId }
    : { kind: 'unknown', value };
}

/** Parameters that boot straight into the game, skipping the title screen. */
export const SKIP_TITLE_PARAMS: readonly string[] = ['scene', 'newgame', 'class'];

/**
 * The menu boot opens: what `?menu=` asks for, or the title menu (the front door) when the page names
 * neither a menu nor any of SKIP_TITLE_PARAMS.
 */
export function bootMenuRequest(search: string): SaveMenuRequest {
  const params = new URLSearchParams(search);
  if (params.has(MENU_PARAM) || SKIP_TITLE_PARAMS.some((name) => params.has(name))) {
    return saveMenuRequest(search);
  }
  return { kind: 'open', menu: 'title' };
}

/** Whether boot opens the title menu (`?menu=title`, or the front door). */
export function opensTitle(search: string): boolean {
  const menu = bootMenuRequest(search);
  return menu.kind === 'open' && menu.menu === 'title';
}

/** The search string for leaving the menus: `?menu=` removed, `extra` applied (`''` adds a flag). */
export function searchWithoutMenu(
  search: string,
  extra: Readonly<Record<string, string>> = {},
): string {
  const params = new URLSearchParams(search);
  params.delete(MENU_PARAM);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return params.toString();
}
