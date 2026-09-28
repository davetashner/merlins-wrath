// lint-as: src/sim/fixture.ts
// expect: no-restricted-globals
export function later(fn: () => void): void {
  setTimeout(fn, 10);
  setInterval(fn, 10);
  requestAnimationFrame(fn);
}
