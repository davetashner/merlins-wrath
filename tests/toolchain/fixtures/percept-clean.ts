// mw-e11.5 AC-6 (control): agent code uses what a percept says — where, how strongly, how surely.
import type { Percept } from '@sim/perception/percept';

declare const percept: Percept;

export const where = percept.position;
export const weight = percept.strength * percept.certainty;
export const key: string = percept.source;
