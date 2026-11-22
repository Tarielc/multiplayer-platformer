import {
  Button,
  GameWorld,
  NEUTRAL_INPUT,
  PLAYER_CONFIG,
  TICK_DT,
  bodyFromNetState,
  resolveCombat,
  resolveMovement,
  type NetPlayerState,
  type NetWorldState,
  type ServerMessageOf,
} from '@platformer/shared';
import { asciiToLevel } from '@platformer/shared/dev';
import { describe, expect, it } from 'vitest';
import { Interpolator } from './Interpolator';
import { LocalPredictor } from './LocalPredictor';
import { ServerClock } from './ServerClock';
import { WorldStateStore } from './WorldStateStore';

// Walls, steps and one-way planks, but nothing that kills: prediction only models movement.
const ROWS = [
  '                        ',
  '                        ',
  '          -----         ',
  '                        ',
  '     ---         ##     ',
  '                 ##     ',
  ' 1      ##       ##     ',
  '########################',
];
const level = asciiToLevel({ rows: ROWS });
const movement = resolveMovement();
const ctx = { level, movement, hitbox: PLAYER_CONFIG.hitbox, combat: resolveCombat(), dt: TICK_DT };

function netPlayer(id: string, overrides: Partial<NetPlayerState> = {}): NetPlayerState {
  return {
    id,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: true,
    jumpHeld: false,
    jumping: false,
    coyote: 0,
    buffer: 0,
    drop: 0,
    alive: true,
    respawnIn: 0,
    score: 0,
    deaths: 0,
    atExit: false,
    checkpointId: null,
    tp: 0,
    attackHeld: false,
    attack: 0,
    attackCooldown: 0,
    attackSeq: 0,
    hurt: 0,
    ack: 0,
    ...overrides,
  };
}

const world = (tick: number, players: NetPlayerState[], collected: number[] = []): NetWorldState => ({ tick, players, collected });

