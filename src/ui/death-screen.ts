// The death screen (mw-e30.7) and the save notices around a reload. Shown once the player has died
// (the death beat before it is mw-e01.8). With a save to go back to it offers "Load last save"
// (focused) and "Load…", which lists every loadable save, most recent first; with none it offers
// "Restart area" instead (mw-e01.16 defines what that restarts in the slice). It pauses the sim and
// captures input, and Back never closes it: the only ways out are the choices it offers. The screen
// only reports the choice; src/game/save/death does the loading.

import { button } from './components/controls';
import { h } from './components/dom';
import type { Screen, UiRoot } from './screens';

/** `data-screen` of the death screen. */
export const DEATH_SCREEN = 'death';

/** `data-screen` of a save notice (restored backup, nothing to recover). */
export const SAVE_NOTICE_SCREEN = 'save-notice';

/** `data-screen` of the brief screen that holds the sim while a save loads. */
export const LOADING_SCREEN = 'loading';

/** One save the death screen can load. */
export interface DeathSaveEntry {
  /** Written to the list entry's `data-save` (the slot id). */
  readonly id: string;
  /** "Manual save 1", or the player's label for it. */
  readonly title: string;
  /** Area, playtime and age, already formatted. */
  readonly detail: string;
}

export interface DeathScreenOptions<T extends DeathSaveEntry> {
  /** Loadable saves, most recent first; empty offers Restart area instead. */
  readonly saves: readonly T[];
  readonly onLoad: (save: T) => void;
  readonly onRestart: () => void;
}

export const DEATH_TEXT = Object.freeze({
  heading: 'You died',
  loadLast: 'Load last save',
  loadAny: 'Load…',
  restart: 'Restart area',
  lastSave: 'Last save',
  noSave: 'There is no save to return to. Restart the area from its start.',
  chooseHeading: 'Load a save',
  back: 'Back',
});

/** Opens the death screen. Back never closes it (in the save list, Back returns to the choices). */
export function openDeathScreen<T extends DeathSaveEntry>(
  ui: UiRoot,
  options: DeathScreenOptions<T>,
): Screen {
  const { saves, onLoad, onRestart } = options;
  const last = saves[0];
  const choices = h('div', { className: 'vb-stack', data: { testid: 'death-choices' } });
  const list = h('div', { className: 'vb-stack', data: { testid: 'death-saves' } });
  list.hidden = true;
  const show = (panel: 'choices' | 'saves'): void => {
    choices.hidden = panel !== 'choices';
    list.hidden = panel !== 'saves';
    const target = panel === 'choices' ? choices : list;
    target.querySelector<HTMLElement>('button')?.focus();
  };

  if (last === undefined) {
    choices.append(
      h('p', { text: DEATH_TEXT.noSave }),
      h(
        'div',
        { className: 'vb-row' },
        button({ label: DEATH_TEXT.restart, autofocus: true, onPress: onRestart }),
      ),
    );
  } else {
    choices.append(
      h('p', { text: `${DEATH_TEXT.lastSave}: ${last.title} · ${last.detail}` }),
      h(
        'div',
        { className: 'vb-row' },
        button({
          label: DEATH_TEXT.loadLast,
          autofocus: true,
          onPress: () => {
            onLoad(last);
          },
        }),
        button({
          label: DEATH_TEXT.loadAny,
          onPress: () => {
            show('saves');
          },
        }),
      ),
    );
    const entries = saves.map((save) => {
      const entry = button({
        label: `${save.title} · ${save.detail}`,
        onPress: () => {
          onLoad(save);
        },
      });
      entry.dataset['save'] = save.id;
      return entry;
    });
    list.append(
      h('h3', { text: DEATH_TEXT.chooseHeading }),
      ...entries,
      button({
        label: DEATH_TEXT.back,
        onPress: () => {
          show('choices');
        },
      }),
    );
  }

  const content = h(
    'div',
    { className: 'vb-panel vb-stack', data: { testid: 'death-screen' } },
    h('h2', { text: DEATH_TEXT.heading }),
    choices,
    list,
  );
  return ui.push({
    id: DEATH_SCREEN,
    label: DEATH_TEXT.heading,
    content,
    modal: true,
    pausesSim: true,
    onBack: () => {
      if (!list.hidden) show('choices');
      return true;
    },
  });
}

/** One action on a save notice. */
export interface NoticeAction {
  readonly label: string;
  readonly onPress?: () => void;
}

export interface SaveNoticeOptions {
  readonly title: string;
  readonly body: string;
  /** The first is focused; every action closes the notice. */
  readonly actions: readonly NoticeAction[];
}

/**
 * A modal notice that pauses the sim until the player acknowledges it (Back counts as the first
 * action). Resolves when it closes.
 */
export function openSaveNotice(ui: UiRoot, options: SaveNoticeOptions): Promise<void> {
  return new Promise((resolve) => {
    const buttons = options.actions.map((action, index) =>
      button({
        label: action.label,
        autofocus: index === 0,
        onPress: () => {
          screen.close();
          action.onPress?.();
        },
      }),
    );
    const content = h(
      'div',
      { className: 'vb-panel vb-stack', data: { testid: 'save-notice' } },
      h('h2', { text: options.title }),
      h('p', { text: options.body }),
      h('div', { className: 'vb-row' }, ...buttons),
    );
    const screen = ui.push({
      id: SAVE_NOTICE_SCREEN,
      label: options.title,
      content,
      modal: true,
      pausesSim: true,
      onBack: () => {
        buttons[0]?.click();
        return true;
      },
      onClose: () => {
        resolve();
      },
    });
  });
}

/** Holds the sim (and input) while a save loads; close it when the load is done. */
export function openLoadingScreen(ui: UiRoot): Screen {
  return ui.push({
    id: LOADING_SCREEN,
    label: 'Loading',
    content: h('div', { className: 'vb-panel', attrs: { role: 'status' }, text: 'Loading…' }),
    modal: true,
    pausesSim: true,
    onBack: () => true,
  });
}

/** Whole seconds played as "1:02:03" or "2:03". */
export function formatPlaytime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number): string => String(n).padStart(2, '0');
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return hours > 0
    ? `${String(hours)}:${pad(minutes)}:${pad(rest)}`
    : `${String(minutes)}:${pad(rest)}`;
}

/** How long ago, coarsely: "just now", "5 min ago", "3 h ago", "2 days ago". */
export function formatAge(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${String(days)} days ago`;
}
