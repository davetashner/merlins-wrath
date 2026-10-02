// The combat sandbox's frame data (mw-e04.9): what the frame-data overlay (src/ui/frame-data.ts)
// shows, read from the sim after each tick — never written back. For every fighter (the knight, the
// attacker dummies, the training dummies, and creatures, whose attacks run on the same move system,
// mw-e04.20): the move it performs, its phase and move tick, whether
// the invulnerability rule (dodge and wake-up i-frames) or its move's hyperarmor applies right now,
// the hit-stop freezing it (mw-e04.11: its tier and frozen ticks left), the hit reaction holding it,
// its parry (mw-e04.12: the parry's phase — startup, window, counter or recovery —, the Parried stun
// and ticks left, or "riposte ready" while a Parried foe is in its riposte reach), its health and poise, its
// bow (mw-e05.21: the selected arrow type, how many of it the quiver holds and the draw in progress),
// and — from a DamageMeter listening to the sim's DamageApplied — the damage per second it has taken
// over the last 5 s of sim time.
//
// `sandboxFrameData` is plain JSON (the page publishes it on #app[data-frame-data] for the e2e);
// `frameDataView` formats it for the overlay. Frame numbers are sim ticks: slow motion changes how
// fast they pass, never their values.

import type { MoveTable } from '@content/index';
import {
  actionOf,
  AttackerDummyComponent,
  BowComponent,
  DAMAGE_TAGS,
  DamageApplied,
  ENVIRONMENT_TAGS,
  healthOf,
  hitStopOf,
  HitStopComponent,
  invulnerabilityRule,
  parriedOf,
  parryPhaseOf,
  phaseAt,
  poiseOf,
  quiverCount,
  reactionOf,
  riposteTargetOf,
  SandboxDummyComponent,
  ActionTimelineComponent,
  CreatureComponent,
  HitReactionComponent,
  type EntityId,
  type InvulnerabilityRule,
  type ParryPhase,
  type World,
} from '@sim/index';
import type { FrameDataModel, FramePhase } from '@ui/index';

/** Sim ticks the damage-per-second window covers (5 s at 60 Hz). */
export const DPS_WINDOW_TICKS = 300;

/** What kind of environmental harm a packet was, from its tags (see src/sim/combat/environment). */
export type EnvironmentHarm = 'fall' | 'wall' | 'crush' | 'hazard' | 'environment';

/** The kind of environmental harm `tags` describe, or undefined when it is not environmental. */
export function environmentHarm(tags: readonly string[]): EnvironmentHarm | undefined {
  if (!tags.includes(DAMAGE_TAGS.environment)) return undefined;
  if (tags.includes(ENVIRONMENT_TAGS.wall)) return 'wall';
  for (const kind of [ENVIRONMENT_TAGS.fall, ENVIRONMENT_TAGS.crush, ENVIRONMENT_TAGS.hazard]) {
    if (tags.includes(kind)) return kind;
  }
  return 'environment';
}

/** The latest environmental harm an entity took. */
export interface EnvironmentHit {
  readonly kind: EnvironmentHarm;
  /** Damage dealt, after the damage model. */
  readonly amount: number;
  /** The tick it landed on. */
  readonly tick: number;
}

/** Tracks the damage every entity takes, for damage-per-second and environmental readouts. */
export class DamageMeter {
  readonly #hits = new Map<EntityId, { tick: number; total: number }[]>();
  readonly #environment = new Map<EntityId, EnvironmentHit>();
  readonly #off: () => void;

  constructor(
    world: World<never>,
    readonly windowTicks = DPS_WINDOW_TICKS,
  ) {
    this.#off = world.events.on(DamageApplied, ({ target, tick, total, tags }) => {
      const list = this.#hits.get(target) ?? [];
      list.push({ tick, total });
      this.#hits.set(target, list);
      const kind = environmentHarm(tags);
      if (kind !== undefined) this.#environment.set(target, { kind, amount: total, tick });
    });
  }

  /** The latest environmental harm `entity` took within the window ending at `tick`, or null. */
  environment(entity: EntityId, tick: number): EnvironmentHit | null {
    const hit = this.#environment.get(entity);
    return hit !== undefined && hit.tick > tick - this.windowTicks ? hit : null;
  }

  /** Damage per second `entity` took over the window ending at `tick` (0 without hits). */
  dps(entity: EntityId, tick: number, hz: number): number {
    const from = tick - this.windowTicks;
    const list = (this.#hits.get(entity) ?? []).filter((hit) => hit.tick > from);
    this.#hits.set(entity, list);
    const sum = list.reduce((total, hit) => total + hit.total, 0);
    return sum / (this.windowTicks / hz);
  }

  dispose(): void {
    this.#off();
    this.#hits.clear();
    this.#environment.clear();
  }
}

