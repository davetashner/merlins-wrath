import { layers } from '@game/index';

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  app.dataset['layers'] = layers.join(' ');
}
