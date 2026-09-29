// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { ActionSampler } from '@game/input/index';
import { createUiGameBridge } from '@game/ui/index';
import { UiRoot } from '@ui/index';

function panel(): HTMLElement {
  const div = document.createElement('div');
  const b = document.createElement('button');
  b.textContent = 'Sword';
  div.append(b);
  return div;
}

describe('UI ↔ game bridge', () => {
  let ui: UiRoot;
  let sampler: ActionSampler;

  beforeEach(() => {
    document.body.innerHTML = '';
    ui = new UiRoot(document.body);
    sampler = new ActionSampler();
  });

  it('AC-1: with the HUD plus a capturing inventory open, back pops it and gameplay capture is released on the same frame', () => {
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    document.body.prepend(canvas);
    canvas.focus();
    const bridge = createUiGameBridge({ ui, sampleCommands: sampler.sampleCommands });
    sampler.down('KeyW');
    expect(bridge.sampleCommands(0)).toHaveLength(1);

    ui.push({ id: 'inventory', label: 'Inventory', content: panel(), modal: true });
    sampler.down('Space');
    expect(bridge.sampleCommands(1)).toEqual([]); // withheld while the inventory captures input
    expect(ui.intent('back', 'gamepad')).toBe(true); // gamepad B / Esc
    expect(document.activeElement).toBe(canvas);
    // The same frame's next tick already carries gameplay again; Space went down during the menu, so
    // it is held without a fresh press edge (no accidental jump on close).
    const [frame] = bridge.sampleCommands(2);
    expect(frame).toBeDefined();
    expect(sampler.lastFrame.jump).toEqual({ pressed: false, held: true, released: false });
    expect(sampler.lastFrame.move.y).toBe(1);
  });

  it('reports pausesSim and drains gameplay input each frame while paused', () => {
    let drained = 0;
    const bridge = createUiGameBridge({
      ui,
      sampleCommands: sampler.sampleCommands,
      drain: () => {
        drained++;
      },
    });
    bridge.frame();
    expect(drained).toBe(0);
    expect(bridge.simPaused()).toBe(false);
    ui.push({ id: 'pause', label: 'Paused', content: panel(), pausesSim: true });
    expect(bridge.simPaused()).toBe(true);
    bridge.frame();
    expect(drained).toBe(1);
    ui.pop();
    expect(bridge.simPaused()).toBe(false);
    createUiGameBridge({ ui, sampleCommands: sampler.sampleCommands }).frame();
  });

  it('a non-capturing screen (a HUD banner) leaves gameplay input alone', () => {
    const bridge = createUiGameBridge({ ui, sampleCommands: sampler.sampleCommands });
    ui.push({ id: 'banner', label: 'Banner', content: panel(), capturesInput: false });
    expect(bridge.sampleCommands(0)).toHaveLength(1);
  });
});