/** One fighter's frame data. */
export interface FighterFrame {
  readonly entity: EntityId;
  readonly role: 'player' | 'attacker' | 'dummy' | 'creature';
  /** The move in progress, or null. */
  readonly move: string | null;
  readonly phase: FramePhase;
  /** Tick within the move (0 on its first startup tick), or null when idle. */
  readonly moveTick: number | null;
  readonly totalTicks: number | null;
  readonly iframes: boolean;
  readonly hyperarmor: boolean;
  /** The hit-stop freezing it, with frozen ticks left, or null (mw-e04.11). */
  readonly hitStop: { readonly tier: string; readonly ticksLeft: number } | null;
  /** The reaction holding it, with ticks left, or null. */
  readonly reaction: { readonly kind: string; readonly ticksLeft: number } | null;
  /** The phase of the parry it performs (mw-e04.12: window, counter…), or null. */
  readonly parry: ParryPhase | null;
  /** Ticks left of its Parried stun, or null when it is not Parried. */
  readonly parried: number | null;
  /** A Parried foe is in its riposte reach: its attack would riposte now. */
  readonly riposte: boolean;
  readonly health: { readonly current: number; readonly max: number } | null;
  readonly poise: { readonly current: number; readonly max: number } | null;
  /** Damage per second taken (a DamageMeter's window), or null without a meter. */
  readonly dps: number | null;
  /** The latest environmental harm taken in the meter's window, or null (also without a meter). */
  readonly environment: EnvironmentHit | null;
  /** Its bow (mw-e05.21), or null without one. */
  readonly bow: FighterBow | null;
}

/** A fighter's bow in the frame data. */
export interface FighterBow {
  /** The bow is out. */
  readonly equipped: boolean;
  /** The arrow type the next draw nocks, and how many of it the quiver holds. */
  readonly selected: string;
  readonly count: number;
  /** Ticks drawn, or null when not drawing. */
  readonly draw: number | null;
}

/** The frame data of one tick. */
export interface SandboxFrameData {
  /** The world tick the data was read after (the tick the next step will simulate). */
  readonly tick: number;
  /** Sim ticks per second. */
  readonly hz: number;
  /** Sim speed (the frame loop's time scale: 0.25 in slow motion). */
  readonly speed: number;
  readonly fighters: readonly FighterFrame[];
}

/** What `sandboxFrameData` reads. */
export interface FrameDataOptions {
  /** The action timeline's move table. */
  readonly moves: MoveTable;
  /** The player entity, shown first. */
  readonly player?: EntityId;
  readonly meter?: DamageMeter;
  /** The frame loop's time scale (default 1). */
  readonly speed?: number;
}

function fighter(
  world: World<never>,
  entity: EntityId,
  role: FighterFrame['role'],
  options: FrameDataOptions,
  invulnerable: InvulnerabilityRule,
): FighterFrame {
  const { moves, meter } = options;
  const timeline = world.isRegistered(ActionTimelineComponent)
    ? world.get(entity, ActionTimelineComponent)
    : undefined;
  const running = timeline === undefined ? undefined : actionOf(world, entity);
  const move = running === undefined ? undefined : moves.get(running.move);
  let phase: FramePhase = (timeline?.lockTicks ?? 0) > 0 ? 'locked' : 'idle';
  if (running !== undefined && move !== undefined) phase = phaseAt(move, running.tick);
  const armor = move?.hyperarmor ?? null;
  const reacting = world.isRegistered(HitReactionComponent) ? reactionOf(world, entity) : undefined;
  const frozen = world.isRegistered(HitStopComponent) ? hitStopOf(world, entity) : undefined;
  const stun = parriedOf(world, entity);
  const health = healthOf(world, entity);
  const poise = poiseOf(world, entity);
  const bow = world.isRegistered(BowComponent) ? world.get(entity, BowComponent) : undefined;
  return {
    entity,
    role,
    move: running?.move ?? null,
    phase,
    moveTick: running?.tick ?? null,
    totalTicks: move?.totalTicks ?? null,
    iframes: invulnerable(world, entity),
    hyperarmor:
      running !== undefined &&
      armor !== null &&
      running.tick >= armor.from &&
      running.tick <= armor.to,
    hitStop: frozen === undefined ? null : { tier: frozen.tier, ticksLeft: frozen.ticksLeft },
    reaction:
      reacting === undefined
        ? null
        : { kind: reacting.kind, ticksLeft: Math.max(0, reacting.endsAt - world.tick) },
    parry: parryPhaseOf(world, entity, moves) ?? null,
    parried: stun === undefined ? null : stun.ticksLeft,
    riposte: riposteTargetOf(world, entity) !== undefined,
    health: health === undefined ? null : { current: health.current, max: health.max },
    poise: poise === undefined ? null : { current: poise.current, max: poise.max },
    dps: meter === undefined ? null : meter.dps(entity, world.tick, world.clock.hz),
    environment: meter?.environment(entity, world.tick) ?? null,
    bow:
      bow === undefined
        ? null
        : {
            equipped: bow.equipped,
            selected: bow.selected,
            count: quiverCount(world, entity, bow.selected),
            draw: bow.draw?.ticks ?? null,
          },
  };
}

