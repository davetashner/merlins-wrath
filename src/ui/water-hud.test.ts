// @vitest-environment happy-dom
// The water HUD (mw-e02.14): the breath meter shows only while breath is short, and the notice shows
// for WATER_NOTICE_MS on the clock passed in.
import { beforeEach, describe, expect, it } from 'vitest';
import { BREATH_LOW, WATER_HUD_TEXT, WATER_NOTICE_MS, WaterHud } from '@ui/water-hud';

beforeEach(() => {
  document.body.innerHTML = '';
});

function hud() {
  const widget = new WaterHud();
  document.body.append(widget.element);
  return widget;
}

describe('water HUD (mw-e02.14)', () => {
  it('stays hidden while the breath is full', () => {
    const widget = hud();
    widget.update({ breath: 1 }, 0);
    expect(widget.visible).toBe(false);
    expect(widget.notice).toBe('');
  });

  it('shows the breath meter once breath is short, with its value, and hides it again', () => {
    const widget = hud();
    widget.update({ breath: 0.6 }, 0);
    expect(widget.visible).toBe(true);
    const meter = widget.element.querySelector('.vb-meter');
    expect(meter?.getAttribute('aria-label')).toBe(WATER_HUD_TEXT.breath);
    expect(meter?.getAttribute('data-kind')).toBe('breath');
    expect(meter?.getAttribute('aria-valuenow')).toBe('60');
    expect(meter?.hasAttribute('data-low')).toBe(false);
    widget.update({ breath: BREATH_LOW / 2 }, 16);
    expect(meter?.hasAttribute('data-low')).toBe(true);
    widget.update({ breath: 1 }, 32);
    expect(widget.visible).toBe(false);
  });

  it('clamps a breath outside 0 to 1', () => {
    const widget = hud();
    widget.update({ breath: -3 }, 0);
    expect(widget.element.querySelector('.vb-meter')?.getAttribute('aria-valuenow')).toBe('0');
    widget.update({ breath: 7 }, 16);
    expect(widget.visible).toBe(false);
  });

  it('shows a notice for its time even with a full breath, then clears it', () => {
    const widget = hud();
    widget.update({ breath: 1 }, 100);
    widget.announce(WATER_HUD_TEXT.sinking, 100);
    widget.update({ breath: 1 }, 116);
    expect(widget.visible).toBe(true);
    expect(widget.notice).toBe('Your armour drags you under.');
    expect(widget.element.querySelector('.vb-meter')?.hasAttribute('hidden')).toBe(true);
    widget.update({ breath: 1 }, 100 + WATER_NOTICE_MS - 1);
    expect(widget.notice).not.toBe('');
    widget.update({ breath: 1 }, 100 + WATER_NOTICE_MS);
    expect(widget.notice).toBe('');
    expect(widget.visible).toBe(false);
  });

  it('passes the reduced-motion preference to the meter', () => {
    const widget = new WaterHud({ reducedMotion: () => true });
    widget.update({ breath: 0.5 }, 0);
    widget.update({ breath: 0.2 }, 10);
    expect(widget.visible).toBe(true);
  });
});
