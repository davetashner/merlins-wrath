import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAV_AGENT,
  NAV_AGENT_BITS,
  navAreaCost,
  navCanEnter,
  navCanTraverse,
  type NavAgentSpec,
} from './capabilities';

const B = NAV_AGENT_BITS;
const agent = (mask: number, patch: Partial<NavAgentSpec> = {}): NavAgentSpec => ({
  ...DEFAULT_NAV_AGENT,
  mask,
  ...patch,
});

describe('nav capabilities (mw-e11.4)', () => {
  it('restates content’s capability bits in order', () => {
    expect(Object.values(B)).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256]);
  });

  it('AC-3: only climbers (within grade) and wallcrawlers take climb links', () => {
    expect(navCanTraverse(agent(B.walk), 'climb', 1)).toBe(false);
    expect(navCanTraverse(agent(B.walk | B.climb, { maxClimbGrade: 1 }), 'climb', 1)).toBe(true);
    expect(navCanTraverse(agent(B.walk | B.climb, { maxClimbGrade: 1 }), 'climb', 2)).toBe(false);
    expect(navCanTraverse(agent(B.wallcrawl), 'climb', 3)).toBe(true);
  });

  it('limits jumps and drops by height, unless it flies or crawls walls', () => {
    expect(navCanTraverse(agent(B.walk), 'jump', 0.6)).toBe(true);
    expect(navCanTraverse(agent(B.walk), 'jump', 0.7)).toBe(false);
    expect(navCanTraverse(agent(B.fly, { maxAltitude: 3 }), 'jump', 2)).toBe(true);
    expect(navCanTraverse(agent(B.walk), 'drop', 2.5)).toBe(true);
    expect(navCanTraverse(agent(B.walk), 'drop', 3)).toBe(false);
    expect(navCanTraverse(agent(B.wallcrawl), 'drop', 30)).toBe(true);
  });

  it('opens doors, flies and never burrows (no burrow links are baked)', () => {
    expect(navCanTraverse(agent(B.walk), 'door', 0)).toBe(false);
    expect(navCanTraverse(agent(B.walk | B.openDoors), 'door', 0)).toBe(true);
    expect(navCanTraverse(agent(B.fly), 'fly', 0)).toBe(true);
    expect(navCanTraverse(agent(B.walk), 'fly', 0)).toBe(false);
    expect(navCanTraverse(agent(B.burrow, { burrowMaterials: ['earth'] }), 'burrow', 0)).toBe(
      false,
    );
  });

  it('enters areas by capability and weighs them by the agent’s costs', () => {
    expect(navCanEnter(agent(B.walk), 'ground')).toBe(true);
    expect(navCanEnter(agent(B.walk), 'water-shallow')).toBe(false);
    expect(navCanEnter(agent(B.walk | B.wade), 'water-shallow')).toBe(true);
    expect(navCanEnter(agent(B.swim), 'water-deep')).toBe(true);
    expect(navCanEnter(agent(B.walk), 'crawlspace')).toBe(false);
    expect(navCanEnter(agent(B.squeeze), 'crawlspace')).toBe(true);
    expect(navAreaCost(agent(B.walk, { areaCosts: { crawlspace: 0.8 } }), 'crawlspace')).toBe(0.8);
    expect(navAreaCost(agent(B.walk), 'water-deep')).toBe(1);
  });
});
