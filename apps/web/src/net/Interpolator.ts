import { lerp, type NetPlayerState, type NetWorldState } from '@platformer/shared';

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
  /** Server tick until which traps can't hurt the player (drawn blinking). */
  invulnUntil: number;
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
    const { buffer } = this;
    const newest = buffer.at(-1);
    if (!newest) return out;

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
    const before = new Map<string, NetPlayerState>(a.players.map((p) => [p.id, p]));

    for (const pb of b.players) {
      const pa = before.get(pb.id);
      const snap = !pa || pa.tp !== pb.tp || pa.alive !== pb.alive;
      // Timers count down smoothly between states, unless a new swing / hit started in between
      // (then the newer state's fresh timer is the truth).
      const newSwing = snap || pa.attackSeq !== pb.attackSeq;
      const newHit = snap || pb.hurt > pa.hurt;
      out.set(pb.id, {
        id: pb.id,
        x: snap ? pb.x : lerp(pa.x, pb.x, t),
        y: snap ? pb.y : lerp(pa.y, pb.y, t),
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
        invulnUntil: pb.invulnUntil,
      });
    }
    return out;
  }
}
