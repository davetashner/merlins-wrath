// World-fact conditions (mw-e27.5): the one predicate language every system gates on — dialogue
// lines, quest stages, puzzle goals, shops, AI and level variants all ask "is the minotaur
// befriended and the cellar still open?" the same way, instead of each inventing its own.
//
// A condition is plain JSON (validated by the content schema, src/content/types/condition.ts, and
// again here so code-built conditions fail just as clearly):
//   { "fact": "horn.befriended" }                      a bool fact is true
//   { "fact": "quest.miller.stage", "gte": 3 }          compare: eq, neq, gt, gte, lt, lte
//   { "fact": "bell.rung-by", "has": true }             the fact holds a value (set or defaulted)
//   { "count": "entity:mine/*.looted", "gte": 3 }       how many entity facts matching are true
//   { "all": [...] }, { "any": [...] }, { "not": {...} } combinators
// Compiling checks the shape, rejects nesting deeper than CONDITION_MAX_DEPTH, and extracts the
// condition's dependencies (the exact fact keys and count patterns it reads) so a watcher
// (`onConditionChanged`) only re-evaluates it when one of those facts changes. `explain` reports why
// a condition holds or not, node by node, for debug tools and designer error messages. Evaluation
// only reads the fact store, so it is deterministic and needs no clock or randomness. The language
// guide is docs/design/conditions.md.

import { factChanged, factTemplateOf, isFactKey, type FactChange, type FactValue } from './store';
import type { EventHandler, EventType } from '../core/events';

/** The deepest a condition may nest (a lone leaf is depth 1; each all/any/not adds one). */
export const CONDITION_MAX_DEPTH = 64;

const SEGMENT = '[a-z0-9]+(?:-[a-z0-9]+)*';

/**
 * A count pattern: `entity:<level>/*.<fact>` counts one level's entities, `entity:*\/*.<fact>` every
 * level's. The content layer mirrors it (checked by tests/contracts/conditions.test.ts).
 */
export const COUNT_PATTERN = new RegExp(
  `^entity:(${SEGMENT}|\\*)/\\*\\.(${SEGMENT}(?:\\.${SEGMENT})*)$`,
);

/** Comparison operators, shared by fact and count conditions. */
export const CONDITION_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** A fact test. With no operator the fact must be `true`; with one, that comparison must hold. */
export interface FactCondition {
  readonly fact: string;
  readonly eq?: FactValue | undefined;
  readonly neq?: FactValue | undefined;
  readonly gt?: number | undefined;
  readonly gte?: number | undefined;
  readonly lt?: number | undefined;
  readonly lte?: number | undefined;
  /** True: the fact holds a value (set, or declared with a default); false: it holds none. */
  readonly has?: boolean | undefined;
}

/** How many entity facts matching `count` hold `true`, compared with exactly one operator. */
export interface CountCondition {
  readonly count: string;
  readonly eq?: number | undefined;
  readonly neq?: number | undefined;
  readonly gt?: number | undefined;
  readonly gte?: number | undefined;
  readonly lt?: number | undefined;
  readonly lte?: number | undefined;
}

/** True when every condition holds. */
export interface AllCondition {
  readonly all: readonly Condition[];
}

/** True when at least one condition holds. */
export interface AnyCondition {
  readonly any: readonly Condition[];
}

/** True when the condition does not hold. */
export interface NotCondition {
  readonly not: Condition;
}

/** A condition over world facts (see the header and docs/design/conditions.md). */
export type Condition = FactCondition | CountCondition | AllCondition | AnyCondition | NotCondition;

/** What a condition reads: a fact store, or anything shaped like one. */
export interface FactReader {
  get(key: string): FactValue | undefined;
  entries(prefix?: string): readonly (readonly [string, FactValue])[];
}

/** Thrown for a malformed condition; the message names where in the condition the problem is. */
export class ConditionError extends Error {
  override readonly name = 'ConditionError';

  constructor(
    /** Where in the condition, e.g. `all[1].not`; empty for the root. */
    readonly path: string,
    detail: string,
  ) {
    super(`invalid condition${path === '' ? '' : ` at ${path}`}: ${detail}`);
  }
}

const KINDS = ['fact', 'count', 'all', 'any', 'not'] as const;

type Check = (value: unknown) => boolean;
const isInt: Check = (value) => Number.isSafeInteger(value);
const isFactValue: Check = (value) =>
  typeof value === 'boolean' || (typeof value === 'string' && value !== '') || isInt(value);

const FACT_OPERANDS: Readonly<Record<string, Check>> = {
  eq: isFactValue,
  neq: isFactValue,
  gt: isInt,
  gte: isInt,
  lt: isInt,
  lte: isInt,
  has: (value) => typeof value === 'boolean',
};