describe('LocalPredictor', () => {
  it('agrees exactly with the server when inputs arrive in order (zero correction)', () => {
    const server = new GameWorld({ level, movement });
    server.addPlayer('me', 0);
    let ack = 0;
    const serverState = () => server.toNetState(() => ack).players[0]!;

    const predictor = new LocalPredictor(ctx);
    predictor.reconcile(serverState());

    const LATENCY = 6; // ticks each way (100 ms)
    const toServer: Array<{ at: number; seq: number; buttons: number }> = [];
    const toClient: Array<{ at: number; state: NetPlayerState }> = [];
    let seed = 42;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let buttons = NEUTRAL_INPUT;
    let maxCorrection = 0;

    const serverTick = (tick: number) => {
      while (toServer.length > 0 && toServer[0]!.at <= tick) {
        const frame = toServer.shift()!;
        server.stepPlayer('me', frame.buttons);
        ack = frame.seq;
      }
      server.endTick();
      if (tick % 3 === 0) toClient.push({ at: tick + LATENCY, state: serverState() });
    };
    const clientReceive = (tick: number) => {
      while (toClient.length > 0 && toClient[0]!.at <= tick) {
        predictor.reconcile(toClient.shift()!.state);
        maxCorrection = Math.max(maxCorrection, predictor.lastCorrection);
      }
    };

    for (let tick = 1; tick <= 900; tick++) {
      // Hold each input for a while; includes Attack, so swing timers must predict exactly too.
      if (random() < 0.08) buttons = Math.floor(random() * 32);
      predictor.step(tick, buttons);
      toServer.push({ at: tick + LATENCY, seq: tick, buttons });
      serverTick(tick);
      clientReceive(tick);
    }
    for (let tick = 901; tick <= 930; tick++) {
      serverTick(tick);
      clientReceive(tick);
    }

    expect(maxCorrection).toBe(0);
    expect(predictor.current!.attackSeq).toBeGreaterThan(0);
    expect(predictor.pendingCount).toBe(0);
    expect(predictor.current).toEqual(bodyFromNetState(serverState()));
  });

  it('converges exactly on the server after an unpredicted hit (stun + knockback)', () => {
    const server = new GameWorld({ level, movement });
    server.addPlayer('me', 0);
    server.addPlayer('bot', 1); // shares the only spawn: standing inside "me", facing right
    let ack = 0;
    const serverState = () => server.getPlayer('me')!;
    const net = () => server.toNetState(() => ack).players.find((p) => p.id === 'me')!;

    const predictor = new LocalPredictor(ctx);
    predictor.reconcile(net());
    const LATENCY = 6;
    const toServer: Array<{ at: number; seq: number; buttons: number }> = [];
    const toClient: Array<{ at: number; state: NetPlayerState }> = [];
    let wasHurt = false;
    let maxCorrection = 0;

    for (let tick = 1; tick <= 240; tick++) {
      const buttons = tick > 40 && tick < 100 ? Button.RIGHT | (tick === 70 ? Button.JUMP : 0) : NEUTRAL_INPUT;
      if (tick <= 200) {
        predictor.step(tick, buttons);
        toServer.push({ at: tick + LATENCY, seq: tick, buttons });
      }
      while (toServer.length > 0 && toServer[0]!.at <= tick) {
        const frame = toServer.shift()!;
        server.stepPlayer('me', frame.buttons);
        ack = frame.seq;
      }
      server.stepPlayer('bot', tick === 10 ? Button.ATTACK : NEUTRAL_INPUT);
      server.endTick();
      wasHurt ||= serverState().body.hurt > 0;
      if (tick % 3 === 0) toClient.push({ at: tick + LATENCY, state: net() });
      while (toClient.length > 0 && toClient[0]!.at <= tick) {
        predictor.reconcile(toClient.shift()!.state);
        maxCorrection = Math.max(maxCorrection, predictor.lastCorrection);
      }
    }

    expect(wasHurt).toBe(true);
    expect(maxCorrection).toBeGreaterThan(0); // the hit itself can't be predicted…
    expect(predictor.pendingCount).toBe(0);
    expect(predictor.current).toEqual(bodyFromNetState(net())); // …but replay converges exactly
  });

  it('hides small corrections behind an offset that decays', () => {
    const predictor = new LocalPredictor(ctx);
    const start = netPlayer('me', { x: 38, y: 196 });
    predictor.reconcile(start);
    predictor.step(1, NEUTRAL_INPUT);
    const shown = predictor.renderPosition(1)!;

    predictor.reconcile({ ...start, x: shown.x + 10, y: shown.y, ack: 1 }); // server disagrees by 10 px
    expect(predictor.lastCorrection).toBeCloseTo(10);
    expect(predictor.renderPosition(1)!.x).toBeCloseTo(shown.x); // no visible pop
    predictor.decay(1000);
    expect(predictor.renderPosition(1)!.x).toBeCloseTo(shown.x + 10);
  });

  it('snaps corrections larger than snapDistance', () => {
    const predictor = new LocalPredictor(ctx);
    predictor.reconcile(netPlayer('me', { x: 38, y: 196 }));
    predictor.reconcile(netPlayer('me', { x: 400, y: 196 }));
    expect(predictor.lastCorrection).toBeGreaterThan(300);
    expect(predictor.renderPosition(1)!.x).toBe(400);
  });

  it('snaps on respawn (teleport counter) and replays inputs not yet acknowledged', () => {
    const predictor = new LocalPredictor(ctx);
    predictor.reconcile(netPlayer('me', { x: 38, y: 196 }));
    predictor.step(1, Button.RIGHT);
    predictor.step(2, Button.RIGHT);
    predictor.reconcile(netPlayer('me', { x: 300, y: 196, tp: 1, ack: 1 }));
    expect(predictor.pendingCount).toBe(1);
    expect(predictor.renderPosition(0)!.x).toBeGreaterThan(300); // seq 2 replayed from the new spot
    expect(predictor.lastCorrection).toBe(0);
  });
});

