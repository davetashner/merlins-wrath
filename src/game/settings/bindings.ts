// Persisting input bindings through the settings store (mw-e02.22). The bindings ride in the same
// stored document as the other settings (`bindings` beside `settings`, one localStorage key, the same
// in-memory fallback), as the BindingsData that serializeBindings writes. That data carries its own
// version (BINDINGS_DATA_VERSION), so bindings migrate on their own and SETTINGS_VERSION is untouched.
// A future rebind UI calls saveBindings after each change; main.ts calls loadBindings at startup.

import {
  DEFAULT_BINDINGS,
  DEFAULT_PAD_BINDINGS,
  deserializeBindings,
  serializeBindings,
  type Bindings,
  type DeserializedBindings,
} from '../input/bindings';
import type { SettingsStore } from './store';

/** Saves both device sets into the settings store (and so into storage). */
export function saveBindings(
  store: SettingsStore,
  keyboardMouse: Bindings,
  gamepad: Bindings,
): void {
  store.setStoredBindings(serializeBindings(keyboardMouse, gamepad));
}

/**
 * The bindings the store holds, repaired: stored entries naming an unknown action, an unknown key or
 * button code or the wrong device are dropped and the defaults fill the gap, and a set that would
 * have two actions on one code falls back to its defaults whole (deserializeBindings). Nothing stored
 * gives the defaults silently; every repair is passed to `warn` (default console.warn).
 */
export function loadBindings(
  store: SettingsStore,
  warn: (message: string) => void = (message) => {
    console.warn(`[bindings] ${message}`);
  },
): DeserializedBindings {
  const stored = store.storedBindings;
  if (stored === undefined) {
    return { bindings: DEFAULT_BINDINGS, gamepad: DEFAULT_PAD_BINDINGS, issues: [] };
  }
  const loaded = deserializeBindings(stored);
  for (const issue of loaded.issues) warn(issue);
  return loaded;
}