const COUNT_OPERANDS: Readonly<Record<string, Check>> = {
  eq: isInt,
  neq: isInt,
  gt: isInt,
  gte: isInt,
  lt: isInt,
  lte: isInt,
};

/** A value known to be present by construction (noUncheckedIndexedAccess can't see it). */
const known = <T>(value: T | undefined): T => value as T;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const join = (path: string, key: string): string => (path === '' ? key : `${path}.${key}`);

/** Checks a leaf's operators: known, well typed, at most one (exactly one when `required`). */
function checkOperators(
  node: Readonly<Record<string, unknown>>,
  kind: string,
  path: string,
  operands: Readonly<Record<string, Check>>,
  required: boolean,
): void {
  const operators = Object.keys(node).filter((key) => key !== kind);
  for (const op of operators) {
    const check = Object.hasOwn(operands, op) ? operands[op] : undefined;
    if (check === undefined) {
      throw new ConditionError(path, `"${op}" is not an operator of a ${kind} condition`);
    }
    if (!check(node[op])) {
      throw new ConditionError(join(path, op), `invalid operand ${JSON.stringify(node[op])}`);
    }
  }
  if (operators.length > 1) {
    throw new ConditionError(
      path,
      `a ${kind} condition takes one operator, got ${operators.join(', ')}`,
    );
  }
  if (required && operators.length === 0) {
    throw new ConditionError(path, `a ${kind} condition needs an operator (eq, gte…)`);
  }
}

/**
 * Checks a condition's shape without recursion (a hostile input cannot overflow the stack) and
 * returns its depth.
 * @throws ConditionError naming the first problem found.
 */
export function validateCondition(condition: unknown): number {
  const stack: { node: unknown; path: string; depth: number }[] = [
    { node: condition, path: '', depth: 1 },
  ];
  let deepest = 0;
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { node, path, depth } = item;
    if (depth > CONDITION_MAX_DEPTH) {
      throw new ConditionError(
        path,
        `nested more than ${String(CONDITION_MAX_DEPTH)} levels deep; split it into smaller conditions`,
      );
    }
    deepest = Math.max(deepest, depth);
    if (!isRecord(node)) throw new ConditionError(path, 'a condition must be an object');
    const kinds = KINDS.filter((kind) => Object.hasOwn(node, kind));
    const [kind] = kinds;
    if (kind === undefined || kinds.length > 1) {
      throw new ConditionError(
        path,
        `a condition has exactly one of fact, count, all, any, not; got {${Object.keys(node).join(', ')}}`,
      );
    }
    if (kind === 'fact') {
      if (typeof node['fact'] !== 'string' || !isFactKey(node['fact'])) {
        throw new ConditionError(
          join(path, 'fact'),
          `${JSON.stringify(node['fact'])} is not a fact key`,
        );
      }
      checkOperators(node, kind, path, FACT_OPERANDS, false);
    } else if (kind === 'count') {
      if (typeof node['count'] !== 'string' || !COUNT_PATTERN.test(node['count'])) {
        throw new ConditionError(
          join(path, 'count'),
          `${JSON.stringify(node['count'])} is not a count pattern ("entity:<level>/*.<fact>" or "entity:*/*.<fact>")`,
        );
      }
      checkOperators(node, kind, path, COUNT_OPERANDS, true);
    } else {
      if (Object.keys(node).length > 1) {
        throw new ConditionError(path, `a ${kind} condition has no other fields`);
      }
      const children = node[kind];
      if (kind === 'not') {
        stack.push({ node: children, path: join(path, 'not'), depth: depth + 1 });
      } else if (!Array.isArray(children) || children.length === 0) {
        throw new ConditionError(join(path, kind), 'must be a non-empty list of conditions');
      } else {
        for (let i = children.length - 1; i >= 0; i--) {
          const at = `${join(path, kind)}[${String(i)}]`;
          stack.push({ node: children[i] as unknown, path: at, depth: depth + 1 });
        }
      }
    }
  }
  return deepest;
}

/** A count condition's pattern, parsed. */
interface CountPattern {
  /** Level id, or null for every level. */
  readonly level: string | null;
  /** The governing template, `entity:*.<fact>`. */
  readonly template: string;
}

function parsePattern(pattern: string): CountPattern {
  const [, level, name] = COUNT_PATTERN.exec(pattern) as unknown as [string, string, string];
  return { level: level === '*' ? null : level, template: `entity:*.${name}` };
}

const matches = (pattern: CountPattern, key: string): boolean =>
  factTemplateOf(key) === pattern.template &&
  (pattern.level === null || key.startsWith(`entity:${pattern.level}/`));

/** How many facts matching `pattern` hold `true`. */
function countTrue(facts: FactReader, pattern: CountPattern): number {
  const prefix = pattern.level === null ? 'entity:' : `entity:${pattern.level}/`;
  let count = 0;
  for (const [key, value] of facts.entries(prefix)) {
    if (value === true && matches(pattern, key)) count++;
  }
  return count;
}

