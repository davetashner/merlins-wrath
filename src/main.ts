import { layers } from '@game/index';
import { layer as tools } from '@tools/index';

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  app.dataset['layers'] = [...layers, tools].join(' ');
}
