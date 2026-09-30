# Conditions

One predicate language gates everything on world state (mw-e27.5): dialogue lines, quest stages,
puzzle goals, shops, AI and level variants all ask "was the minotaur befriended, and is the cellar
still open?" the same way. A condition is plain JSON, checked when content loads and evaluated by
the sim over the world's facts (`src/sim/facts/conditions.ts`). Field reference, generated from the
schema: [condition schema](../content/condition-schema.md). Facts themselves are declared in the
[fact registry](../content/fact-schema.md) (`src/content/data/fact/`).

## The language

A condition is an object with exactly one of `fact`, `count`, `all`, `any` or `not`.

| Condition                                        | Holds when                                                      |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `{ "fact": "horn.befriended" }`                  | the bool fact is `true`                                         |
| `{ "fact": "horn.fate", "eq": "alive" }`         | the fact equals the value (`neq`: does not; unset is unequal)   |
| `{ "fact": "horn.rescues", "gte": 3 }`           | the int or tick fact compares (`gt`, `gte`, `lt`, `lte`)        |
| `{ "fact": "bell.rung-by", "has": true }`        | the fact holds a value: set, or declared with a non-null default |
| `{ "count": "entity:mine/*.looted", "gte": 3 }`  | that many entity facts matching the pattern are `true`          |
| `{ "all": [ … ] }`                               | every condition in the list holds                               |
| `{ "any": [ … ] }`                               | at least one holds                                              |
| `{ "not": { … } }`                               | the condition does not hold                                     |

A fact test takes at most one operator; a count takes exactly one. `count` patterns are
`entity:<level>/*.<fact>` (one level's entities) or `entity:*/*.<fact>` (every level's), and count
only facts that have been written, so a chest nobody touched never counts. Unset facts never
satisfy `gt`/`gte`/`lt`/`lte`.

Example: `all(fact(minotaur.befriended), not(fact(cellar.sealed)))` is written

```json
{ "all": [{ "fact": "minotaur.befriended" }, { "not": { "fact": "cellar.sealed" } }] }
```

and that text form, `all(fact(a), fact(b) ≥ 3)`, is how debug tools and logs show conditions.

## What load checks

- **Shape** (the schema): every node is one kind, operators are known and well typed, lists are
  non-empty, and nesting is at most **64** levels (a lone leaf is 1; each `all`/`any`/`not` adds 1).
  Deeper conditions are rejected with the path to the 65th level: split them into named conditions.
- **Facts** (`src/content/condition-checks.ts`, against the registry): every fact is declared
  (exactly, or by its `entity:*.<fact>` template); a bare test or a `true`/`false` needs a bool fact;
  `gt`/`gte`/`lt`/`lte` need an int or tick fact; an enum compares only with one of its values; an
  id with a content id; a count pattern names a declared bool template. Errors name the file, the
  JSON pointer and the fact.

## Where conditions live

- **Inline** in any content type that gates on world state: embed `conditionSchema` for the field
  and add a line to `CONDITION_USAGES` (`src/content/condition-checks.ts`) so its facts are checked.
  Dialogue (mw-e22) and quests (mw-e23) do this rather than inventing their own predicates.
- **Named** in `src/content/data/condition/<id>.json` (`id`, `name`, `notes`, `when`) when several
  systems share one, e.g. `horn-ally`.

## Using conditions from systems

```ts
const compiled = compileCondition(entry.when); // validates, extracts dependencies
compiled.evaluate(world.facts); // boolean; reads facts only, deterministic
compiled.facts; // exact fact keys it reads
compiled.patterns; // count patterns it reads
compiled.dependsOn('entity:mine/chest-3.looted'); // can this change affect it?
formatExplanation(compiled.explain(world.facts)); // ✓/✗ per node, with the values read

const watch = onConditionChanged(world, compiled, (value, cause) => {
  // runs once per change of result, at the phase boundary after the fact changed
});
watch.refresh(); // after World.restore: restoring changes facts without events
watch.unsubscribe();
```

`onConditionChanged` evaluates only when a fact the condition depends on changes, and calls back
exactly once per change of result, even when a transaction changes several of its facts at once.
Conditions are compiled from code as well as content; a malformed one throws a `ConditionError`
naming where it is.

Out of scope here: puzzle goals over live world properties (mw-e15.2) extend this language.
