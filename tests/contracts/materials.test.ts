// Contract between layers (mw-e03.2): the game's material presets, loaded by the content layer, are
// valid sim property values and resolve through the sim's merge rule (object > preset > default).
// Content may import the sim only as types, so this runtime check lives outside src/.

import { expect, it } from 'vitest';
import {
  loadGameContent,
  materialPresets,
  toPropertyInit,
  worldPropertiesSchema,
} from '@content/index';
import { describeContent, markExercised } from '@content/testing';
import {
  resolveProperties,
  validateProperty,
  WORLD_PROPERTY_SPECS,
  type WorldPropertyKey,
} from '@sim/index';

const content = loadGameContent();
const presets = materialPresets(content.all('material'));

describeContent('material', 'every preset value is a valid sim property value', (entry) => {
  const problems = Object.entries(entry.properties).flatMap(([key, value]) => {
    const problem = validateProperty(key as WorldPropertyKey, value);
    return problem === undefined ? [] : [problem];
  });
  expect(problems).toEqual([]);
  expect(resolveProperties(presets, { material: entry.id }).material).toBe(entry.id);
});

it('AC-2: an object with material=wood and weight=3 gets weight 3 and everything else from wood', ({
  task,
}) => {
  markExercised(task, 'material', 'wood');
  const object = worldPropertiesSchema.parse({ material: 'wood', weight: 3 });
  const resolved = resolveProperties(presets, toPropertyInit(object));
  const wood = content.get('material', 'wood').properties;

  expect(resolved.weight).toBe(3);
  expect(resolved).toMatchObject(wood);
  const fromDefaults = Object.entries(resolved).filter(
    ([key]) => key !== 'weight' && key !== 'material' && !Object.hasOwn(wood, key),
  );
  expect(Object.fromEntries(fromDefaults)).toEqual(
    Object.fromEntries(
      fromDefaults.map(([key]) => [key, WORLD_PROPERTY_SPECS[key as WorldPropertyKey].default]),
    ),
  );
  expect(wood).toMatchObject({ flammable: true, ignitionPoint: 300 });
});
