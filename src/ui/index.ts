// The UI layer (mw-e00.23): DOM HUD and menus over the canvas. API tour and rules:
// docs/design/ui.md. Nothing in here reads or writes sim state: HUD widgets take
// view models, screens report `pausesSim` / `capturesInput`, and src/game wires both to the loop.
export const layer = 'ui' as const;

export * from './comfort';
export * from './components/controls';
export * from './components/list';
export * from './components/overlays';
export * from './components/tabs';
export * from './focus';
export * from './gallery';
export * from './hud';
export * from './input';
export * from './interact-prompt';
export * from './screens';
export * from './testing/overflow';
export * from './tokens';
