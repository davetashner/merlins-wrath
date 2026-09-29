import { describe, expect, it, vi } from 'vitest';
import { ActionSampler } from '../input';
import { attachPlayerInput } from './pointer-lock';

/** A fake page: window and document as real EventTargets, and a canvas that locks when asked. */
function fakePage({ canExit = true } = {}) {
  const window = new EventTarget();
  const unlocked: unknown = null;
  const document = Object.assign(new EventTarget(), {
    pointerLockElement: unlocked,
    ...(canExit && {
      exitPointerLock: vi.fn(() => {
        document.pointerLockElement = null;
        document.dispatchEvent(new Event('pointerlockchange'));
      }),
    }),
  });
  const element = Object.assign(new EventTarget(), {
    requestPointerLock: vi.fn(() => {
      document.pointerLockElement = element;
      document.dispatchEvent(new Event('pointerlockchange'));
    }),
  });
  const sampler = new ActionSampler();
  const input = attachPlayerInput(sampler, { window, document, element });
  const key = (type: string, code: string) => {
    window.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code }));
  };
  const click = () => element.dispatchEvent(new Event('click'));
  return { document, element, sampler, input, key, click };
}

describe('attachPlayerInput (mw-e02.23)', () => {
  it('a click on the canvas locks the pointer; then keys reach the sampler', async () => {
    const page = fakePage();
    page.key('keydown', 'KeyW');
    expect(page.sampler.sample().move.y).toBe(0); // not locked yet
    page.click();
    await Promise.resolve();
    expect(page.element.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(page.input.locked).toBe(true);
    page.key('keydown', 'KeyW');
    expect(page.sampler.sample().move.y).toBe(1);
  });

  it('disabling releases the lock and held actions, and clicks stop locking', () => {
    const page = fakePage();
    page.click();
    page.key('keydown', 'KeyW');
    page.sampler.sample();
    page.input.enabled = false;
    expect(page.input.enabled).toBe(false);
    expect(page.document.exitPointerLock).toHaveBeenCalledTimes(1);
    expect(page.input.locked).toBe(false);
    const frame = page.sampler.sample();
    expect(frame.move.y).toBe(0);
    page.click();
    expect(page.element.requestPointerLock).toHaveBeenCalledTimes(1);
    page.input.enabled = true;
    page.click();
    expect(page.element.requestPointerLock).toHaveBeenCalledTimes(2);
  });

  it('disabling while unlocked (or without exitPointerLock) only releases held actions', () => {
    const page = fakePage({ canExit: false });
    page.input.enabled = false;
    page.click();
    page.input.enabled = true;
    page.click();
    page.input.enabled = false; // locked, but the document cannot exit: the sampler still releases
    expect(page.sampler.sample().move.y).toBe(0);
  });

  it('detach removes the click handler and the DOM listeners', () => {
    const page = fakePage();
    page.input.detach();
    page.click();
    expect(page.element.requestPointerLock).not.toHaveBeenCalled();
  });
});
