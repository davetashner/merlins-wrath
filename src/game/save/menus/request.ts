// Which save menu boot opens (mw-e30.11): `?menu=title` shows the title menu over the freshly built
// area (the sim paused behind it), `?menu=load` and `?menu=save` the slot screens. The title screen
// becoming the game's front door is mw-e01.2 and the pause menu's Save and Load are mw-e01.3; until
// then this is how players and the e2e reach the screens.

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
