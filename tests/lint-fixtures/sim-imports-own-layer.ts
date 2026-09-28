// lint-as: src/sim/nested/fixture.ts
// expect: none
import { layer } from '@sim/index';
import { layer as same } from '../index';
export const x = [layer, same];