/** The frame data of every fighter now (see the file header). */
export function sandboxFrameData(world: World<never>, options: FrameDataOptions): SandboxFrameData {
  const fighters: FighterFrame[] = [];
  const { player } = options;
  const invulnerable = invulnerabilityRule(options.moves);
  const add = (entity: EntityId, role: FighterFrame['role']) => {
    fighters.push(fighter(world, entity, role, options, invulnerable));
  };
  if (player !== undefined && world.isAlive(player)) add(player, 'player');
  const attackers: EntityId[] = [];
  const dummies: EntityId[] = [];
  if (world.isRegistered(SandboxDummyComponent)) {
    world.query(SandboxDummyComponent).forEach((entity) => {
      (world.has(entity, AttackerDummyComponent) ? attackers : dummies).push(entity);
    });
  }
  for (const entity of attackers) add(entity, 'attacker');
  for (const entity of dummies) add(entity, 'dummy');
  if (world.isRegistered(CreatureComponent)) {
    for (const entity of world.query(CreatureComponent).ids()) add(entity, 'creature');
  }
  return { tick: world.tick, hz: world.clock.hz, speed: options.speed ?? 1, fighters };
}

const ROLE_LABELS = {
  player: 'Knight',
  attacker: 'Attacker',
  dummy: 'Dummy',
  creature: 'Creature',
} as const;

/** Points as the overlay shows them: whole when whole, else one decimal. */
const points = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const meter = (m: { current: number; max: number } | null): string =>
  m === null ? '' : `${points(m.current)}/${points(m.max)}`;

/** The overlay's parry cell: a Parried stun first, then the parry's phase, then a ready riposte. */
function parryText(f: FighterFrame): string {
  if (f.parried !== null) return `parried ${String(f.parried)}`;
  if (f.parry !== null) return f.parry;
  return f.riposte ? 'riposte ready' : '';
}

/** The overlay's arrows cell: "standard 20", "· draw 24" while drawing, "(away)" with the bow put away. */
function arrowsText(bow: FighterBow | null): string {
  if (bow === null) return '';
  const quiver = `${bow.selected} ${String(bow.count)}`;
  if (!bow.equipped) return `${quiver} (away)`;
  return bow.draw === null ? quiver : `${quiver} · draw ${String(bow.draw)}`;
}

/** The overlay's text for `data` (see src/ui/frame-data.ts). */
export function frameDataView(data: SandboxFrameData): FrameDataModel {
  const speed =
    data.speed === 1 ? '1× (F4: slow motion)' : `${String(data.speed)}× slow motion (F4)`;
  return {
    header: `tick ${String(data.tick)} · ${String(data.hz)} Hz · ${speed} · F3 hides`,
    rows: data.fighters.map((f) => ({
      key: String(f.entity),
      label:
        f.role === 'player' ? ROLE_LABELS.player : `${ROLE_LABELS[f.role]} #${String(f.entity)}`,
      move: f.move ?? '—',
      phase: f.phase,
      frame:
        f.moveTick === null || f.totalTicks === null
          ? ''
          : `${String(f.moveTick)}/${String(f.totalTicks)}`,
      iframes: f.iframes,
      hyperarmor: f.hyperarmor,
      hitStop: f.hitStop === null ? '' : `${f.hitStop.tier} ${String(f.hitStop.ticksLeft)}`,
      reaction: f.reaction === null ? '' : `${f.reaction.kind} ${String(f.reaction.ticksLeft)}`,
      parry: parryText(f),
      health: meter(f.health),
      poise: meter(f.poise),
      dps: f.dps === null ? '' : f.dps.toFixed(1),
      world: f.environment === null ? '' : `${f.environment.kind} ${points(f.environment.amount)}`,
      arrows: arrowsText(f.bow),
    })),
  };
}