describe('Interpolator', () => {
  it('interpolates remote players between the states around the render tick', () => {
    const interpolator = new Interpolator();
    interpolator.push(world(0, [netPlayer('a', { x: 0 })]));
    interpolator.push(world(3, [netPlayer('a', { x: 30 })]));
    expect(interpolator.sample(1.5).get('a')!.x).toBeCloseTo(15);
  });

  it('holds the oldest or newest state instead of extrapolating', () => {
    const interpolator = new Interpolator();
    interpolator.push(world(0, [netPlayer('a', { x: 0 })]));
    interpolator.push(world(3, [netPlayer('a', { x: 30 })]));
    expect(interpolator.sample(-10).get('a')!.x).toBe(0);
    expect(interpolator.sample(50).get('a')!.x).toBe(30);
  });

  it('never slides across a teleport or a death', () => {
    const interpolator = new Interpolator();
    interpolator.push(world(3, [netPlayer('a', { x: 30 })]));
    interpolator.push(world(6, [netPlayer('a', { x: 500, tp: 1 })]));
    expect(interpolator.sample(4).get('a')!.x).toBe(500);

    interpolator.push(world(9, [netPlayer('a', { x: 520, tp: 1, alive: false })]));
    expect(interpolator.sample(7).get('a')).toMatchObject({ x: 520, alive: false });
  });

  it('counts combat timers down smoothly but takes new swings and hits from the newer state', () => {
    const interpolator = new Interpolator();
    interpolator.push(world(0, [netPlayer('a', { attack: 0.3, attackSeq: 1, hurt: 0.2 })]));
    interpolator.push(world(3, [netPlayer('a', { attack: 0.25, attackSeq: 1, hurt: 0.15 })]));
    expect(interpolator.sample(1.5).get('a')).toMatchObject({ attackSeq: 1 });
    expect(interpolator.sample(1.5).get('a')!.attack).toBeCloseTo(0.275);
    expect(interpolator.sample(1.5).get('a')!.hurt).toBeCloseTo(0.175);

    interpolator.push(world(6, [netPlayer('a', { attack: 0.35, attackSeq: 2, hurt: 0.3 })]));
    expect(interpolator.sample(4.5).get('a')).toMatchObject({ attack: 0.35, attackSeq: 2, hurt: 0.3 });
  });

  it('shows players who just joined at their newest position', () => {
    const interpolator = new Interpolator();
    interpolator.push(world(0, [netPlayer('a')]));
    interpolator.push(world(3, [netPlayer('a'), netPlayer('b', { x: 99 })]));
    expect(interpolator.sample(1.5).get('b')!.x).toBe(99);
  });

  it('keeps a bounded, ordered history', () => {
    const interpolator = new Interpolator(4);
    for (let tick = 0; tick < 10; tick++) interpolator.push(world(tick, [netPlayer('a', { x: tick })]));
    expect(interpolator.size).toBe(4);
    expect(interpolator.oldestTick).toBe(6);
    interpolator.push(world(3, [netPlayer('a')])); // late: ignored
    interpolator.push(world(9, [netPlayer('a', { x: 90 })])); // same tick: replaces
    expect(interpolator.newestTick).toBe(9);
    expect(interpolator.sample(9).get('a')!.x).toBe(90);
  });
});

describe('WorldStateStore', () => {
  const snapshot = (run: number, tick: number, players: NetPlayerState[]): ServerMessageOf<'snapshot'> => ({
    t: 'snapshot',
    run,
    tick,
    state: world(tick, players),
    events: [],
  });
  const delta = (run: number, tick: number, baseTick: number, x: number): ServerMessageOf<'delta'> => ({
    t: 'delta',
    run,
    tick,
    baseTick,
    upserts: [{ id: 'a', x }],
    removed: [],
    collected: [],
    events: [],
  });

  it('applies deltas on top of the latest keyframe', () => {
    const store = new WorldStateStore();
    store.reset(1);
    store.applySnapshot(snapshot(1, 3, [netPlayer('a')]));
    const result = store.applyDelta(delta(1, 6, 3, 5));
    expect(result.kind).toBe('applied');
    expect(store.latest).toMatchObject({ tick: 6, players: [{ id: 'a', x: 5 }] });
  });

  it('detects gaps and stale runs', () => {
    const store = new WorldStateStore();
    store.reset(2);
    expect(store.applyDelta(delta(2, 6, 3, 5)).kind).toBe('gap'); // no keyframe yet
    store.applySnapshot(snapshot(2, 3, [netPlayer('a')]));
    expect(store.applyDelta(delta(2, 9, 6, 5)).kind).toBe('gap'); // base tick mismatch
    expect(store.applyDelta(delta(1, 6, 3, 5)).kind).toBe('stale'); // previous level run
    expect(store.applySnapshot(snapshot(1, 9, []))).toBeNull();
    expect(store.applyDelta(delta(3, 6, 3, 5)).kind).toBe('gap'); // next run started
    expect(store.applySnapshot(snapshot(3, 0, []))).not.toBeNull();
    expect(store.run).toBe(3);
  });
});

describe('ServerClock', () => {
  const TICK = 1000 / 60;

  it('maps local time to server ticks', () => {
    const clock = new ServerClock(TICK);
    expect(clock.ready).toBe(false);
    expect(clock.tickAt(1000)).toBe(0);
    clock.observe(60, 2000);
    expect(clock.tickAt(2000)).toBeCloseTo(60);
    expect(clock.tickAt(2500)).toBeCloseTo(90);
  });

  it('follows faster packets quickly and late packets slowly', () => {
    const clock = new ServerClock(TICK);
    clock.observe(60, 2000);
    clock.observe(66, 2150); // 50 ms late
    expect(clock.tickAt(2150)).toBeGreaterThan(66 + 2.5); // barely moved: still trusts the earlier, faster sample
    clock.observe(72, 2180); // 20 ms earlier than expected
    expect(clock.tickAt(2180)).toBeLessThan(72 + 1.1);
  });

  it('resets after large jumps (pause, tab sleep, reconnect)', () => {
    const clock = new ServerClock(TICK, 250);
    clock.observe(60, 2000);
    clock.observe(66, 9000);
    expect(clock.tickAt(9000)).toBeCloseTo(66);
  });
});
