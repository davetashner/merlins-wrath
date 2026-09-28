// lint-as: src/sim/fixture.ts
// expect: no-restricted-globals
export const width = (): number =>
  window.innerWidth + document.body.clientWidth + navigator.hardwareConcurrency;
