// @ts-check
// Layer boundaries (backlog contract §2) and sim determinism rules, consumed by eslint.config.js.
// Every rule here is proven by a fixture in tests/lint-fixtures/ (tests/toolchain/lint-rules.test.ts).

/**
 * Which other src/ layers each layer may import. `types` may only be imported with `import type`.
 * Anything not listed (other than the layer itself) is an error.
 * @type {Record<string, { values: string[]; types: string[] }>}
 */
export const LAYER_DEPS = {
  sim: { values: [], types: ['content'] },
  content: { values: [], types: ['sim'] },
  render: { values: ['sim', 'content'], types: [] },
  audio: { values: ['sim', 'content'], types: [] },
  ui: { values: ['sim', 'content'], types: [] },
  game: { values: ['sim', 'content', 'render', 'audio', 'ui'], types: [] },
  tools: { values: ['sim', 'content', 'game', 'render', 'audio', 'ui'], types: [] },
};

const LAYERS = Object.keys(LAYER_DEPS);

// Matches the @layer/* alias, or a relative import that climbs out into a sibling layer (../render/x).
const layerImport = (/** @type {string} */ layer) =>
  `^(?:@${layer}(?:/|$)|(?:\\./)?(?:\\.\\./)+(?:src/)?${layer}(?:/|$))`;

const RNG = 'Use the seeded RNG streams injected into the sim (mw-e00.14), never Math.random.';
const CLOCK =
  'Use the injected sim clock / tick count (mw-e00.14); wall-clock time breaks replays.';
const HOST =
  'The sim has no host environment: no DOM, browser, timers or I/O. Emit an event for src/game to handle.';

/** @type {Array<{ name: string; message: string }>} */
const SIM_GLOBALS = [
  { name: 'Date', message: CLOCK },
  { name: 'performance', message: CLOCK },
  { name: 'crypto', message: RNG },
  ...[
    'setTimeout',
    'setInterval',
    'clearTimeout',
    'clearInterval',
    'setImmediate',
    'queueMicrotask',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'requestIdleCallback',
  ].map((name) => ({ name, message: `${CLOCK} Schedule work in ticks, not ${name}.` })),
  ...[
    'window',
    'self',
    'document',
    'navigator',
    'location',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'process',
  ].map((name) => ({ name, message: HOST })),
];

// Rules the sim may not switch off with eslint-disable comments.
const SIM_LOCKED_RULES = [
  'no-restricted-globals',
  'no-restricted-properties',
  '@typescript-eslint/no-restricted-imports',
  '@eslint-community/eslint-comments/*',
];

/** Import-boundary config for one layer. */
function layerConfig(/** @type {string} */ layer) {
  const { values, types } = LAYER_DEPS[layer] ?? { values: [], types: [] };
  const patterns = LAYERS.filter((other) => other !== layer && !values.includes(other)).map(
    (other) => ({
      regex: layerImport(other),
      allowTypeImports: types.includes(other),
      message: types.includes(other)
        ? `src/${layer} may import src/${other} only as types (import type …).`
        : `src/${layer} may not import src/${other} (backlog contract §2 layer rules).`,
    }),
  );
  if (layer === 'sim') {
    patterns.push({
      regex: '^(?:three|babylonjs|pixi\\.js)(?:/|$)|^@babylonjs/',
      allowTypeImports: false,
      message: 'The sim is engine-agnostic: no renderer packages (backlog contract §2).',
    });
  }
  return {
    files: [`src/${layer}/**/*.ts`],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', { patterns }] },
  };
}

/** @param {import('eslint').ESLint.Plugin} eslintComments */
export function layerConfigs(eslintComments) {
  return [
    ...LAYERS.map(layerConfig),
    {
      files: ['src/sim/**/*.ts'],
      plugins: { '@eslint-community/eslint-comments': eslintComments },
      rules: {
        'no-restricted-globals': ['error', ...SIM_GLOBALS],
        'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: RNG }],
        '@eslint-community/eslint-comments/no-restricted-disable': ['error', ...SIM_LOCKED_RULES],
        '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
      },
    },
  ];
}
