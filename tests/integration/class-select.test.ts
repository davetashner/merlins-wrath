// @vitest-environment happy-dom
// mw-e19.5: the new-game class selection screen over the real class data, driven by UI intents the
// way the keyboard and gamepad drive it, applying the chosen class to a fresh player. These per-class
// tests unlock every class, as a debug build's ?allclasses does; mw-e01.15's tests below use the game
// configuration's playable classes (the Knight only in m1).
import { loadGameContent, PLAYER_CLASSES } from '@content/index';
import { markExercised } from '@content/testing';
import { createCapabilityRegistry } from '@game/capabilities';
import {
  applyClass,
  classCards,
  createClassRules,
  isPlayerClass,
  kitModel,
  playableClasses,
} from '@game/classes';
import { classOf, World } from '@sim/index';
import { CLASS_SELECT_TEXT, lockedText, openClassSelect } from '@ui/class-select';
import { UiRoot } from '@ui/screens';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const content = loadGameContent();
const ALL = new Set<string>(PLAYER_CLASSES);
let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true });
});

describe('class selection (mw-e19.5)', () => {
  it('AC-2: confirm is disabled while no class is highlighted', ({ task }) => {
    const onConfirm = vi.fn();
    const cards = classCards(content, ALL);
    for (const card of cards) markExercised(task, 'class', card.id);
    const select = openClassSelect(ui, { cards, onConfirm });

    expect(document.querySelectorAll('[role="radio"]')).toHaveLength(4);
    expect(select.highlighted).toBeUndefined();
    expect(select.confirm.disabled).toBe(true);
    // Disabled controls are not focus targets: navigating never lands on Confirm…
    for (const step of ['down', 'down', 'right', 'next'] as const) ui.intent(step, 'keyboard');
    expect(document.activeElement).not.toBe(select.confirm);
    // …and pressing it does nothing.
    select.confirm.click();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(ui.top?.id).toBe('class-select');
    expect(select.confirm.disabled).toBe(true);
  });

  it('highlighting the sorcerer and confirming applies the sorcerer to a fresh player', ({
    task,
  }) => {
    markExercised(task, 'class', 'sorcerer');
    const world = new World({ seed: 9 });
    const player = world.spawn();
    const rules = createClassRules(content, createCapabilityRegistry(content, true));
    const select = openClassSelect(ui, {
      cards: classCards(content, ALL),
      onConfirm: (id) => {
        if (isPlayerClass(id)) applyClass(world, player, id, rules);
      },
    });
    document.querySelector<HTMLElement>('[data-class="sorcerer"]')?.focus();
    ui.intent('confirm', 'gamepad');
    expect(select.highlighted).toBe('sorcerer');
    ui.intent('confirm', 'gamepad');
    expect(classOf(world, player)).toBe('sorcerer');
    expect(kitModel(world, player, content)?.items.map(({ label }) => label)).toEqual([
      'Ash staff',
      'Travelling robe',
      'Mana draught',
    ]);
    expect(ui.top).toBeUndefined();
  });
});

describe('locked classes (mw-e01.15)', () => {
  /** The class select screen as the game opens it: the game configuration's playable classes. */
  function openFromConfig(onConfirm = vi.fn()) {
    const playable = playableClasses(content, '?newgame', false);
    return openClassSelect(ui, { cards: classCards(content, playable), onConfirm });
  }
  const card = (id: string): HTMLElement => {
    const el = document.querySelector<HTMLElement>(`[data-class="${id}"]`);
    if (el === null) throw new Error(`no ${id} card`);
    return el;
  };

  it('AC-1: with playableClasses ["knight"], four cards show, Knight focused, three locked with the reason', ({
    task,
  }) => {
    markExercised(task, 'game', 'game');
    openFromConfig();
    expect(document.querySelectorAll('[role="radio"]')).toHaveLength(4);
    expect(document.activeElement).toBe(card('knight'));
    expect(card('knight').hasAttribute('data-locked')).toBe(false);
    expect(card('knight').querySelector('[data-part="lock"]')).toBeNull();
    for (const id of ['archer', 'sorcerer', 'thief']) {
      const locked = card(id);
      expect(locked.hasAttribute('data-locked')).toBe(true);
      expect(locked.getAttribute('aria-disabled')).toBe('true');
      expect(locked.getAttribute('tabindex')).toBe('0');
      expect(locked.querySelector('[data-part="lock"]')?.textContent).toBe(
        CLASS_SELECT_TEXT.lockBadge,
      );
      // The reason is the card's accessible description, so a screen reader announces it.
      const reason = document.getElementById(locked.getAttribute('aria-describedby') ?? '');
      expect(reason?.textContent).toBe('Not playable in this build yet');
      expect(locked.contains(reason)).toBe(true);
      // Name, pitch and the three signature verbs stay.
      expect(locked.querySelector('h2')?.textContent).toBe(content.get('class', id).name);
      expect(locked.querySelectorAll('[data-verbs] li')).toHaveLength(3);
    }
  });

  it.each(['keyboard', 'gamepad', 'mouse'] as const)(
    'AC-2: confirm (%s) on a locked card starts nothing and Confirm reports disabled with the reason',
    (device) => {
      const onConfirm = vi.fn();
      const select = openFromConfig(onConfirm);
      // Highlight the knight first, so Confirm is enabled until a locked card takes focus.
      ui.intent('confirm', 'keyboard');
      expect(select.highlighted).toBe('knight');
      expect(select.confirm.disabled).toBe(false);

      // happy-dom has no layout for spatial navigation, so focus moves directly (e2e covers arrows).
      card('archer').focus();
      if (device === 'mouse') card('archer').click();
      else ui.intent('confirm', device);

      expect(select.highlighted).toBe('knight');
      expect(card('archer').getAttribute('aria-checked')).toBe('false');
      expect(select.confirm.disabled).toBe(true);
      expect(select.confirm.title).toBe(CLASS_SELECT_TEXT.lockReason);
      expect(
        document.getElementById(select.confirm.getAttribute('aria-describedby') ?? '')?.textContent,
      ).toBe(CLASS_SELECT_TEXT.lockReason);
      expect(document.querySelector('[data-testid="class-select-status"]')?.textContent).toBe(
        lockedText('Archer'),
      );
      select.confirm.click();
      expect(onConfirm).not.toHaveBeenCalled();
      expect(ui.top?.id).toBe('class-select');

      // Back on the knight, Confirm is enabled again and starts the knight's run.
      card('knight').focus();
      expect(select.confirm.disabled).toBe(false);
      expect(select.confirm.hasAttribute('aria-describedby')).toBe(false);
      ui.intent('confirm', device === 'mouse' ? 'keyboard' : device);
      ui.intent('confirm', device === 'mouse' ? 'keyboard' : device);
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith('knight');
    },
  );
});
