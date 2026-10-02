// The three candidates, each built from its JSON definition of the same fixture-guard behaviour.

import btJson from './bt/fixture-guard.bt.json';
import { btBrain, type BtDef } from './bt/runtime';
import flatJson from './hybrid/flat-utility.json';
import hybridJson from './hybrid/fixture-guard.json';
import { hybridBrain, type HybridDef } from './hybrid/runtime';
import type { Brain } from './shared/world';

// JSON imports widen literal unions to string; production loads validate with zod (mw-e11.2).
export const BT_DEF = btJson as unknown as BtDef;
export const HYBRID_DEF = hybridJson as unknown as HybridDef;
export const FLAT_DEF = flatJson as unknown as HybridDef;

export interface Candidate {
  readonly key: 'bt' | 'hybrid' | 'flat';
  readonly label: string;
  readonly file: string;
  readonly make: (thinkHz?: number) => Brain<unknown>;
}

export const CANDIDATES: readonly Candidate[] = [
  {
    key: 'bt',
    label: 'Behaviour tree',
    file: 'bt/fixture-guard.bt.json',
    make: (hz) => btBrain({ ...BT_DEF, thinkHz: hz ?? BT_DEF.thinkHz }) as Brain<unknown>,
  },
  {
    key: 'hybrid',
    label: 'HFSM + utility',
    file: 'hybrid/fixture-guard.json',
    make: (hz) =>
      hybridBrain({ ...HYBRID_DEF, thinkHz: hz ?? HYBRID_DEF.thinkHz }) as Brain<unknown>,
  },
  {
    key: 'flat',
    label: 'Flat utility',
    file: 'hybrid/flat-utility.json',
    make: (hz) =>
      hybridBrain(
        { ...FLAT_DEF, thinkHz: hz ?? FLAT_DEF.thinkHz },
        'flat-utility',
      ) as Brain<unknown>,
  },
];
