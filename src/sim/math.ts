// Gameplay maths for the sim (mw-e00.15). Determinism policy: the target is same build + same JS
// engine. IEEE-754 guarantees + - * / and sqrt bit-for-bit everywhere, but Math.sin/cos/tan/atan2/
// exp/log/pow/hypot are implementation-defined and may differ across engines and versions. Sim code
// that feeds gameplay-critical state (positions, damage, AI decisions) calls these wrappers instead
// of Math directly, so a deterministic software implementation can be swapped in here, in one place,
// if cross-engine replays are ever required.

export const sin: (x: number) => number = Math.sin;
export const cos: (x: number) => number = Math.cos;
export const tan: (x: number) => number = Math.tan;
export const atan2: (y: number, x: number) => number = Math.atan2;
export const exp: (x: number) => number = Math.exp;
export const log: (x: number) => number = Math.log;
export const pow: (base: number, exponent: number) => number = Math.pow;
export const hypot: (...values: number[]) => number = Math.hypot;
