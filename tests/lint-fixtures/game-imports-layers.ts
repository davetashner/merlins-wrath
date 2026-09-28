// lint-as: src/game/fixture.ts
// expect: none
import { layer as audio } from '@audio/index';
import { layer as render } from '@render/index';
import { layer as sim } from '@sim/index';
import { layer as ui } from '@ui/index';
export const x = [audio, render, sim, ui];
