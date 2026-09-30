import { describe, expect, it } from 'vitest';
import { debugConsoleEnabled } from './debug-console-gate';

describe('debugConsoleEnabled', () => {
  it('always in dev builds, otherwise only with ?debug=1', () => {
    expect(debugConsoleEnabled({ built: true, dev: true, search: '' })).toBe(true);
    expect(debugConsoleEnabled({ built: true, dev: false, search: '' })).toBe(false);
    expect(debugConsoleEnabled({ built: true, dev: false, search: '?scene=testbed&debug=1' })).toBe(
      true,
    );
    expect(debugConsoleEnabled({ built: true, dev: false, search: '?debug=0' })).toBe(false);
  });

  it('never when the build left the console out', () => {
    expect(debugConsoleEnabled({ built: false, dev: true, search: '?debug=1' })).toBe(false);
  });
});
