import { layer as audio } from '@audio/index';
import { layer as content } from '@content/index';
import { layer as render } from '@render/index';
import { layer as sim } from '@sim/index';
import { layer as tools } from '@tools/index';
import { layer as ui } from '@ui/index';

// Placeholder: game/ is the glue that binds the other layers together.
export const layer = 'game' as const;

export const layers = [sim, content, layer, render, audio, ui, tools] as const;
