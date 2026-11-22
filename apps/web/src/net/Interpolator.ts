import { lerp, type NetPlayerState, type NetPropState, type NetWorldState } from '@platformer/shared';

export interface RemoteSample {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  alive: boolean;
  atExit: boolean;
  tp: number;
  /** Swing / stun timers (s) and swing counter, for the animation state machine. */
  attack: number;
  attackSeq: number;
  hurt: number;
  /** Mid-air jumps left; a decrease while airborne is a double jump. */
  airJumpsLeft: number;
  /** Server tick until which traps can't hurt the player (drawn blinking). */
  invulnUntil: number;
  /** Special ability (timers in seconds; see `MovementBody`). */
  phase: number;
  phaseTime: number;
  specialCooldown: number;
  specialSeq: number;
  aim: number;
  reach: number;
  giant: number;
  droneX: number;
  droneY: number;
  droneVx: number;
  droneVy: number;
  cargo: number;
  held: number;
  flight: number;
  /** What the ability holds (`p:<id>`, `b:<id>` or ''). */
  grab: string;
}

interface Bracket {
  a: NetWorldState;
  b: NetWorldState;
  t: number;
}

/**
 * Buffers recent world states and samples remote players at a render time slightly in the
 * past (`interpolationDelayMs`), so movement stays smooth despite 20 Hz updates and jitter.
 * Never interpolates across a teleport (`tp` change) or a death/respawn.
 */
export class Interpolator {
  private buffer: NetWorldState[] = [];

  constructor(private readonly capacity = 32) {}

  get size(): number {
    return this.buffer.length;
  }

  get newestTick(): number | null {
    return this.buffer.at(-1)?.tick ?? null;
  }

  get oldestTick(): number | null {
    return this.buffer[0]?.tick ?? null;
  }

  get newest(): NetWorldState | null {
    return this.buffer.at(-1) ?? null;
  }

  clear(): void {
    this.buffer = [];
  }

  push(state: NetWorldState): void {
    const last = this.buffer.at(-1);
    if (last && state.tick < last.tick) return;
    if (last && state.tick === last.tick) this.buffer[this.buffer.length - 1] = state;
    else this.buffer.push(state);
    if (this.buffer.length > this.capacity) this.buffer.splice(0, this.buffer.length - this.capacity);
  }

  /** All players present in the newer bracketing state, interpolated at `renderTick`. */
  sample(renderTick: number): Map<string, RemoteSample> {
    const out = new Map<string, RemoteSample>();
    const bracket = this.bracket(renderTick);
    if (!bracket) return out;
    const { a, b, t } = bracket;
    const before = new Map<string, NetPlayerState>(a.players.map((p) => [p.id, p]));

    for (const pb of b.players) {
      const pa = before.get(pb.id);
      const snap = !pa || pa.tp !== pb.tp || pa.alive !== pb.alive;
      // Timers count down smoothly between states, unless a new swing / hit started in between
      // (then the newer state's fresh timer is the truth).
      const newSwing = snap || pa.attackSeq !== pb.attackSeq;
      const newHit = snap || pb.hurt > pa.hurt;
      // Ability timers and the drone glide between states while the phase stays the same.
      const samePhase = !snap && pa.phase === pb.phase;
      const droneGlide = samePhase && pa.phase !== 0;
      // Held / spat bodies are placed by the server each tick: interpolate unless just grabbed.
      const jump = snap || (pa.held === 0) !== (pb.held === 0);
      out.set(pb.id, {
        id: pb.id,
        x: jump ? pb.x : lerp(pa.x, pb.x, t),
        y: jump ? pb.y : lerp(pa.y, pb.y, t),
        vx: pb.vx,
        vy: pb.vy,
        facing: pb.facing,
        grounded: snap || t >= 0.5 ? pb.grounded : pa.grounded,
        alive: pb.alive,
        atExit: pb.atExit,
        tp: pb.tp,
        attack: newSwing ? pb.attack : lerp(pa.attack, pb.attack, t),
        attackSeq: pb.attackSeq,
        hurt: newHit ? pb.hurt : lerp(pa.hurt, pb.hurt, t),
        airJumpsLeft: pb.airJumpsLeft,
        invulnUntil: pb.invulnUntil,
        phase: samePhase || snap ? pb.phase : t >= 0.5 ? pb.phase : pa.phase,
        phaseTime: samePhase ? lerp(pa.phaseTime, pb.phaseTime, t) : t >= 0.5 || snap ? pb.phaseTime : pa.phaseTime,
        specialCooldown: snap ? pb.specialCooldown : lerp(pa.specialCooldown, pb.specialCooldown, t),
        specialSeq: pb.specialSeq,
        aim: pb.aim,
        reach: samePhase ? lerp(pa.reach, pb.reach, t) : pb.reach,
        giant: snap ? pb.giant : lerp(pa.giant, pb.giant, t),
        droneX: droneGlide ? lerp(pa.droneX, pb.droneX, t) : pb.droneX,
        droneY: droneGlide ? lerp(pa.droneY, pb.droneY, t) : pb.droneY,
        droneVx: pb.droneVx,
        droneVy: pb.droneVy,
        cargo: pb.cargo,
        held: pb.held,
        flight: pb.flight,
        grab: pb.grab,
      });
    }
    return out;
  }

  /**
   * Ability props (carried / spat boxes) at `renderTick`. Props that only the newest state
   * knows about are included as they are there (a box just picked up must not vanish).
   */
  sampleProps(renderTick: number): NetPropState[] {
    const bracket = this.bracket(renderTick);
    if (!bracket) return [];
    const { a, b, t } = bracket;
    const before = new Map(a.props.map((p) => [p.id, p]));
    const out = new Map<number, NetPropState>();
    for (const pb of b.props) {
      const pa = before.get(pb.id);
      const glide = pa && pa.state === pb.state && pa.owner === pb.owner;
      out.set(pb.id, glide ? { ...pb, x: lerp(pa.x, pb.x, t), y: lerp(pa.y, pb.y, t) } : pb);
    }
    const newest = this.buffer.at(-1)!;
    if (newest !== b) for (const p of newest.props) if (!out.has(p.id)) out.set(p.id, p);
    return [...out.values()];
  }

  private bracket(renderTick: number): Bracket | null {
    const { buffer } = this;
    const newest = buffer.at(-1);
    if (!newest) return null;
    let a = newest;
    let b = newest;
    if (renderTick <= buffer[0]!.tick) {
      a = b = buffer[0]!;
    } else if (renderTick < newest.tick) {
      for (let i = buffer.length - 2; i >= 0; i--) {
        const candidate = buffer[i]!;
        if (candidate.tick <= renderTick) {
          a = candidate;
          b = buffer[i + 1]!;
          break;
        }
      }
    }
    const span = b.tick - a.tick;
    const t = span > 0 ? Math.min(1, Math.max(0, (renderTick - a.tick) / span)) : 1;
    return { a, b, t };
  }
}
