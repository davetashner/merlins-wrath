// `?menu=` (mw-e30.11): which save menu boot opens, and leaving the menus for a reload.
import { describe, expect, it } from 'vitest';
import {
  bootMenuRequest,
  opensTitle,
  saveMenuRequest,
  searchWithoutMenu,
  titleSearch,
} from './request';

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

describe('the title screen as the front door (mw-e01.2)', () => {
  it('opens the title when the page names no scene, new-game choice or menu', () => {
    const title = { kind: 'open', menu: 'title' };
    expect(bootMenuRequest('')).toEqual(title);
    expect(bootMenuRequest('?debug=1')).toEqual(title);
    expect(bootMenuRequest('?perf=5')).toEqual(title);
    expect(opensTitle('')).toBe(true);
  });

  it('keeps dev and test URLs booting straight into the game', () => {
    for (const search of ['?scene=testbed', '?newgame', '?class=knight', '?scene=slice&debug=1']) {
      expect(bootMenuRequest(search)).toEqual({ kind: 'none' });
      expect(opensTitle(search)).toBe(false);
    }
  });

  it('honours ?menu= as before', () => {
    expect(bootMenuRequest('?scene=testbed&menu=title')).toEqual({ kind: 'open', menu: 'title' });
    expect(opensTitle('?scene=testbed&menu=title')).toBe(true);
    expect(bootMenuRequest('?menu=save')).toEqual({ kind: 'open', menu: 'save' });
    expect(opensTitle('?menu=save')).toBe(false);
    expect(bootMenuRequest('?menu=pause')).toEqual({ kind: 'unknown', value: 'pause' });
  });
});

describe('quitting to the title (mw-e01.3)', () => {
  it('drops every parameter that skips the title, and ?menu=, keeping the rest', () => {
    expect(titleSearch('?scene=slice&class=knight&newgame&menu=save&debug=1')).toBe('debug=1');
    expect(titleSearch('')).toBe('');
    expect(opensTitle(titleSearch('?scene=testbed&allclasses'))).toBe(true);
  });
});
