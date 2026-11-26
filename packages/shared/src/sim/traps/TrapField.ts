import { TRAP_CONFIG, type CompiledTraps } from '../../config/traps';
import type { LevelData } from '../../level/types';
import { rectsOverlap, type Rect, type Vec2 } from '../../util/math';
import { fallingCycleTicks, fallingPlatformState, fanOn, rockHeadRect, sawCenter, type FallingState } from './motion';
import {
  CLOCKED_KINDS,
  type ButtonTrap,
  type FallingPlatformTrap,
  type FanTrap,
  type NetTrapState,
  type RockHeadTrap,
  type SawTrap,
  type TrapCollider,
  type TrapDef,
  type TrapHazard,
} from './types';

/** A switched trap's own clock: `clock` ticks run before `since`, and running since `since` (null: stopped). */
interface TrapClock {
  clock: number;
  since: number | null;
}

/**
 * Runtime traps for one level run: the parsed definitions plus the little state that changes
 * (box hits, falling-platform triggers).
 *
 * Positions are never stored. Every query takes a tick and derives positions from the
 * definitions (`motion.ts`), so the server, the predicting client and the renderer agree on
 * where everything is. The server owns the state and replicates it (`toNet`); clients
 * overwrite theirs with `applyNet`.
 */
export class TrapField {
  readonly traps: readonly TrapDef[];
  readonly fans: readonly FanTrap[];
  /** True when any trap can block or carry a body (movement can skip all trap work otherwise). */
  readonly hasColliders: boolean;
  private readonly byId = new Map<number, TrapDef>();
  private readonly hits = new Map<number, number>();
  private readonly triggers = new Map<number, number>();
  /** Boxes moved by abilities (top-left), and boxes currently picked up. */
  private readonly boxPos = new Map<number, { x: number; y: number }>();
  private readonly taken = new Set<number>();
  /** Server bookkeeping for the box hit cooldown (not replicated). */
  private readonly lastHit = new Map<number, number>();
  readonly buttons: readonly ButtonTrap[];
  /**
   * Linked trap id -> the buttons switching it: it works while one of its `on` buttons is
   * pressed (or it has none) and none of its `off` buttons is.
   */
  private readonly switchedBy = new Map<number, { on: number[]; off: number[] }>();
  private readonly pressed = new Set<number>();
  /** Clocks of switched saws, fans and rock-heads that have run at least once. */
  private readonly clocks = new Map<number, TrapClock>();

  constructor(
    traps: readonly TrapDef[],
    readonly config: Readonly<CompiledTraps> = TRAP_CONFIG,
  ) {
    this.traps = traps;
    for (const trap of traps) this.byId.set(trap.id, trap);
    this.fans = traps.filter((t): t is FanTrap => t.kind === 'fan');
    this.hasColliders = traps.some((t) => COLLIDER_KINDS.has(t.kind));
    this.buttons = traps.filter((t): t is ButtonTrap => t.kind === 'button');
    for (const button of this.buttons) {
      for (const target of button.targets) {
        const lists = this.switchedBy.get(target) ?? { on: [], off: [] };
        lists[button.action].push(button.id);
        this.switchedBy.set(target, lists);
      }
    }
  }

  static forLevel(level: LevelData, config: Readonly<CompiledTraps> = TRAP_CONFIG): TrapField {
    return new TrapField(level.traps, config);
  }

  get(id: number): TrapDef | undefined {
    return this.byId.get(id);
  }

  /** Independent copy (same definitions, copied state). */
  clone(): TrapField {
    const copy = new TrapField(this.traps, this.config);
    for (const [id, hits] of this.hits) copy.hits.set(id, hits);
    for (const [id, tick] of this.triggers) copy.triggers.set(id, tick);
    for (const [id, tick] of this.lastHit) copy.lastHit.set(id, tick);
    for (const [id, pos] of this.boxPos) copy.boxPos.set(id, { ...pos });
    for (const id of this.taken) copy.taken.add(id);
    for (const id of this.pressed) copy.pressed.add(id);
    for (const [id, c] of this.clocks) copy.clocks.set(id, { ...c });
    return copy;
  }

  // --- replication -----------------------------------------------------------------------------

