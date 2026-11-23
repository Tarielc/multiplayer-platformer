import { describe, expect, it } from 'vitest';
import { FOE_KINDS, FOE_TUNING, type FoeTuning } from './foes';
import { MODE_CONFIG, modeFoes, modeWorldOptions, scaleFoes, scalingSummary, type CoopScaling } from './modes';

const SCALING: CoopScaling = { foeHpPerPlayer: 0.4, bossHpPerPlayer: 0.6, attackRatePerPlayer: 0.25 };

/** FOE_TUNING with round health numbers, so the expectations don't follow retuning. */
const BASE: FoeTuning = {
  ...FOE_TUNING,
  mushroom: { ...FOE_TUNING.mushroom, hp: 1 },
  chicken: { ...FOE_TUNING.chicken, hp: 2 },
  bull: { ...FOE_TUNING.bull, hp: 3 },
  rhino: { ...FOE_TUNING.rhino, hp: 12 },
};

describe('co-op scaling', () => {
  it('leaves solo play and races as tuned', () => {
    expect(modeFoes('coop', 1)).toBe(FOE_TUNING);
    expect(modeFoes('race', 4)).toBe(FOE_TUNING);
    expect(scaleFoes(0, SCALING)).toBe(FOE_TUNING);
    expect(scalingSummary('coop', 1)).toBeNull();
    expect(scalingSummary('race', 3)).toBeNull();
  });

  it('adds health per extra player, rounded and never below the tuned value', () => {
    const hp = (players: number) => {
      const f = scaleFoes(players, SCALING, BASE);
      return [f.mushroom.hp, f.chicken.hp, f.bull.hp, f.rhino.hp];
    };
    expect(hp(1)).toEqual([1, 2, 3, 12]);
    expect(hp(2)).toEqual([1, 3, 4, 19]); // 1.4, 2.8, 4.2; the boss 19.2
    expect(hp(3)).toEqual([2, 4, 5, 26]); // 1.8, 3.6, 5.4; the boss 26.4
    expect(hp(4)).toEqual([2, 4, 7, 34]); // 2.2, 4.4, 6.6; the boss 33.6
  });

  it('makes foes attack more often, and changes nothing else', () => {
    const f = scaleFoes(3, SCALING); // attack rate 1 + 0.25 × 2
    const faster = (ms: number) => Math.round(ms / 1.5);
    expect(f.chicken.peck.cooldownMs).toBe(faster(FOE_TUNING.chicken.peck.cooldownMs));
    expect(f.wasp.shoot.cooldownMs).toBe(faster(FOE_TUNING.wasp.shoot.cooldownMs));
    expect(f.monkey.throw.cooldownMs).toBe(faster(FOE_TUNING.monkey.throw.cooldownMs));
    expect(f.monkey.wallSwipe.cooldownMs).toBe(faster(FOE_TUNING.monkey.wallSwipe.cooldownMs));
    expect(f.bull.cooldownMs).toBe(faster(FOE_TUNING.bull.cooldownMs));
    expect(f.rhino.thinkMs).toEqual(FOE_TUNING.rhino.thinkMs.map(faster));
    expect(f.rhino.rage.thinkMs).toEqual(FOE_TUNING.rhino.rage.thinkMs.map(faster));
    expect(f.rhino.hornSwipe.cooldownMs).toBe(faster(FOE_TUNING.rhino.hornSwipe.cooldownMs));

    // Sizes, speeds, reach and damage stay, so the art and the level layouts still fit.
    expect(f.wasp.speed).toBe(FOE_TUNING.wasp.speed);
    expect(f.rhino.width).toBe(FOE_TUNING.rhino.width);
    expect(f.rhino.hornSwipe.damage).toBe(FOE_TUNING.rhino.hornSwipe.damage);
    expect(f.rhino.rage.walkSpeed).toBe(FOE_TUNING.rhino.rage.walkSpeed);
    expect(f.stinger).toBe(FOE_TUNING.stinger);
    expect(f.hit).toBe(FOE_TUNING.hit);
  });

  it('never makes a bigger co-op team face weaker foes', () => {
    for (let players = 2; players <= 4; players++) {
      const fewer = modeFoes('coop', players - 1);
      const more = modeFoes('coop', players);
      for (const kind of FOE_KINDS) expect(more[kind].hp).toBeGreaterThanOrEqual(fewer[kind].hp);
      expect(more.wasp.shoot.cooldownMs).toBeLessThan(fewer.wasp.shoot.cooldownMs);
    }
    expect(modeFoes('coop', 4).rhino.hp).toBeGreaterThan(FOE_TUNING.rhino.hp);
  });

  it('hands the scaled foes to the world', () => {
    expect(modeWorldOptions('coop').foes).toBe(FOE_TUNING);
    expect(modeWorldOptions('coop', 3).foes).toEqual(modeFoes('coop', 3));
    expect(modeWorldOptions('race', 4).foes).toBe(FOE_TUNING);
  });

  it('sums the scaling up in one line', () => {
    expect(MODE_CONFIG.coop.scaling).not.toBeNull();
    expect(scalingSummary('coop', 3)).toMatch(/^Foes scaled for 3 players: \d+% more health \(boss \d+%\), attacks \d+% more often\.$/);
  });
});
