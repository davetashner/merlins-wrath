# UI layer: HUD, menus, focus and test harness

Bead `mw-e00.23` (anchor for every HUD and menu bead). Code: `src/ui`, glue in `src/game/ui`, gallery
page `testbed/ui.html`. Visual rules come from the style bible §9. This page is the API tour.

## Rules

1. **The UI never mutates sim state.** HUD widgets take immutable view models. Screens only report
   what is open (`pausesSim`, `capturesInput`). Player intent reaches the sim as action frames, never
   through the UI.
2. **One UI root, DOM over the canvas.** `new UiRoot(container)` mounts `.vb-ui` with two layers:
   - `ui.hud`: HUD widgets. Not focusable, and pointer events pass through to the game.
   - `ui.menus`: the screen stack.
3. **Colour, size and motion come only from tokens.** Tokens are CSS custom properties on `.vb-ui`
   (`src/ui/tokens.ts`). To restyle, override a token on the root. Never hard-code a colour in a
   component.
4. **Menu navigation does not depend on gameplay bindings.** The UI input adapter uses fixed keys and
   pad buttons, so remapping gameplay can never lock a player out of the menus.

## Screen stack

```ts
const screen = ui.push({
  id: 'inventory',          // data-screen, used by tests
  label: 'Inventory',       // accessible name (role=dialog)
  content: panelElement,
  pausesSim: true,          // loop stops stepping while open
  capturesInput: true,      // default; gameplay frames withheld, intents come here
  modal: false,             // true: backdrop + aria-modal
  onBack: () => false,      // return true to keep the screen open on back
  onIntent: (intent) => false,
  onClose: () => {},
});
screen.close(); ui.pop(); ui.clear();
ui.subscribe(({ capturesInput, pausesSim }) => { /* … */ });
```

- **Push:** remembers what had focus, makes every screen below `inert` (the focus trap), and focuses
  the new screen's `[data-autofocus]` element, or else its first focusable element.
- **Pop:** restores focus to the remembered element. Listeners are notified synchronously, so
  capture is released on the same frame.

## Intents

| Intent | Keyboard | Gamepad (standard mapping) | Default action |
|---|---|---|---|
| `up/down/left/right` | arrows (repeat) | D-pad, left stick (repeat 400 ms / 120 ms) | spatial focus move |
| `confirm` | Enter, Space | A | `click()` the focused element |
| `back` | Esc | B | `onBack`, else close the screen |
| `tabPrev/tabNext` | Q/E, PageUp/PageDown | LB/RB | first tab strip on the screen |
| `next/prev` | Tab / Shift+Tab | — | Tab order, wrapping inside the screen |

An intent is routed in this order:

1. The focused element receives it first, as a cancelable, bubbling `ui-intent` DOM event. Use
   `onIntent(el, handler)`; a handler returns true to consume the intent. For example, a slider
   consumes left/right and a list consumes up/down.
2. If nothing consumed it, the screen's `onIntent` gets it.
3. If the screen doesn't consume it either, the default action from the table runs.

With no capturing screen open, `ui.intent()` returns false and the key's browser default is left
alone. Attach input with `ui.attachInput({ window, navigator, now })`, then call `poll()` once per
animation frame to read the pad. A pad that disconnects reads as no pad: nothing throws, and focus
stays where it is.

**Spatial navigation** (`src/ui/focus.ts`) only considers candidates that lie wholly beyond the
focused element's edge in the pressed direction. It scores each one as the gap along the direction
plus twice the sideways gap. When nothing lies beyond, focus stays put. Lay screens out so every
control has a neighbour in some direction: the gallery e2e test proves reachability with a BFS.

## Components (`src/ui/components`)

