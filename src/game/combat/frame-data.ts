// The combat sandbox's frame data (mw-e04.9): what the frame-data overlay (src/ui/frame-data.ts)
// shows, read from the sim after each tick — never written back. For every fighter (the knight, the
// attacker dummies, the training dummies): the move it performs, its phase and move tick, whether
// the invulnerability rule (dodge and wake-up i-frames) or its move's hyperarmor applies right now,
// the hit reaction holding it, its health and poise, and — from a DamageMeter listening to the sim's
// DamageApplied — the damage per second it has taken over the last 5 s of sim time.
//
// `sandboxFrameData` is plain JSON (the page publishes it on #app[data-frame-data] for the e2e);
// `frameDataView` formats it for the overlay. Frame numbers are sim ticks: slow motion changes how
// fast they pass, never their values.

import type { MoveTable } from '@content/index';
import {
  actionOf,
  AttackerDummyComponent,
  DamageApplied,
  healthOf,
  invulnerabilityRule,
  phaseAt,
  poiseOf,
  reactionOf,
  SandboxDummyComponent,
  ActionTimelineComponent,
  HitReactionComponent,
  type EntityId,
  type InvulnerabilityRule,
  type World,
} from '@sim/index';
import type { FrameDataModel, FramePhase } from '@ui/index';

/** Sim ticks the damage-per-second window covers (5 s at 60 Hz). */
export const DPS_WINDOW_TICKS = 300;

/** Tracks the damage every entity takes, for damage-per-second readouts. */
export class DamageMeter {
  readonly #hits = new Map<EntityId, { tick: number; total: number }[]>();
  readonly #off: () => void;

  constructor(
    world: World<never>,
    readonly windowTicks = DPS_WINDOW_TICKS,
  ) {
    this.#off = world.events.on(DamageApplied, ({ target, tick, total }) => {
      const list = this.#hits.get(target) ?? [];
      list.push({ tick, total });
      this.#hits.set(target, list);
    });
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
  }
}

/** One fighter's frame data. */
export interface FighterFrame {
  readonly entity: EntityId;
  readonly role: 'player' | 'attacker' | 'dummy';
  /** The move in progress, or null. */
  readonly move: string | null;
  readonly phase: FramePhase;
  /** Tick within the move (0 on its first startup tick), or null when idle. */
  readonly moveTick: number | null;
  readonly totalTicks: number | null;
  readonly iframes: boolean;
  readonly hyperarmor: boolean;
  /** The reaction holding it, with ticks left, or null. */
  readonly reaction: { readonly kind: string; readonly ticksLeft: number } | null;
  readonly health: { readonly current: number; readonly max: number } | null;
  readonly poise: { readonly current: number; readonly max: number } | null;
  /** Damage per second taken (a DamageMeter's window), or null without a meter. */
  readonly dps: number | null;
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
  const health = healthOf(world, entity);
  const poise = poiseOf(world, entity);
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
    reaction:
      reacting === undefined
        ? null
        : { kind: reacting.kind, ticksLeft: Math.max(0, reacting.endsAt - world.tick) },
    health: health === undefined ? null : { current: health.current, max: health.max },
    poise: poise === undefined ? null : { current: poise.current, max: poise.max },
    dps: meter === undefined ? null : meter.dps(entity, world.tick, world.clock.hz),
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
  return { tick: world.tick, hz: world.clock.hz, speed: options.speed ?? 1, fighters };
}

const ROLE_LABELS = { player: 'Knight', attacker: 'Attacker', dummy: 'Dummy' } as const;

/** Points as the overlay shows them: whole when whole, else one decimal. */
const points = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const meter = (m: { current: number; max: number } | null): string =>
  m === null ? '' : `${points(m.current)}/${points(m.max)}`;

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
      reaction: f.reaction === null ? '' : `${f.reaction.kind} ${String(f.reaction.ticksLeft)}`,
      health: meter(f.health),
      poise: meter(f.poise),
      dps: f.dps === null ? '' : f.dps.toFixed(1),
    })),
  };
}
