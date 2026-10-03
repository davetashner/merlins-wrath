// The new-game class selection screen (mw-e19.5). One card per class, each with its short pitch, its
// three signature verbs and a preview of its starting kit. Grey-box styling: the class card art and
// emblems are mw-e37.125.
//
// Cards are a radio group: directions move focus between them (and to Confirm) through the kit's
// spatial navigation, and confirm or a click highlights the focused card (aria-checked) and moves
// focus to Confirm, so a gamepad player picks a class with A, A. Confirm stays disabled, and so
// unreachable, until a class is highlighted; pressing it reports the class and closes the screen.
// The screen pauses the sim and captures input, and Back never closes it: a new game needs a class.
// It only reports the choice; src/game/classes.ts applies it.

import { button } from './components/controls';
import { h } from './components/dom';
import type { Screen, UiRoot } from './screens';

/** `data-screen` of the class selection screen. */
export const CLASS_SELECT_SCREEN = 'class-select';

/** What one class card shows. */
export interface ClassCardModel {
  /** The class id, written to the card's `data-class`. */
  readonly id: string;
  readonly name: string;
  readonly pitch: string;
  /** The signature verbs, e.g. "Parry". */
  readonly verbs: readonly string[];
  /** The starting kit, one line per entry, e.g. "Mana draught ×2". */
  readonly kit: readonly string[];
}

export interface ClassSelectOptions {
  /** The cards, in the order shown. */
  readonly cards: readonly ClassCardModel[];
  /** The player confirmed the highlighted class (the screen has closed). */
  readonly onConfirm: (id: string) => void;
}

export interface ClassSelect {
  readonly screen: Screen;
  /** The Confirm button (disabled until a class is highlighted). */
  readonly confirm: HTMLButtonElement;
  /** The highlighted class, if any. */
  readonly highlighted: string | undefined;
}

export const CLASS_SELECT_TEXT = Object.freeze({
  heading: 'Choose your class',
  hint: 'Highlight a class, then confirm. The choice lasts the whole journey.',
  group: 'Classes',
  verbs: 'Signature verbs',
  kit: 'Starting kit',
  confirm: 'Confirm',
  none: 'No class highlighted',
});

/** The live status line: which class is highlighted. */
export const highlightedText = (name: string): string => `${name} highlighted`;

/** Opens the class selection screen. */
export function openClassSelect(ui: UiRoot, options: ClassSelectOptions): ClassSelect {
  let highlighted: string | undefined;
  const status = h('p', {
    text: CLASS_SELECT_TEXT.none,
    attrs: { role: 'status' },
    data: { testid: 'class-select-status' },
  });
  const confirm = button({
    label: CLASS_SELECT_TEXT.confirm,
    disabled: true,
    onPress: () => {
      if (highlighted === undefined) return;
      const chosen = highlighted;
      screen.close();
      options.onConfirm(chosen);
    },
  });
  confirm.dataset['testid'] = 'class-confirm';

  const cards = options.cards.map((card) => {
    const titleId = `vb-class-${card.id}-name`;
    const element = h(
      'div',
      {
        className: 'vb-class-card vb-stack',
        attrs: {
          role: 'radio',
          'aria-checked': 'false',
          'aria-labelledby': titleId,
          tabindex: '0',
        },
        data: { class: card.id, uiComponent: 'class-card' },
      },
      h('h2', { text: card.name, attrs: { id: titleId } }),
      h('p', { text: card.pitch }),
      h('h3', { text: CLASS_SELECT_TEXT.verbs }),
      h('ul', { data: { verbs: '' } }, ...card.verbs.map((verb) => h('li', { text: verb }))),
      h('h3', { text: CLASS_SELECT_TEXT.kit }),
      h('ul', { data: { kit: '' } }, ...card.kit.map((line) => h('li', { text: line }))),
    );
    element.addEventListener('click', () => {
      highlight(card);
    });
    return { card, element };
  });

  function highlight(card: ClassCardModel): void {
    highlighted = card.id;
    for (const { card: other, element } of cards) {
      element.setAttribute('aria-checked', String(other.id === card.id));
    }
    status.textContent = highlightedText(card.name);
    confirm.disabled = false;
    confirm.focus();
  }

  const first = cards[0];
  if (first !== undefined) first.element.dataset['autofocus'] = '';
  const content = h(
    'div',
    { className: 'vb-panel vb-stack vb-class-select', data: { testid: 'class-select' } },
    h('h1', { text: CLASS_SELECT_TEXT.heading }),
    h('p', { text: CLASS_SELECT_TEXT.hint }),
    h(
      'div',
      {
        className: 'vb-class-cards',
        attrs: { role: 'radiogroup', 'aria-label': CLASS_SELECT_TEXT.group },
      },
      ...cards.map(({ element }) => element),
    ),
    h('div', { className: 'vb-row' }, confirm, status),
  );
  const screen = ui.push({
    id: CLASS_SELECT_SCREEN,
    label: CLASS_SELECT_TEXT.heading,
    content,
    pausesSim: true,
    onBack: () => true,
  });
  return {
    screen,
    confirm,
    get highlighted() {
      return highlighted;
    },
  };
}
