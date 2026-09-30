import { describe, expect, it } from 'vitest';
import { closest, commonPrefix, editDistance, tokenize } from './text';

describe('console text helpers', () => {
  it('tokenize splits on whitespace and keeps "quoted words" together', () => {
    expect(tokenize('  spawn   testprop-crate 3 ')).toEqual(['spawn', 'testprop-crate', '3']);
    expect(tokenize('say "hello there" "open')).toEqual(['say', 'hello there', 'open']);
    expect(tokenize('')).toEqual([]);
  });

  it('editDistance is the Levenshtein distance', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('same', 'same')).toBe(0);
  });

  it('closest ranks by distance, then alphabetically, and takes at most `count`', () => {
    expect(closest('crat', ['plank', 'crate', 'cart', 'brat'])).toEqual(['brat', 'crate', 'cart']);
    expect(closest('x', ['a'], 3)).toEqual(['a']);
    expect(closest('x', [])).toEqual([]);
  });

  it('commonPrefix is the longest shared prefix', () => {
    expect(commonPrefix(['testprop-crate', 'testprop-crystal'])).toBe('testprop-cr');
    expect(commonPrefix(['abc', 'xyz'])).toBe('');
    expect(commonPrefix(['only'])).toBe('only');
    expect(commonPrefix([])).toBe('');
  });
});
