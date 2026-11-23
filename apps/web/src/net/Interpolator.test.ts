import { TICK_DT, type NetFoeState, type NetShotState, type NetWorldState } from '@platformer/shared';
import { describe, expect, it } from 'vitest';
import { Interpolator } from './Interpolator';

const world = (tick: number, foes: NetFoeState[], shots: NetShotState[] = []): NetWorldState => ({
  tick,
  players: [],
  collected: [],
  traps: [],
  props: [],
  foes,
  shots,
});

const foe = (overrides: Partial<NetFoeState>): NetFoeState => ({
  id: 1,
  kind: 'chicken',
  x: 0,
  y: 100,
  vx: 0,
  vy: 0,
  facing: 1,
  state: 'chase',
  t: 0,
  hp: 2,
  wall: 0,
  ...overrides,
});

const shot = (overrides: Partial<NetShotState>): NetShotState => ({
  id: 7,
  kind: 'stinger',
  x: 0,
  y: 0,
  vx: 120,
  vy: 0,
  hit: false,
  t: 0,
  ...overrides,
});

describe('Interpolator foes and shots', () => {
  it('glides a foe that keeps doing the same thing', () => {
    const interp = new Interpolator();
    interp.push(world(10, [foe({ x: 0, t: 0.5 })]));
    interp.push(world(13, [foe({ x: 30, t: 0.55 })]));
    const [sample] = interp.sampleFoes(11.5);
    expect(sample!.x).toBeCloseTo(15);
    expect(sample!.t).toBeCloseTo(0.525);
  });

  it('keeps showing the old state until the new one began', () => {
    const interp = new Interpolator();
    interp.push(world(10, [foe({ state: 'chase', t: 1 })]));
    // The peck began one tick before tick 13.
    interp.push(world(13, [foe({ state: 'attack', t: TICK_DT })]));
    expect(interp.sampleFoes(11)[0]).toMatchObject({ state: 'chase' });
    expect(interp.sampleFoes(11)[0]!.t).toBeCloseTo(1 + TICK_DT);
    expect(interp.sampleFoes(12.5)[0]).toMatchObject({ state: 'attack' });
    expect(interp.sampleFoes(12.5)[0]!.t).toBeCloseTo(TICK_DT / 2);
  });

  it('shows a new shot only once it was fired, wound back along its flight', () => {
    const interp = new Interpolator();
    interp.push(world(10, []));
    interp.push(world(13, [], [shot({ x: 50, t: TICK_DT })]));
    expect(interp.sampleShots(11)).toEqual([]);
    const [s] = interp.sampleShots(12.5);
    expect(s!.x).toBeCloseTo(50 - 120 * TICK_DT * 0.5);
  });

  it('flies a shot on until the moment it hit', () => {
    const interp = new Interpolator();
    interp.push(world(10, [], [shot({ x: 0, t: 0.2 })]));
    interp.push(world(13, [], [shot({ x: 20, vx: 0, hit: true, t: TICK_DT })]));
    expect(interp.sampleShots(11)[0]).toMatchObject({ hit: false });
    expect(interp.sampleShots(11)[0]!.x).toBeCloseTo(120 * TICK_DT);
    expect(interp.sampleShots(12.5)[0]).toMatchObject({ hit: true, x: 20 });
  });
});