  toNet(): NetTrapState[] {
    const ids = new Set([
      ...this.hits.keys(),
      ...this.triggers.keys(),
      ...this.boxPos.keys(),
      ...this.taken,
      ...this.pressed,
      ...this.clocks.keys(),
    ]);
    return [...ids]
      .sort((a, b) => a - b)
      .map((id) => {
        const entry: NetTrapState = { id };
        const hits = this.hits.get(id);
        const trigger = this.triggers.get(id);
        if (hits !== undefined) entry.hits = hits;
        if (trigger !== undefined) entry.trigger = trigger;
        const pos = this.boxPos.get(id);
        if (pos) {
          entry.x = pos.x;
          entry.y = pos.y;
        }
        if (this.taken.has(id)) entry.taken = true;
        if (this.pressed.has(id)) entry.pressed = true;
        const clock = this.clocks.get(id);
        if (clock) {
          entry.clock = clock.clock;
          if (clock.since !== null) entry.since = clock.since;
        }
        return entry;
      });
  }

  /** Replaces the replicated state with the server's. */
  applyNet(states: readonly NetTrapState[]): void {
    this.hits.clear();
    this.triggers.clear();
    this.boxPos.clear();
    this.taken.clear();
    this.pressed.clear();
    this.clocks.clear();
    for (const s of states) {
      if (s.hits !== undefined) this.hits.set(s.id, s.hits);
      if (s.trigger !== undefined) this.triggers.set(s.id, s.trigger);
      if (s.x !== undefined && s.y !== undefined) this.boxPos.set(s.id, { x: s.x, y: s.y });
      if (s.taken) this.taken.add(s.id);
      if (s.pressed) this.pressed.add(s.id);
      if (s.clock !== undefined) this.clocks.set(s.id, { clock: s.clock, since: s.since ?? null });
    }
  }

  // --- buttons ---------------------------------------------------------------------------------

  isPressed(buttonId: number): boolean {
    return this.pressed.has(buttonId);
  }

  /** True when a button links to this trap. */
  isSwitched(id: number): boolean {
    return this.switchedBy.has(id);
  }

  /**
   * Whether a trap works: one of its `on` buttons is pressed (or it has none) and none of its
   * `off` buttons is. Traps no button links to always work.
   */
  isActive(id: number): boolean {
    const s = this.switchedBy.get(id);
    if (!s) return true;
    const enabled = s.on.length === 0 || s.on.some((b) => this.pressed.has(b));
    return enabled && !s.off.some((b) => this.pressed.has(b));
  }

  /** Switched on when the level starts (nothing pressed): it is linked to `off` buttons only. */
  private activeAtStart(id: number): boolean {
    const s = this.switchedBy.get(id);
    return !s || s.on.length === 0;
  }

  /**
   * The tick a trap's motion is computed at: the level clock, except for switched saws, fans
   * and rock-heads, which only count the ticks they ran while switched on (so they stop where
   * they are and carry on from there).
   */
  trapTick(id: number, tick: number): number {
    if (!this.switchedBy.has(id)) return tick;
    const c = this.clocks.get(id);
    // Never switched yet: running since the level started, or stopped at its start.
    if (!c) return this.activeAtStart(id) ? tick : 0;
    return c.since === null ? c.clock : c.clock + Math.max(0, tick - c.since);
  }

  /**
   * Presses the buttons that one of `pressers` (players' feet, boxes, reaching a pixel below
   * their bottom so resting on the cap counts) overlaps, releases the
   * others, and starts or stops the clocks of the traps they switch (server, once per tick).
   * Returns the buttons that changed.
   */
  updateButtons(tick: number, pressers: readonly Rect[]): { id: number; pressed: boolean }[] {
    const changed: { id: number; pressed: boolean }[] = [];
    if (this.buttons.length === 0) return changed;
    const wasActive = new Map<number, boolean>();
    for (const id of this.switchedBy.keys()) wasActive.set(id, this.isActive(id));
    for (const button of this.buttons) {
      const down = pressers.some((r) => rectsOverlap(r, button));
      if (down === this.pressed.has(button.id)) continue;
      if (down) this.pressed.add(button.id);
      else this.pressed.delete(button.id);
      changed.push({ id: button.id, pressed: down });
    }
    for (const [id, was] of wasActive) {
      const trap = this.byId.get(id);
      const now = this.isActive(id);
      if (now === was || !trap || !CLOCKED_KINDS.includes(trap.kind)) continue;
      const c = this.clocks.get(id) ?? { clock: 0, since: this.activeAtStart(id) ? 0 : null };
      if (now) c.since = tick;
      else if (c.since !== null) {
        c.clock += Math.max(0, tick - c.since);
        c.since = null;
      }
      this.clocks.set(id, c);
    }
    return changed;
  }

  // --- motion at a tick (switched traps on their own clock) ------------------------------------

  sawCenter(saw: SawTrap, tick: number): Vec2 {
    return sawCenter(saw, this.trapTick(saw.id, tick));
  }

