// lint-as: src/game/fixture.ts
// expect: none
export const now = (): number => performance.now() + Date.now() + Math.random();
