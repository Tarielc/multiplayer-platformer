/**
 * A small, generic finite-state machine (no Phaser or React dependency), in the style of an
 * animator controller:
 *
 *  - each state may have `enter`, `exit` and `update`; `update` returns the next state (or
 *    nothing to stay), so transitions live next to the state they leave;
 *  - an optional `anyState` resolver runs first on every update and can interrupt whatever is
 *    playing (Unity's "Any State" transitions), optionally re-entering the current state;
 *  - chained transitions within one update are capped, so a cycle can't hang the frame.
 *
 * `C` is the per-update context (e.g. the latest signals) passed to every callback.
 */
export interface StateConfig<S extends string, C> {
  enter?: (ctx: C, from: S | null) => void;
  exit?: (ctx: C, to: S) => void;
  /** Returns the state to switch to, or nothing to stay. */
  update?: (ctx: C, dtMs: number) => S | void;
}

/** A transition request; `reenter` restarts the state even if it is already active. */
export type TransitionRequest<S extends string> = { to: S; reenter?: boolean };

export interface StateMachineOptions<S extends string, C> {
  initial: S;
  states: Readonly<Record<S, StateConfig<S, C>>>;
  /** Interrupt check that runs before the current state's `update`. */
  anyState?: (ctx: C, current: S) => TransitionRequest<S> | S | void;
  /** Max transitions per `update` call (default 8). */
  maxTransitionsPerUpdate?: number;
}

export interface StateChange<S extends string> {
  from: S | null;
  to: S;
  /** The state was restarted rather than changed. */
  reentered: boolean;
}

export class StateMachine<S extends string, C> {
  private current: S;
  private started = false;
  private elapsedMs = 0;
  private readonly listeners = new Set<(change: StateChange<S>) => void>();
  private readonly maxTransitions: number;

  constructor(private readonly options: StateMachineOptions<S, C>) {
    this.current = options.initial;
    this.maxTransitions = options.maxTransitionsPerUpdate ?? 8;
  }

  get state(): S {
    return this.current;
  }

  /** Milliseconds since the current state was (re)entered. */
  get timeInState(): number {
    return this.elapsedMs;
  }

  /** Subscribes to state changes; returns an unsubscribe function. */
  onChange(listener: (change: StateChange<S>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Runs one step: enters the initial state on the first call, then the `anyState` interrupt,
   * then the current state's `update` (following any chain of transitions it requests).
   */
  update(ctx: C, dtMs: number): S {
    if (!this.started) {
      this.started = true;
      this.options.states[this.current].enter?.(ctx, null);
      this.emit({ from: null, to: this.current, reentered: false });
    } else {
      this.elapsedMs += dtMs;
    }

    let transitions = 0;
    const interrupt = normalize<S>(this.options.anyState?.(ctx, this.current));
    if (interrupt && (interrupt.to !== this.current || interrupt.reenter)) {
      this.switchTo(interrupt.to, ctx);
      transitions += 1;
    }

    let stepMs = dtMs;
    while (transitions < this.maxTransitions) {
      const next = this.options.states[this.current].update?.(ctx, stepMs) as S | undefined;
      if (next === undefined || next === this.current) break;
      this.switchTo(next, ctx);
      transitions += 1;
      stepMs = 0; // chained states don't consume the frame's time again
    }
    return this.current;
  }

  /** Forces a transition from outside (e.g. a reset). */
  transition(to: S, ctx: C, options: { reenter?: boolean } = {}): void {
    if (to === this.current && !options.reenter && this.started) return;
    if (!this.started) {
      this.started = true;
      this.current = to;
      this.options.states[to].enter?.(ctx, null);
      this.emit({ from: null, to, reentered: false });
      return;
    }
    this.switchTo(to, ctx);
  }

  private switchTo(to: S, ctx: C): void {
    const from = this.current;
    this.options.states[from].exit?.(ctx, to);
    this.current = to;
    this.elapsedMs = 0;
    this.options.states[to].enter?.(ctx, from);
    this.emit({ from, to, reentered: from === to });
  }

  private emit(change: StateChange<S>): void {
    for (const listener of this.listeners) listener(change);
  }
}

function normalize<S extends string>(request: TransitionRequest<S> | S | void): TransitionRequest<S> | null {
  if (request === undefined) return null;
  return typeof request === 'string' ? { to: request } : request;
}