  rockHeadRect(rock: RockHeadTrap, tick: number): Rect {
    return rockHeadRect(rock, this.trapTick(rock.id, tick));
  }

  fanOn(fan: FanTrap, tick: number): boolean {
    return this.isActive(fan.id) && fanOn(fan, this.trapTick(fan.id, tick));
  }

  // --- boxes -----------------------------------------------------------------------------------

  boxHits(id: number): number {
    return this.hits.get(id) ?? 0;
  }

  isBroken(id: number): boolean {
    const trap = this.byId.get(id);
    return trap?.kind === 'box' && this.boxHits(id) >= trap.maxHits;
  }

  /** Picked up by an ability: out of the level (no collider, not drawn) until placed again. */
  isTaken(id: number): boolean {
    return this.taken.has(id);
  }

  /** Where an intact box in the level is now (moved boxes included); null if broken or taken. */
  boxRect(id: number): Rect | null {
    const trap = this.byId.get(id);
    if (trap?.kind !== 'box' || this.isBroken(id) || this.taken.has(id)) return null;
    const pos = this.boxPos.get(id);
    return { x: pos?.x ?? trap.x, y: pos?.y ?? trap.y, width: trap.width, height: trap.height };
  }

  /** Intact boxes currently in the level. */
  boxes(): { id: number; rect: Rect; variant: 1 | 2 | 3 }[] {
    const out: { id: number; rect: Rect; variant: 1 | 2 | 3 }[] = [];
    for (const trap of this.traps) {
      if (trap.kind !== 'box') continue;
      const rect = this.boxRect(trap.id);
      if (rect) out.push({ id: trap.id, rect, variant: trap.variant });
    }
    return out;
  }

  /** Picks an intact box up (server). Returns its rect, or null if it can't be taken. */
  takeBox(id: number): Rect | null {
    const rect = this.boxRect(id);
    if (rect) this.taken.add(id);
    return rect;
  }

  /** Puts a taken box back into the level at a new top-left (server). */
  placeBox(id: number, x: number, y: number): void {
    const trap = this.byId.get(id);
    if (trap?.kind !== 'box') return;
    this.taken.delete(id);
    this.boxPos.set(id, { x, y });
  }

  /** Breaks a box for good (a spat box shattering), wherever it is (server). */
  destroyBox(id: number): void {
    const trap = this.byId.get(id);
    if (trap?.kind !== 'box') return;
    this.taken.delete(id);
    this.hits.set(id, trap.maxHits);
  }

  /**
   * `count` hits on a box (server). Returns the new hit count, or null when the id is not an
   * intact box in the level or it was hit too recently.
   */
  hitBox(id: number, tick: number, count = 1): { hits: number; broken: boolean } | null {
    const trap = this.byId.get(id);
    if (trap?.kind !== 'box' || this.isBroken(id) || this.taken.has(id)) return null;
    const last = this.lastHit.get(id);
    if (last !== undefined && tick - last < this.config.box.hitCooldownTicks) return null;
    const hits = Math.min(trap.maxHits, this.boxHits(id) + Math.max(1, count));
    this.hits.set(id, hits);
    this.lastHit.set(id, tick);
    return { hits, broken: hits >= trap.maxHits };
  }

  // --- falling platforms -----------------------------------------------------------------------

  triggerTick(id: number): number | null {
    return this.triggers.get(id) ?? null;
  }

  /** Starts a falling platform's countdown (someone stood on it). False if it is not idle. */
  trigger(id: number, tick: number): boolean {
    const trap = this.byId.get(id);
    if (trap?.kind !== 'fallingPlatform' || !this.isActive(id)) return false;
    const current = this.triggers.get(id);
    if (current !== undefined && tick < current + fallingCycleTicks(trap, this.config)) return false;
    this.triggers.set(id, tick);
    return true;
  }

  fallingState(platform: FallingPlatformTrap, tick: number): FallingState {
    return fallingPlatformState(platform, this.triggerTick(platform.id), tick, this.config);
  }

