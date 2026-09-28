// The safety-veto registry (mw-e30.5): systems object to saving with a reason and withdraw again.
import { describe, expect, it } from 'vitest';
import { SafetyVetoes } from './vetoes';

describe('SafetyVetoes', () => {
  it('is safe with no vetoes and lists objecting vetoes in registration order', () => {
    const vetoes = new SafetyVetoes();
    expect(vetoes.isSafe()).toBe(true);
    let fighting = true;
    vetoes.register('combat', () => (fighting ? 'enemies are hunting you' : null));
    vetoes.register('dialogue', () => 'in conversation');
    vetoes.register('mid-air', () => null);
    expect(vetoes.active()).toEqual([
      { id: 'combat', reason: 'enemies are hunting you' },
      { id: 'dialogue', reason: 'in conversation' },
    ]);
    fighting = false;
    expect(vetoes.active()).toEqual([{ id: 'dialogue', reason: 'in conversation' }]);
    expect(vetoes.isSafe()).toBe(false);
  });

  it('unregisters, and a stale unregister leaves a re-registered veto alone', () => {
    const vetoes = new SafetyVetoes();
    const remove = vetoes.register('combat', () => 'fighting');
    remove();
    expect(vetoes.isSafe()).toBe(true);
    vetoes.register('combat', () => 'still fighting');
    remove();
    expect(vetoes.active()).toEqual([{ id: 'combat', reason: 'still fighting' }]);
  });

  it('rejects empty and duplicate ids', () => {
    const vetoes = new SafetyVetoes();
    expect(() => vetoes.register('', () => null)).toThrow(RangeError);
    vetoes.register('combat', () => null);
    expect(() => vetoes.register('combat', () => null)).toThrow(
      'safety veto "combat" is already registered',
    );
  });
});
