import { TRAP_CONFIG, type CompiledTraps } from '../../config/traps';
import type { LevelData } from '../../level/types';
import type { Rect } from '../../util/math';
import { fallingCycleTicks, fallingPlatformState, fanOn, rockHeadRect, sawCenter, type FallingState } from './motion';
import type {
  FallingPlatformTrap,
  FanTrap,
  NetTrapState,
  TrapCollider,
  TrapDef,
  TrapHazard,
} from './types';

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

  constructor(
    traps: readonly TrapDef[],
    readonly config: Readonly<CompiledTraps> = TRAP_CONFIG,
  ) {
    this.traps = traps;
    for (const trap of traps) this.byId.set(trap.id, trap);
    this.fans = traps.filter((t): t is FanTrap => t.kind === 'fan');
    this.hasColliders = traps.some((t) => COLLIDER_KINDS.has(t.kind));
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
    return copy;
  }

  // --- replication -----------------------------------------------------------------------------

  toNet(): NetTrapState[] {
    const ids = new Set([...this.hits.keys(), ...this.triggers.keys(), ...this.boxPos.keys(), ...this.taken]);
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
        return entry;
      });
  }

  /** Replaces the replicated state with the server's. */
  applyNet(states: readonly NetTrapState[]): void {
    this.hits.clear();
    this.triggers.clear();
    this.boxPos.clear();
    this.taken.clear();
    for (const s of states) {
      if (s.hits !== undefined) this.hits.set(s.id, s.hits);
      if (s.trigger !== undefined) this.triggers.set(s.id, s.trigger);
      if (s.x !== undefined && s.y !== undefined) this.boxPos.set(s.id, { x: s.x, y: s.y });
      if (s.taken) this.taken.add(s.id);
    }
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
    if (trap?.kind !== 'fallingPlatform') return false;
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
        return { ...base, x: trap.x, y: trap.y, width: trap.width, height: trap.height, oneWay: true, bounce: trap.launch };
      case 'fallingPlatform': {
        const state = this.fallingState(trap, tick);
        if (state.phase === 'gone') return null;
        return { ...base, x: trap.x, y: trap.y + state.dy, width: trap.width, height: trap.height, oneWay: true, bounce: 0 };
      }
      case 'rockHead':
        return { ...base, ...rockHeadRect(trap, tick), oneWay: false, bounce: 0 };
      case 'spikeHead':
        return { ...base, x: trap.x, y: trap.y, width: trap.width, height: trap.height, oneWay: false, bounce: 0 };
      case 'box': {
        const rect = this.boxRect(trap.id);
        if (!rect) return null;
        return { ...base, ...rect, oneWay: false, bounce: this.config.box.stompBounce };
      }
      default:
        return null;
    }
  }

  /** Everything that hurts on overlap at `tick`. */
  hazards(tick: number): TrapHazard[] {
    const out: TrapHazard[] = [];
    const s = this.config.spikes;
    for (const trap of this.traps) {
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
          const c = sawCenter(trap, tick);
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
      if (box.x < s.x + s.width && box.x + box.width > s.x && box.y < s.y + s.height && box.y + box.height > s.y && fanOn(fan, tick)) {
        out.push(fan);
      }
    }
    return out;
  }
}

const COLLIDER_KINDS = new Set<TrapDef['kind']>(['trampoline', 'fallingPlatform', 'rockHead', 'spikeHead', 'box']);