  /** Forgets finished falling cycles so the replicated state stays small. True if anything changed. */
  expire(tick: number): boolean {
    let changed = false;
    for (const [id, start] of this.triggers) {
      const trap = this.byId.get(id);
      if (trap?.kind === 'fallingPlatform' && tick >= start + fallingCycleTicks(trap, this.config)) {
        this.triggers.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  // --- geometry at a tick ----------------------------------------------------------------------

  /** Everything bodies collide with at `tick`. */
  colliders(tick: number): TrapCollider[] {
    const out: TrapCollider[] = [];
    if (!this.hasColliders) return out;
    for (const trap of this.traps) {
      const c = this.colliderOf(trap, tick);
      if (c) out.push(c);
    }
    return out;
  }

  /** One trap's collision box at `tick`, or null if it has none then. */
  colliderRect(id: number, tick: number): Rect | null {
    const trap = this.byId.get(id);
    return trap ? this.colliderOf(trap, tick) : null;
  }

  private colliderOf(trap: TrapDef, tick: number): TrapCollider | null {
    const base = { id: trap.id, kind: trap.kind };
    switch (trap.kind) {
      case 'trampoline':
        // Switched off, it is just a ledge.
        return { ...base, x: trap.x, y: trap.y, width: trap.width, height: trap.height, oneWay: true, bounce: this.isActive(trap.id) ? trap.launch : 0 };
      case 'fallingPlatform': {
        const state = this.fallingState(trap, tick);
        if (state.phase === 'gone') return null;
        return { ...base, x: trap.x, y: trap.y + state.dy, width: trap.width, height: trap.height, oneWay: true, bounce: 0 };
      }
      case 'rockHead':
        return { ...base, ...this.rockHeadRect(trap, tick), oneWay: false, bounce: 0 };
      case 'spikeHead':
        return { ...base, x: trap.x, y: trap.y, width: trap.width, height: trap.height, oneWay: false, bounce: 0 };
      case 'box': {
        const rect = this.boxRect(trap.id);
        if (!rect) return null;
        return { ...base, ...rect, oneWay: false, bounce: 0 };
      }
      case 'button':
        // One-way (jumped up through from below), and walked up onto from the side.
        return { ...base, x: trap.x, y: trap.y, width: trap.width, height: trap.height, oneWay: true, bounce: 0, step: true };
      default:
        return null;
    }
  }

  /** Everything that hurts on overlap at `tick`. */
  hazards(tick: number): TrapHazard[] {
    const out: TrapHazard[] = [];
    const s = this.config.spikes;
    for (const trap of this.traps) {
      if (!this.isActive(trap.id)) continue;
      switch (trap.kind) {
        case 'spikes': {
          // Trim the strip to the blades: the inset is measured from the tips' side.
          const { x, y, width: w, height: h } = trap;
          const side = s.insetSide;
          const tip = s.insetTop;
          const rect =
            trap.dir === 'up'
              ? { x: x + side, y: y + tip, width: w - 2 * side, height: h - tip }
              : trap.dir === 'down'
                ? { x: x + side, y, width: w - 2 * side, height: h - tip }
                : trap.dir === 'left'
                  ? { x: x + tip, y: y + side, width: w - tip, height: h - 2 * side }
                  : { x, y: y + side, width: w - tip, height: h - 2 * side };
          const base =
            trap.dir === 'up'
              ? { x: x + w / 2, y: y + h }
              : trap.dir === 'down'
                ? { x: x + w / 2, y }
                : trap.dir === 'left'
                  ? { x: x + w, y: y + h / 2 }
                  : { x, y: y + h / 2 };
          out.push({ id: trap.id, kind: trap.kind, rect, circle: null, sourceX: base.x, sourceY: base.y });
          break;
        }
        case 'saw': {
          const c = this.sawCenter(trap, tick);
          out.push({ id: trap.id, kind: trap.kind, rect: null, circle: { x: c.x, y: c.y, r: trap.radius }, sourceX: c.x, sourceY: c.y });
          break;
        }
        case 'spikeHead': {
          // Solid, so bodies only ever touch it: grow the hurt box by a pixel to catch contact.
          const rect = { x: trap.x - 1, y: trap.y - 1, width: trap.width + 2, height: trap.height + 2 };
          out.push({
            id: trap.id,
            kind: trap.kind,
            rect,
            circle: null,
            sourceX: trap.x + trap.width / 2,
            sourceY: trap.y + trap.height / 2,
          });
          break;
        }
        default:
          break;
      }
    }
    return out;
  }

  /** Fans blowing through `box` at `tick`. */
  windAt(box: Rect, tick: number): FanTrap[] {
    const out: FanTrap[] = [];
    for (const fan of this.fans) {
      const s = fan.stream;
      if (box.x < s.x + s.width && box.x + box.width > s.x && box.y < s.y + s.height && box.y + box.height > s.y && this.fanOn(fan, tick)) {
        out.push(fan);
      }
    }
    return out;
  }
}

const COLLIDER_KINDS = new Set<TrapDef['kind']>(['trampoline', 'fallingPlatform', 'rockHead', 'spikeHead', 'box', 'button']);
