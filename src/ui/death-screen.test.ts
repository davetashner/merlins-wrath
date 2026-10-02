// @vitest-environment happy-dom
// The death screen and save notices (mw-e30.7): what they offer, where focus starts, that Back never
// strands the player, and the playtime / age formats the save list uses.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEATH_SCREEN,
  formatAge,
  formatPlaytime,
  LOADING_SCREEN,
  openDeathScreen,
  openLoadingScreen,
  openSaveNotice,
  SAVE_NOTICE_SCREEN,
} from '@ui/death-screen';
import { UiRoot } from '@ui/screens';

let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true });
});

const visibleButtons = (): string[] =>
  [...document.querySelectorAll('button')]
    .filter((b) => b.closest('[hidden]') === null)
    .map((b) => b.textContent);

describe('death screen', () => {
  it('pauses the sim, captures input and, with saves, focuses Load last save', () => {
    const onLoad = vi.fn();
    const saves = [
      { id: 'manual-1', title: 'Manual save 1', detail: 'testbed · just now' },
      { id: 'auto-1', title: 'Autosave 1', detail: 'testbed · 5 min ago' },
    ];
    const screen = openDeathScreen(ui, { saves, onLoad, onRestart: vi.fn() });
    expect(screen.id).toBe(DEATH_SCREEN);
    expect(ui.pausesSim && ui.capturesInput).toBe(true);
    expect(screen.element.getAttribute('aria-label')).toBe('You died');
    expect(visibleButtons()).toEqual(['Load last save', 'Load…']);
    expect(document.activeElement?.textContent).toBe('Load last save');
    (document.activeElement as HTMLElement).click();
    expect(onLoad).toHaveBeenCalledWith(saves[0]);

    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Load…')?.click();
    expect(visibleButtons()).toEqual([
      'Manual save 1 · testbed · just now',
      'Autosave 1 · testbed · 5 min ago',
      'Back',
    ]);
    document.querySelector<HTMLElement>('[data-save="auto-1"]')?.click();
    expect(onLoad).toHaveBeenLastCalledWith(saves[1]);
  });

  it('without saves offers only Restart area, focused', () => {
    const onRestart = vi.fn();
    openDeathScreen(ui, { saves: [], onLoad: vi.fn(), onRestart });
    expect(visibleButtons()).toEqual(['Restart area']);
    expect(document.activeElement?.textContent).toBe('Restart area');
    ui.intent('confirm', 'keyboard');
    expect(onRestart).toHaveBeenCalledOnce();
    ui.intent('back', 'keyboard');
    expect(ui.top?.id).toBe(DEATH_SCREEN);
  });
});

describe('save notices', () => {
  it('pauses the sim until acknowledged; every action closes it and Back counts as the first', async () => {
    const second = vi.fn();
    const closed = openSaveNotice(ui, {
      title: 'Save restored',
      body: 'Loaded the backup.',
      actions: [{ label: 'Continue' }, { label: 'Other', onPress: second }],
    });
    expect(ui.top?.id).toBe(SAVE_NOTICE_SCREEN);
    expect(ui.pausesSim).toBe(true);
    expect(document.activeElement?.textContent).toBe('Continue');
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Other')?.click();
    await closed;
    expect(second).toHaveBeenCalledOnce();
    expect(ui.screens).toHaveLength(0);

    const again = openSaveNotice(ui, { title: 'T', body: 'B', actions: [{ label: 'OK' }] });
    ui.intent('back', 'keyboard');
    await again;
    expect(ui.screens).toHaveLength(0);
  });

  it('a notice without actions stays open on Back', () => {
    void openSaveNotice(ui, { title: 'T', body: 'B', actions: [] });
    ui.intent('back', 'keyboard');
    expect(ui.top?.id).toBe(SAVE_NOTICE_SCREEN);
  });

  it('the loading screen holds the sim and ignores Back until closed', () => {
    const loading = openLoadingScreen(ui);
    expect(ui.pausesSim).toBe(true);
    ui.intent('back', 'keyboard');
    expect(ui.top?.id).toBe(LOADING_SCREEN);
    loading.close();
    expect(ui.screens).toHaveLength(0);
  });
});

describe('formats', () => {
  it('formats playtime as m:ss or h:mm:ss', () => {
    expect([0, 59.9, 125, 3725, -4].map(formatPlaytime)).toEqual([
      '0:00',
      '0:59',
      '2:05',
      '1:02:05',
      '0:00',
    ]);
  });

  it('formats an age coarsely', () => {
    const min = 60_000;
    expect(
      [-5, 30_000, 5 * min, 59 * min, 3 * 60 * min, 24 * 60 * min, 72 * 60 * min].map(formatAge),
    ).toEqual([
      'just now',
      'just now',
      '5 min ago',
      '59 min ago',
      '3 h ago',
      '1 day ago',
      '3 days ago',
    ]);
  });
});
