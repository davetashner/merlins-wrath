// @vitest-environment happy-dom
// The class selection screen (mw-e19.5): the cards it shows, highlighting with confirm or a click,
// Confirm disabled until a class is highlighted, and Back never leaving a new game without a class.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLASS_SELECT_SCREEN,
  CLASS_SELECT_TEXT,
  highlightedText,
  openClassSelect,
  type ClassCardModel,
} from '@ui/class-select';
import { UiRoot } from '@ui/screens';
import { find } from '@ui/testing/layout';

let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true });
});

const CARDS: readonly ClassCardModel[] = [
  {
    id: 'knight',
    name: 'Knight',
    pitch: 'Steel.',
    verbs: ['Parry', 'Bash', 'Plate'],
    kit: ['Sword'],
  },
  {
    id: 'thief',
    name: 'Thief',
    pitch: 'Shadows.',
    verbs: ['Pick', 'Lift', 'Climb'],
    kit: ['Knife', '40 gold'],
  },
];

const card = (id: string): HTMLElement => find(`[data-class="${id}"]`);
const texts = (selector: string, root: ParentNode): string[] =>
  [...root.querySelectorAll(selector)].map((el) => el.textContent);

describe('class selection screen', () => {
  it('shows a card per class with its pitch, verbs and kit, focused on the first', () => {
    const select = openClassSelect(ui, { cards: CARDS, onConfirm: vi.fn() });
    expect(select.screen.id).toBe(CLASS_SELECT_SCREEN);
    expect(ui.pausesSim && ui.capturesInput).toBe(true);
    expect(find('[role="radiogroup"]').getAttribute('aria-label')).toBe(CLASS_SELECT_TEXT.group);
    const thief = card('thief');
    expect(thief.getAttribute('role')).toBe('radio');
    expect(document.getElementById(thief.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
      'Thief',
    );
    expect(texts('p', thief)).toEqual(['Shadows.']);
    expect(texts('[data-verbs] li', thief)).toEqual(['Pick', 'Lift', 'Climb']);
    expect(texts('[data-kit] li', thief)).toEqual(['Knife', '40 gold']);
    expect(document.activeElement).toBe(card('knight'));
    expect(select.highlighted).toBeUndefined();
    expect(find('[data-testid="class-select-status"]').textContent).toBe(CLASS_SELECT_TEXT.none);
  });

  it('highlights the focused card on confirm and moves focus to an enabled Confirm', () => {
    const onConfirm = vi.fn();
    const select = openClassSelect(ui, { cards: CARDS, onConfirm });
    expect(select.confirm.disabled).toBe(true);
    ui.intent('confirm', 'gamepad');
    expect(select.highlighted).toBe('knight');
    expect(card('knight').getAttribute('aria-checked')).toBe('true');
    expect(select.confirm.disabled).toBe(false);
    expect(document.activeElement).toBe(select.confirm);
    expect(find('[data-testid="class-select-status"]').textContent).toBe(highlightedText('Knight'));

    // A click highlights another; only one card is checked.
    card('thief').click();
    expect(select.highlighted).toBe('thief');
    expect(card('knight').getAttribute('aria-checked')).toBe('false');
    expect(onConfirm).not.toHaveBeenCalled();

    ui.intent('confirm', 'gamepad');
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('thief');
    expect(ui.top).toBeUndefined();
  });

  it('keeps Confirm inert while nothing is highlighted, and Back never closes the screen', () => {
    const onConfirm = vi.fn();
    const select = openClassSelect(ui, { cards: CARDS, onConfirm });
    select.confirm.disabled = false; // even a forced press does nothing without a highlight
    select.confirm.click();
    expect(onConfirm).not.toHaveBeenCalled();
    ui.intent('back', 'keyboard');
    expect(ui.top?.id).toBe(CLASS_SELECT_SCREEN);
  });

  it('opens with no cards without a focus target', () => {
    const select = openClassSelect(ui, { cards: [], onConfirm: vi.fn() });
    expect(select.confirm.disabled).toBe(true);
    expect(document.querySelectorAll('[role="radio"]')).toHaveLength(0);
  });
});
