import { applyWorldDelta, type NetWorldState, type ServerMessageOf } from '@platformer/shared';

export type DeltaResult =
  | { kind: 'applied'; state: NetWorldState }
  /** From an older run (level restarted): ignore. */
  | { kind: 'stale' }
  /** Base state missing or mismatched: ask the server for a keyframe. */
  | { kind: 'gap' };

/** Rebuilds full world states from keyframes + field-level deltas. */
export class WorldStateStore {
  run = 0;
  latest: NetWorldState | null = null;

  reset(run = 0): void {
    this.run = run;
    this.latest = null;
  }

  applySnapshot(message: ServerMessageOf<'snapshot'>): NetWorldState | null {
    if (message.run < this.run) return null;
    this.run = message.run;
    this.latest = message.state;
    return message.state;
  }

  applyDelta(message: ServerMessageOf<'delta'>): DeltaResult {
    if (message.run < this.run) return { kind: 'stale' };
    if (message.run > this.run || !this.latest || this.latest.tick !== message.baseTick) return { kind: 'gap' };
    this.latest = applyWorldDelta(this.latest, message.tick, message);
    return { kind: 'applied', state: this.latest };
  }
}