const SYMBOLS: Readonly<Record<ConditionOperator, string>> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
};

function compare(
  op: ConditionOperator,
  actual: FactValue | undefined,
  expected: FactValue,
): boolean {
  if (op === 'eq') return actual === expected;
  if (op === 'neq') return actual !== expected;
  if (typeof actual !== 'number') return false;
  const bound = expected as number;
  switch (op) {
    case 'gt':
      return actual > bound;
    case 'gte':
      return actual >= bound;
    case 'lt':
      return actual < bound;
    case 'lte':
      return actual <= bound;
  }
}

/** The operator of a validated leaf, if it has one. */
function operatorOf(node: FactCondition | CountCondition): ConditionOperator | undefined {
  return CONDITION_OPERATORS.find((op) => node[op] !== undefined);
}

const show = (value: FactValue | undefined): string =>
  value === undefined ? 'unset' : JSON.stringify(value);

/** Readable text of a condition, e.g. `all(fact(a), fact(b) ≥ 3)`, for logs and debug tools. */
export function conditionText(condition: Condition): string {
  if ('fact' in condition) {
    const op = operatorOf(condition);
    if (op !== undefined) {
      return `fact(${condition.fact}) ${SYMBOLS[op]} ${show(condition[op])}`;
    }
    if (condition.has !== undefined) {
      return `fact(${condition.fact}) is ${condition.has ? 'set' : 'unset'}`;
    }
    return `fact(${condition.fact})`;
  }
  if ('count' in condition) {
    const op = known(operatorOf(condition));
    return `count(${condition.count}) ${SYMBOLS[op]} ${String(condition[op])}`;
  }
  if ('not' in condition) return `not(${conditionText(condition.not)})`;
  const [kind, children] = 'all' in condition ? ['all', condition.all] : ['any', condition.any];
  return `${kind}(${children.map(conditionText).join(', ')})`;
}

/** Why a condition holds or not: one node per condition node, children in order. */
export interface ConditionExplanation {
  /** The node's text (see `conditionText`). */
  readonly text: string;
  readonly result: boolean;
  /** For a leaf, what it read, e.g. `horn.fate is "dead"`, `count is 2`. */
  readonly actual?: string;
  readonly children: readonly ConditionExplanation[];
}

/** One node's evaluator and explainer. */
interface Node {
  evaluate(facts: FactReader): boolean;
  explain(facts: FactReader): ConditionExplanation;
}

function factNode(condition: FactCondition): Node {
  const { fact, has } = condition;
  const op = operatorOf(condition);
  const text = conditionText(condition);
  const test = (value: FactValue | undefined): boolean =>
    op !== undefined
      ? compare(op, value, known(condition[op]))
      : has !== undefined
        ? (value !== undefined) === has
        : value === true;
  return {
    evaluate: (facts) => test(facts.get(fact)),
    explain: (facts) => {
      const value = facts.get(fact);
      return { text, result: test(value), actual: `${fact} is ${show(value)}`, children: [] };
    },
  };
}

function countNode(condition: CountCondition, pattern: CountPattern): Node {
  const op = known(operatorOf(condition));
  const bound = known(condition[op]);
  const text = conditionText(condition);
  return {
    evaluate: (facts) => compare(op, countTrue(facts, pattern), bound),
    explain: (facts) => {
      const count = countTrue(facts, pattern);
      return {
        text,
        result: compare(op, count, bound),
        actual: `count is ${String(count)}`,
        children: [],
      };
    },
  };
}

function combinatorNode(
  condition: AllCondition | AnyCondition | NotCondition,
  children: Node[],
): Node {
  const text = conditionText(condition);
  const combine =
    'not' in condition
      ? (results: readonly boolean[]) => !results[0]
      : 'all' in condition
        ? (results: readonly boolean[]) => results.every(Boolean)
        : (results: readonly boolean[]) => results.some(Boolean);
  const evaluate =
    'not' in condition
      ? (facts: FactReader) => !known(children[0]).evaluate(facts)
      : 'all' in condition
        ? (facts: FactReader) => children.every((child) => child.evaluate(facts))
        : (facts: FactReader) => children.some((child) => child.evaluate(facts));
  return {
    evaluate,
    explain: (facts) => {
      // Explain every child (no short circuit), so the report shows all that fail.
      const explained = children.map((child) => child.explain(facts));
      return { text, result: combine(explained.map((e) => e.result)), children: explained };
    },
  };
}

/** A validated condition ready to evaluate, with its dependencies. Build with `compileCondition`. */
export class CompiledCondition {
  /** The exact fact keys the condition reads, sorted. */
  readonly facts: readonly string[];
  /** The count patterns the condition reads, sorted. */
  readonly patterns: readonly string[];
  private readonly keys: ReadonlySet<string>;
  private readonly parsedPatterns: readonly CountPattern[];

