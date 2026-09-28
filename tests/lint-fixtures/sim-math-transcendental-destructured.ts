// lint-as: src/sim/fixture.ts
// expect: no-restricted-properties
const { atan2 } = Math;
export const angle = (y: number, x: number): number => atan2(y, x);
