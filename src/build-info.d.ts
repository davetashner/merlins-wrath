// Build-time constants injected by vite.config.ts `define` (mw-e00.21).

/** Short commit SHA of this build, shown on screen next to the scene name. */
declare const __BUILD_SHA__: string;

/**
 * Whether this build includes the debug console (mw-e33.1): true unless built with
 * VESPER_DEBUG_CONSOLE=off, which drops the console chunk from the build entirely.
 */
declare const __DEBUG_CONSOLE__: boolean;
