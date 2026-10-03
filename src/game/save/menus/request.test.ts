// `?menu=` (mw-e30.11): which save menu boot opens, and leaving the menus for a reload.
import { describe, expect, it } from 'vitest';
import { saveMenuRequest, searchWithoutMenu } from './request';

describe('saveMenuRequest', () => {
  it('reads the title, load and save menus and reports anything else', () => {
    expect(saveMenuRequest('')).toEqual({ kind: 'none' });
    expect(saveMenuRequest('?scene=testbed&menu=title')).toEqual({ kind: 'open', menu: 'title' });
    expect(saveMenuRequest('?menu=load')).toEqual({ kind: 'open', menu: 'load' });
    expect(saveMenuRequest('?menu=save')).toEqual({ kind: 'open', menu: 'save' });
    expect(saveMenuRequest('?menu=pause')).toEqual({ kind: 'unknown', value: 'pause' });
  });
});

describe('searchWithoutMenu', () => {
  it('drops ?menu= and applies the extra parameters', () => {
    expect(searchWithoutMenu('?scene=testbed&menu=title')).toBe('scene=testbed');
    expect(searchWithoutMenu('?scene=testbed&menu=title', { newgame: '' })).toBe(
      'scene=testbed&newgame=',
    );
    expect(searchWithoutMenu('', { scene: 'slice' })).toBe('scene=slice');
  });
});
