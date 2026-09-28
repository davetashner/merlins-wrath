// mw-e03.4: element field budget. The bead's target is 2,000 active cells ≤ 2.0 ms per tick (the
// budget suite, e03-sim-perf-budget, verifies it on the baseline hardware); this guards it in Node:
// 4 awake chunks (2,048 cells) × 3 channels, capped so the field cannot grow, mean stepField ≤ 2 ms.
import { describe, expect, test } from 'vitest';
import { ElementField, stepField } from '@sim/index';

// Bound once: the bench loop would otherwise hit the module's export getter on every call.
const step = stepField;

function buildField(): ElementField {
  const field = new ElementField({ maxChunks: 4 }); // the cap walls the region in
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 8; z++) {
        const cell = { x, y, z };
        field.add('temperature', cell, ((x * 7 + y * 13 + z * 5) % 23) * 10);
        field.add('moisture', cell, ((x + y + z) % 5) / 5);
        field.add('gas:smoke', cell, ((x * y + z) % 7) / 7);
      }
    }
  }
  return field;
}

describe('element field', () => {
  test('stepField over 2,048 active cells × 3 channels averages ≤ 2 ms', async ({ bench }) => {
    const field = buildField();
    const result = await bench('stepField()', () => {
      step(field);
    }).run();
    expect(field.chunkCount).toBe(4);
    expect(result.latency.mean).toBeLessThanOrEqual(2); // milliseconds
  });
});