  /** @internal Use `compileCondition`. */
  constructor(
    readonly condition: Condition,
    /** How deeply the condition nests (a leaf is 1). */
    readonly depth: number,
    private readonly root: Node,
    keys: ReadonlySet<string>,
    patterns: ReadonlySet<string>,
  ) {
    this.keys = keys;
    this.facts = Object.freeze([...keys].sort());
    this.patterns = Object.freeze([...patterns].sort());
    this.parsedPatterns = this.patterns.map(parsePattern);
  }

  /** True when the condition holds for `facts`. */
  evaluate(facts: FactReader): boolean {
    return this.root.evaluate(facts);
  }

  /** Node-by-node account of the result against `facts` (see `formatExplanation`). */
  explain(facts: FactReader): ConditionExplanation {
    return this.root.explain(facts);
  }

  /** True when a change to fact `key` can change the result. */
  dependsOn(key: string): boolean {
    return this.keys.has(key) || this.parsedPatterns.some((pattern) => matches(pattern, key));
  }

  /** The condition's readable text. */
  toString(): string {
    return conditionText(this.condition);
  }
}

/**
 * Validates `condition`, builds its evaluator and extracts its dependencies. Content conditions are
 * validated at load, so this only fails for code-built ones.
 * @throws ConditionError for a malformed condition or one nested deeper than CONDITION_MAX_DEPTH.
 */
export function compileCondition(condition: Condition): CompiledCondition {
  const depth = validateCondition(condition);
  const keys = new Set<string>();
  const patterns = new Set<string>();
  // Recursion is safe: validation capped the depth.
  const build = (node: Condition): Node => {
    if ('fact' in node) {
      keys.add(node.fact);
      return factNode(node);
    }
    if ('count' in node) {
      patterns.add(node.count);
      return countNode(node, parsePattern(node.count));
    }
    const children = 'not' in node ? [node.not] : 'all' in node ? node.all : node.any;
    return combinatorNode(node, children.map(build));
  };
  const root = build(condition);
  return new CompiledCondition(condition, depth, root, keys, patterns);
}

/** Plain text of an explanation, one line per node: `✓`/`✗`, the node, what it read; indented. */
export function formatExplanation(explanation: ConditionExplanation, indent = ''): string {
  const actual = explanation.actual === undefined ? '' : ` (${explanation.actual})`;
  const line = `${indent}${explanation.result ? '✓' : '✗'} ${explanation.text}${actual}`;
  return [line, ...explanation.children.map((c) => formatExplanation(c, `${indent}  `))].join('\n');
}

/** What `onConditionChanged` needs from a world. */
export interface ConditionHost {
  readonly facts: FactReader;
  readonly events: {
    on<T>(type: EventType<T>, handler: EventHandler<T>): () => void;
  };
}

/** Called with the condition's new result and the fact change that caused it (null: `refresh`). */
export type ConditionCallback = (value: boolean, cause: FactChange | null) => void;

/** A live watch on a condition (see `onConditionChanged`). */
export interface ConditionSubscription {
  /** The result as of the last evaluation. */
  readonly value: boolean;
  /** The compiled condition being watched. */
  readonly condition: CompiledCondition;
  /**
   * Re-evaluates now and calls back if the result changed. Restoring a snapshot changes facts
   * without events, so call this after `World.restore`. Returns the current result.
   */
  refresh(): boolean;
  /** Stops watching; the callback is never called again. */
  unsubscribe(): void;
}

/**
 * Watches `condition` on `world`: evaluates it now, then re-evaluates it whenever a fact it depends
 * on changes (`factChanged`, delivered at the next phase boundary) and calls `callback` exactly once
 * per change of result. Changes batched in a transaction arrive as several events, but the callback
 * runs once, when the result first differs. Unrelated fact changes never evaluate the condition.
 * @throws ConditionError for a malformed condition.
 */
export function onConditionChanged(
  world: ConditionHost,
  condition: Condition | CompiledCondition,
  callback: ConditionCallback,
): ConditionSubscription {
  const compiled = condition instanceof CompiledCondition ? condition : compileCondition(condition);
  let value = compiled.evaluate(world.facts);
  let active = true;
  const update = (cause: FactChange | null): boolean => {
    const next = compiled.evaluate(world.facts);
    if (next !== value) {
      value = next;
      if (active) callback(next, cause);
    }
    return next;
  };
  const off = world.events.on(factChanged, (change) => {
    if (compiled.dependsOn(change.key)) update(change);
  });
  return {
    get value() {
      return value;
    },
    condition: compiled,
    refresh: () => update(null),
    unsubscribe: () => {
      active = false;
      off();
    },
  };
}
