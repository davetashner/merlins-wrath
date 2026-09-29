// UI component gallery page (mw-e00.23): mounts a UiRoot, opens the gallery screen and exposes a few
// hooks on window.__ui for the Playwright helpers (e2e/helpers/ui.ts). Query parameters:
//   ?scale=2       sets --ui-text-scale
//   ?hudbench=30   updates the vitals HUD every tick for N seconds and reports per-frame UI cost
import {
  browserGeometry,
  findClippedText,
  focusables,
  openGallery,
  reducedMotion,
  setTextScale,
  UiRoot,
  type Gallery,
  type VitalsViewModel,
} from '@ui/index';

const found = document.querySelector<HTMLElement>('#app');
if (!found) throw new Error('#app missing');
const app: HTMLElement = found;

const ui = new UiRoot(app);
const params = new URLSearchParams(location.search);
const scale = params.get('scale');
if (scale !== null) setTextScale(ui.element, Number(scale));
const matchMedia = window.matchMedia.bind(window);
const input = ui.attachInput({ window, navigator, now: () => performance.now() });

let gallery: Gallery = openGallery(ui, {
  reducedMotion: () => reducedMotion(ui.element, matchMedia),
});

/** Opens a screen by id, closing everything else first (the Playwright `openScreen` helper). */
function openScreen(id: string): void {
  if (id !== 'gallery') throw new Error(`unknown screen ${id}`);
  ui.clear();
  gallery = openGallery(ui, { reducedMotion: () => reducedMotion(ui.element, matchMedia) });
}

/** `screen/component#n`: the component (n-th `[data-ui-component]` of its screen) holding `el`. */
function componentKey(el: Element): string | null {
  const component = el.closest<HTMLElement>('[data-ui-component]');
  const screen = el.closest<HTMLElement>('[data-screen]');
  if (!component || !screen) return null;
  const index = [...screen.querySelectorAll('[data-ui-component]')].indexOf(component);
  return `${screen.dataset['screen'] ?? '?'}/${component.dataset['uiComponent'] ?? '?'}#${String(index)}`;
}

/** The focused element's component key. */
function describeFocus(): string | null {
  const el = document.activeElement;
  return el instanceof HTMLElement ? componentKey(el) : null;
}

/** Keys of every component in the top screen that can take focus. */
function interactiveComponents(): string[] {
  const top = ui.top;
  if (!top) return [];
  return [...top.element.querySelectorAll<HTMLElement>('[data-ui-component]')]
    .filter((el) => el.tabIndex >= 0 || focusables(el).length > 0)
    .map((el) => componentKey(el) ?? '?');
}

// Every frame: read the pad, advance the demo HUD.
let hudBench: { until: number; samples: number[] } | undefined;
const benchSeconds = Number(params.get('hudbench') ?? '0');
function frame(now: number): void {
  input.poll();
  if (hudBench) {
    // AC-8: health, stamina and 4 quick slots all change every tick.
    const t = Math.floor(now / (1000 / 60));
    const model: VitalsViewModel = {
      health: { value: 50 + (t % 50), max: 100 },
      stamina: { value: 100 - (t % 100), max: 100 },
      slots: [0, 1, 2, 3].map((i) => ({
        label: `Slot ${String(i + 1)}`,
        glyph: String(i + 1),
        count: (t + i) % 20,
        cooldown: ((t + 7 * i) % 60) / 60,
      })),
    };
    const start = performance.now();
    gallery.vitals.update(model, now);
    hudBench.samples.push(performance.now() - start);
    if (now >= hudBench.until) {
      const sorted = [...hudBench.samples].sort((a, b) => a - b);
      const at = (q: number): number =>
        sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
      app.dataset['hudBench'] = JSON.stringify({
        count: sorted.length,
        p50: at(0.5),
        p95: at(0.95),
        max: sorted.at(-1) ?? 0,
      });
      hudBench = undefined;
    }
  } else {
    gallery.vitals.update(gallery.model(), now);
  }
  requestAnimationFrame(frame);
}
if (benchSeconds > 0) hudBench = { until: performance.now() + benchSeconds * 1000, samples: [] };
requestAnimationFrame(frame);

Object.assign(window, {
  __ui: {
    openScreen,
    poll: () => {
      input.poll();
    },
    focus: describeFocus,
    focusInTop: () => {
      const top = ui.top;
      return top?.element.contains(document.activeElement) ?? false;
    },
    topScreen: () => ui.top?.id ?? null,
    components: interactiveComponents,
    clippedText: () => findClippedText(ui.element, browserGeometry(window)),
    setTextScale: (value: number) => setTextScale(ui.element, value),
    values: () => gallery.values,
  },
});
app.dataset['ready'] = 'true';
