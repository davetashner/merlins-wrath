// lint-as: src/game/fixture.ts
// expect: none
export const wave = (t: number): number => Math.sin(t) + Math.atan2(t, 1) + Math.log(t);