| Factory | Role | Notes |
|---|---|---|
| `button({label, onPress, variant, autofocus})` | button | `variant: 'warning'` for destructive actions |
| `toggle({label, checked, onChange})` | switch | |
| `slider({label, min, max, step, value, format, onChange})` | slider | left/right step it |
| `select({label, options, value, onChange})` | spinbutton | game-style picker; left/right/confirm cycle |
| `tabs({label, tabs, selected, onChange})` | tablist | roving tabindex; LB/RB from anywhere |
| `new VirtualList({label, items, text, columns, visibleRows, onSelect})` | listbox | virtualised list or grid; rows sized in `em` |
| `attachTooltip(target, text)` | tooltip | shown on focus or hover; `aria-describedby` |
| `new ToastHost()` → `show(text, {tone, durationMs})` | status | polite live region; put it in `ui.hud` |
| `confirmDialog(ui, {title, body, …})` → `Promise<boolean>` | modal dialog | focus starts on Cancel |
| `glyphPrompt(glyph, action)` | — | glyph text comes from `UI_INTENT_GLYPHS` or the e02 `inputGlyph` |

## HUD binding (`src/ui/hud.ts`)

```ts
const vitals = new VitalsHud({ slots: 4 });
ui.hud.append(vitals.element);
const binding = new HudBinding((snapshot) => deriveVitals(snapshot), [vitals]);
// in the loop's draw callback:
binding.frame(latestSnapshot, frame.timeMs);
```

- `select` must be pure. It runs again only when the snapshot object changes.
- Each widget writes the DOM only when a shown value changed (`WriteCache`). An idle HUD therefore
  costs zero DOM writes.
- `Meter` draws the delayed-damage trail, which snaps under reduced motion.
- Deriving the vitals from real sim components is owned by the HUD feature beads (e.g. mw-e04.10).

## Game glue (`src/game/ui`)

`createUiGameBridge({ ui, sampleCommands, drain })` returns three things:

- `sampleCommands` hands the loop the gameplay frames, or none while a screen captures input.
- `simPaused` goes to `createGameLoop({ simPaused })`. While it returns true, the loop renders but
  doesn't step, and paused time is discarded.
- `frame()` drains gameplay input while paused, so keys pressed in a menu never leak into the game.

`src/main.ts` also releases pointer lock whenever a screen starts capturing input.

## Comfort hooks (`src/ui/comfort.ts`)

- **Text size:** `setTextScale(ui.element, 0.8…2.0)` sets `--ui-text-scale`. Every font size and
  every `em`-sized row follows it.
- **Motion:** `setMotionPreference(ui.element, 'system' | 'reduce' | 'full')` sets the motion
  preference. `reducedMotion(root, matchMedia)` reports the effective state for scripted motion.
- The settings UI that calls these belongs to mw-e31.

## Testing

- **Unit tests:** put `// @vitest-environment happy-dom` at the top of the file. happy-dom has no
  layout, so give elements fake boxes with `place(el, left, top, w, h)` and build the root with
  `new UiRoot(container, { focus: { rectOf: rectFromData } })`. `find(selector)` queries without
  null assertions. The helpers live in `src/ui/testing/layout.ts`.
- **Playwright** (`e2e/helpers/ui.ts`):

  | Helper | What it does |
  |---|---|
  | `openUiPage` | loads the UI test page |
  | `openScreen(page, id)` | opens a screen |
  | `navigate(page, steps, 'keyboard' \| 'gamepad')` | drives input; pair with `installVirtualPad` for the pad |
  | `focused` | reports the focused element |
  | `clippedText` | the overflow helper (`src/ui/testing/overflow.ts`) |
  | `seriousAxeViolations` | axe-core scan |
  | `focusRing` | reports the focus ring's contrast |

- **Component gallery:** `testbed/ui.html` exposes `window.__ui`. Add every new kit component to
  `src/ui/gallery.ts`, and the e2e suite then checks it for reachability, focus ring, axe and 2×
  text automatically. `?scale=2` sets the text scale; `?hudbench=N` runs the HUD perf probe
  (`e2e/ui-perf.spec.ts`).
