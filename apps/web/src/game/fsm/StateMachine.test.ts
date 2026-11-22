import { describe, expect, it } from 'vitest';
import { StateMachine, type StateChange } from './StateMachine';

type S = 'a' | 'b' | 'c';
interface Ctx {
  next?: S;
  interrupt?: S;
  reenter?: boolean;
}

function machine(log: string[], options: { loop?: boolean } = {}) {
  const state = (name: S) => ({
    enter: (_: Ctx, from: S | null) => log.push(`enter ${name} from ${from}`),
    exit: (_: Ctx, to: S) => log.push(`exit ${name} to ${to}`),
    update: (ctx: Ctx) => (options.loop ? (name === 'a' ? 'b' : 'a') : name === 'a' ? ctx.next : undefined),
  });
  return new StateMachine<S, Ctx>({
    initial: 'a',
    states: { a: state('a'), b: state('b'), c: state('c') },
    anyState: (ctx) => (ctx.interrupt ? { to: ctx.interrupt, reenter: ctx.reenter } : undefined),
    maxTransitionsPerUpdate: 4,
  });
}

describe('StateMachine', () => {
  it('enters the initial state on the first update, then follows update transitions in order', () => {
    const log: string[] = [];
    const fsm = machine(log);
    fsm.update({}, 16);
    expect(log).toEqual(['enter a from null']);
    fsm.update({ next: 'b' }, 16);
    expect(fsm.state).toBe('b');
    expect(log.slice(1)).toEqual(['exit a to b', 'enter b from a']);
  });

  it('lets anyState interrupt any state, and re-enters only when asked', () => {
    const log: string[] = [];
    const changes: StateChange<S>[] = [];
    const fsm = machine(log);
    fsm.onChange((c) => changes.push(c));
    fsm.update({}, 16);
    fsm.update({ interrupt: 'c' }, 16);
    expect(fsm.state).toBe('c');
    fsm.update({ interrupt: 'c' }, 16); // already there, no reenter: nothing happens
    expect(changes).toHaveLength(2);
    fsm.update({ interrupt: 'c', reenter: true }, 16);
    expect(changes.at(-1)).toEqual({ from: 'c', to: 'c', reentered: true });
    expect(log.slice(-2)).toEqual(['exit c to c', 'enter c from c']);
  });

  it('tracks time in state and resets it on transitions', () => {
    const fsm = machine([]);
    fsm.update({}, 16);
    fsm.update({}, 16);
    fsm.update({}, 16);
    expect(fsm.timeInState).toBe(32);
    fsm.update({ next: 'b' }, 16);
    expect(fsm.timeInState).toBe(0);
  });

  it('caps chained transitions so a cycle cannot hang a frame', () => {
    const log: string[] = [];
    const fsm = machine(log, { loop: true });
    fsm.update({}, 16);
    expect(log.filter((l) => l.startsWith('enter')).length).toBe(1 + 4);
  });

  it('supports forced transitions', () => {
    const fsm = machine([]);
    fsm.transition('b', {});
    expect(fsm.state).toBe('b');
    fsm.transition('c', {});
    expect(fsm.state).toBe('c');
  });
});
