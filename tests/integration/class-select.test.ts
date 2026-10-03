// @vitest-environment happy-dom
// mw-e19.5: the new-game class selection screen over the real class data, driven by UI intents the
// way the keyboard and gamepad drive it, applying the chosen class to a fresh player.
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { createCapabilityRegistry } from '@game/capabilities';
import { applyClass, classCards, createClassRules, isPlayerClass, kitModel } from '@game/classes';
import { classOf, World } from '@sim/index';
import { openClassSelect } from '@ui/class-select';
import { UiRoot } from '@ui/screens';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const content = loadGameContent();
let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true });
});

describe('class selection (mw-e19.5)', () => {
  it('AC-2: confirm is disabled while no class is highlighted', ({ task }) => {
    const onConfirm = vi.fn();
    const cards = classCards(content);
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
      cards: classCards(content),
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
