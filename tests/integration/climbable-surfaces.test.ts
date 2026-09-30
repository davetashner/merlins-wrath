// mw-e03.22 across content and sim: the real material data gives climbing grades and burnt states
// that the sim's climb queries follow (ivy burns away, timber burns to charred with no climb, ice is
// sheer), and the ledge pass runs over the shipped greybox testbed. Content may import the sim only
// as types, so this cross-layer check lives outside src/.
import { describe, expect, it } from 'vitest';
import { burntMaterials, loadGameContent, materialPresets } from '@content/index';
import { markExercised } from '@content/testing';
import {
  addMaterialProperties,
  canAttachClimb,
  CLIMB_ROUGH_CAPABILITY,
  climbabilityOf,
  extractLedges,
  layoutScene,
  registerWorldProperties,
  resolveProperties,
  World,
} from '@sim/index';

const content = loadGameContent();
const presets = materialPresets(content.all('material'));
const burnt = burntMaterials(content.all('material'));

describe('climbable surfaces from content (mw-e03.22)', () => {
  it('AC-3: ivy climbs for anyone and burns away; timber climbs rough and burns to charred, unclimbable', ({
    task,
  }) => {
    for (const id of ['ivy', 'wood', 'charred', 'stone', 'ice', 'rope']) {
      markExercised(task, 'material', id);
    }
    const grade = (material: string) => resolveProperties(presets, { material }).climbable;
    expect(grade('ivy')).toBe('ivy');
    expect(burnt.get('ivy')).toBeNull();
    expect(grade('wood')).toBe('rough');
    expect(burnt.get('wood')).toBe('charred');
    expect(grade('charred')).toBe('none');
    expect(grade('stone')).toBe('rough');
    expect(grade('ice')).toBe('sheer');
    expect(grade('rope')).toBe('rope');

    const world = registerWorldProperties(new World<never>({ seed: 1 }));
    const wall = world.spawn();
    addMaterialProperties(world, wall, presets, { material: 'stone' });
    expect(canAttachClimb(world, wall, []).ok).toBe(false);
    expect(canAttachClimb(world, wall, [CLIMB_ROUGH_CAPABILITY]).ok).toBe(true);
    const pond = world.spawn();
    addMaterialProperties(world, pond, presets, { material: 'ice' });
    // Ice is sheer (and frozen, so slippery): nobody climbs it yet.
    expect(climbabilityOf(world, pond)).toBe('slippery');
    expect(canAttachClimb(world, pond, [CLIMB_ROUGH_CAPABILITY]).ok).toBe(false);
  });

  it('AC-1: the testbed’s ledges are horizontal top edges, the same on every run', ({ task }) => {
    markExercised(task, 'scene', 'testbed');
    const kit = (id: string) => (content.has('kit', id) ? content.get('kit', id) : undefined);
    const layout = layoutScene(content.get('scene', 'testbed'), kit);
    const ledges = extractLedges(layout);
    expect(ledges.length).toBeGreaterThan(0);
    for (const ledge of ledges) {
      expect(ledge.start.y).toBe(ledge.end.y);
      const part = layout.parts.filter((p) => p.placement === ledge.placement)[ledge.part];
      expect(ledge.start.y).toBe(part?.max.y);
    }
    expect(extractLedges(layoutScene(content.get('scene', 'testbed'), kit))).toEqual(ledges);
  });
});
