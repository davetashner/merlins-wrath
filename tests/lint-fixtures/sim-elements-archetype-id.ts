// lint-as: src/sim/elements/fixture.ts
// expect: no-restricted-syntax
declare const material: string;
declare const thing: { archetype: string };
declare function readProperty(world: unknown, entity: number, key: string): string;
export const isRope = material === 'rope';
export const notCrate = 'crate' !== thing.archetype;
export const isHay = readProperty(null, 1, 'material') == 'straw';
export function burnTime(prefab: string): number {
  switch (prefab) {
    case 'torch':
      return 1;
    default:
      return 0;
  }
}
