/**
 * The three co-op puzzles, as `Sketch` builders so every level uses the same proven sizes.
 * Each needs two players: one holds a button while another uses what it switches. None has a
 * box in reach (a box resting on a button would hold it for a lone player).
 *
 * The heights come from the reach calibration in `packages/shared/src/sim/reach.test.ts`
 * (16 px tiles): a jump + double jump rises 12 tiles, a trampoline + double jump about 20,
 * standing on a teammate adds 1.75, a rider jumping at the top of the carrier's jump reaches
 * about 20.5, and a teammate jumping off giant Mask Dude's springy head about 30. A running
 * jump with the double jump crosses about 16.5 tiles (more downhill). Drops of 16 tiles are safe.
 */
import type { EdgeMaterial, PlatformMaterial, Sketch } from './sketch';

/** Shelf height above the pit floor in "Tandem Trampoline": out of jump reach, in trampoline reach, a safe drop. */
export const TANDEM_SHELF = 16;
/** Corridor length of "Spike Gauntlet": too long to walk through on the spikes (3+ hits) or be spat across (~19). */
export const GAUNTLET_LENGTH = 48;
/** "Lift-Off": the button ledge (only abilities reach it), the holder's way-down ledge, the crest. */
export const LIFT_LEDGE = 24;
export const LIFT_STEP = 13;
export const LIFT_CREST = 15;

export interface TandemOptions {
  /** Last column of the shelf (it starts 28 columns right of `x`). */
  shelfEnd: number;
  shelf?: EdgeMaterial;
  floor?: EdgeMaterial;
}

/**
 * P1 "Tandem Trampoline": a pit 28 tiles wide from column `x` with its floor top at row `f`, and
 * a shelf `TANDEM_SHELF` tiles higher right of it (its face at `x + 28`). The trampoline by the
 * face works only while a button is held: one on the pit floor 14 tiles away (so the presser
 * can't bounce), one on the shelf. The first player up holds the shelf button for the last one.
 * Enter from the left from at most ~6 tiles above the floor, at least 22 tiles from the face.
 */
export function tandemTrampoline(s: Sketch, x: number, f: number, { shelfEnd, shelf = 'grass', floor = shelf }: TandemOptions): void {
  const top = f - TANDEM_SHELF;
  s.ground(x, x + 27, f, floor);
  s.ground(x + 28, shelfEnd, top, shelf);
  const trampoline = s.nextName('trampoline');
  s.trampoline(x + 24, f - 1);
  s.button(x + 10, f - 1, trampoline);
  s.button(x + 32, top - 1, trampoline);
}

export interface GauntletOptions {
  length?: number;
  /** Material of the wall the corridor is bored through (it reaches the map's ceiling). */
  wall?: EdgeMaterial;
}

/**
 * P2 "Spike Gauntlet": a corridor exactly 2 tiles tall (a player fits; a giant or a drone with
 * its cargo doesn't, and nobody can jump) bored at floor row `f` through a wall from row 2 (under
 * the frame's ceiling) to the corridor, from column `x`. Spikes line its whole floor. Two `off`
 * buttons switch them off: one 3 tiles before the entrance, one 2 tiles past the exit. The floor
 * (row `f`) must already be solid under the corridor and both buttons.
 */
export function spikeGauntlet(s: Sketch, x: number, f: number, { length = GAUNTLET_LENGTH, wall = 'brick' }: GauntletOptions = {}): void {
  s.solid(wall, x, 2, length, f - 4);
  const spikes = s.nextName('spikes');
  s.spikes(x, f - 1, length);
  s.button(x - 3, f - 1, spikes, 'off');
  s.button(x + length + 2, f - 1, spikes, 'off');
}

export interface LiftOptions {
  /** Last column of the crest (it starts 30 columns right of `x`). */
  crestEnd: number;
  crest?: EdgeMaterial;
  floor?: EdgeMaterial;
  wall?: EdgeMaterial;
  ledge?: PlatformMaterial;
}

/**
 * P3 "Lift-Off": a room from column `x` with its floor top at row `f`, open up to the frame's
 * ceiling, entered through a 4-tall tunnel in its left wall (columns `x-4`..`x-1`; the floor
 * under the tunnel is the caller's). A one-way ledge `LIFT_LEDGE` up by the left wall holds the
 * button that powers the trampoline by the crest: only an ability gets someone up there (a frog
 * spits them, the drone carries them, or they jump off giant Mask Dude). Everyone else bounces
 * onto the crest (`LIFT_CREST` up, columns `x + 30`..). The button holder leaves last, leaping
 * down to a one-way step (`LIFT_STEP` up, 14 columns away: too far and too high to climb to the
 * ledge from, out of a lone jump's reach from the floor) and on to the crest.
 */
export function liftOff(s: Sketch, x: number, f: number, opts: LiftOptions): void {
  const { crestEnd, crest = 'grass', floor = crest, wall = 'stoneWall', ledge = 'goldPlatform' } = opts;
  s.solid(wall, x - 4, 2, 4, f - 6);
  s.ground(x, x + 29, f, floor);
  s.ground(x + 30, crestEnd, f - LIFT_CREST, crest);
  s.platform(ledge, x + 2, f - LIFT_LEDGE, 6);
  s.platform(ledge, x + 22, f - LIFT_STEP, 6);
  const trampoline = s.nextName('trampoline');
  s.trampoline(x + 28, f - 1);
  s.button(x + 4, f - LIFT_LEDGE - 1, trampoline);
}
