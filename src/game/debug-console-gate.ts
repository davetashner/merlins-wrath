// Whether this page gets the debug console (mw-e33.1). Dev builds always do; other builds only with
// ?debug=1 in the URL (playtest builds) or in the combat sandbox scene (mw-e04.9: spawning dummies
// is how it is used), and never when the build turned the console off
// (VESPER_DEBUG_CONSOLE=off at build time sets __DEBUG_CONSOLE__ false, so the dynamic import in
// src/main.ts is dead code and the console chunk is not emitted at all). The console itself is a
// separate chunk loaded on demand, so it is never part of the main bundle either way.

export interface DebugConsoleGate {
  /** The build includes the console (__DEBUG_CONSOLE__). */
  readonly built: boolean;
  /** A dev build (import.meta.env.DEV). */
  readonly dev: boolean;
  /** The page's query string (location.search). */
  readonly search: string;
  /** The page shows the combat sandbox (mw-e04.9). */
  readonly sandbox?: boolean;
}

/** True when the debug console should load on this page. */
export function debugConsoleEnabled({ built, dev, search, sandbox }: DebugConsoleGate): boolean {
  if (!built) return false;
  return dev || sandbox === true || new URLSearchParams(search).get('debug') === '1';
}
