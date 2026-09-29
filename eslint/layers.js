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
const SIM_MATH =
  'Use simMath from src/sim/math.ts: Math transcendentals are engine-defined, so the sim routes them through one swappable place.';
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

// Math functions whose results are implementation-defined (not correctly rounded by IEEE-754), so
// src/sim reaches them only through simMath. sqrt, floor, min, max, abs, imul, … stay allowed.
const SIM_MATH_BANNED = [
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log2',
  'log10',
  'pow',
  'hypot',
  'cbrt',
];

const MATH_RANDOM = { object: 'Math', property: 'random', message: RNG };

// simMath itself (and its test, which checks it against Math) are the only sim files allowed them.
const SIM_MATH_FILES = ['src/sim/math.ts', 'src/sim/math.test.ts'];

// Rules the sim may not switch off with eslint-disable comments.
const SIM_LOCKED_RULES = [
  'no-restricted-globals',
  'no-restricted-properties',
  '@typescript-eslint/no-restricted-imports',
  '@eslint-community/eslint-comments/*',
];

// Element rules act on properties, never on what a thing is (mw-e03.5, contract §2): under
// src/sim/elements no code may compare a string literal against a material, archetype or prefab id
// (an identifier or member named like one, or a `…Property(world, entity, 'material')` read), nor
// switch on one. Per-kind behaviour belongs in data: a property or a material preset.
const ARCHETYPE_NAME = '/material|archetype|prefab/i';
const ARCHETYPE_MESSAGE =
  'Element rules must not branch on material, archetype or prefab ids (mw-e03.5, contract §2): ' +
  'express the difference as a property or in material data.';
/** Selectors for an expression at `path` that names what a thing is. */
const archetypeAt = (/** @type {string} */ path) => [
  `[${path}.type='Identifier'][${path}.name=${ARCHETYPE_NAME}]`,
  `[${path}.type='MemberExpression'][${path}.property.name=${ARCHETYPE_NAME}]`,
  `[${path}.type='CallExpression'][${path}.arguments.2.value='material']`,
];
const STRING_AT = (/** @type {string} */ path) => `[${path}.type='Literal'][${path}.value=/^/]`;
const EQUALITY = 'BinaryExpression[operator=/^[!=]==?$/]';
const ARCHETYPE_SELECTORS = [
  ...archetypeAt('left').map((side) => `${EQUALITY}${side}${STRING_AT('right')}`),
  ...archetypeAt('right').map((side) => `${EQUALITY}${side}${STRING_AT('left')}`),
  ...archetypeAt('discriminant').map((side) => `SwitchStatement${side}`),
];

// The physics WASM is loaded by src/game and injected into the sim's physics port (ADR-0001,
// mw-e03.35): sim code may import Rapier's types only. Sim tests load the real module.
const PHYSICS_WASM_IMPORT = {
  regex: '^@dimforge/',
  allowTypeImports: true,
  message:
    'The sim never loads the physics WASM: import its types only (import type …); the game injects the loaded module into the physics port (mw-e03.35).',
};

/** Import-boundary patterns for one layer. */
function layerPatterns(/** @type {string} */ layer) {
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
  return patterns;
}

/** Import-boundary config for one layer. */
function layerConfig(/** @type {string} */ layer) {
  const patterns = layerPatterns(layer);
  if (layer === 'sim') patterns.push(PHYSICS_WASM_IMPORT);
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
      // Sim tests run the real physics engine, so they may load it; every other boundary stands.
      files: ['src/sim/**/*.test.ts'],
      rules: {
        '@typescript-eslint/no-restricted-imports': ['error', { patterns: layerPatterns('sim') }],
      },
    },
    {
      files: ['src/sim/**/*.ts'],
      plugins: { '@eslint-community/eslint-comments': eslintComments },
      rules: {
        'no-restricted-globals': ['error', ...SIM_GLOBALS],
        'no-restricted-properties': [
          'error',
          MATH_RANDOM,
          ...SIM_MATH_BANNED.map((property) => ({ object: 'Math', property, message: SIM_MATH })),
        ],
        '@eslint-community/eslint-comments/no-restricted-disable': ['error', ...SIM_LOCKED_RULES],
        '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
      },
    },
    {
      // Later flat-config entries replace a rule's options: only Math.random stays banned here.
      files: SIM_MATH_FILES,
      rules: { 'no-restricted-properties': ['error', MATH_RANDOM] },
    },
    {
      files: ['src/sim/elements/**/*.ts'],
      ignores: ['**/*.test.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...ARCHETYPE_SELECTORS.map((selector) => ({ selector, message: ARCHETYPE_MESSAGE })),
        ],
        '@eslint-community/eslint-comments/no-restricted-disable': [
          'error',
          ...SIM_LOCKED_RULES,
          'no-restricted-syntax',
        ],
      },
    },
  ];
}
