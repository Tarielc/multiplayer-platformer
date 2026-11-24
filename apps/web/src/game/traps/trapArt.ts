import type { TrapKind } from '@platformer/shared';

/**
 * Trap and level-marker art as data (no Phaser import, so tests can check it). Sheets live in
 * `packages/shared/data/sprites/traps/` and `sprites/markers/` (start sign, checkpoint flag,
 * finish trophy), one row per animation, frames left to right.
 *
 * `bodyX`/`bodyY` say where the simulation body's top-left sits inside a frame, so views can
 * draw a sprite exactly over the collision box the server uses (`TRAP_TUNING` sizes). For the
 * saw the body is its centre.
 */
export type TrapSheetName =
  | 'spikes'
  | 'trampoline'
  | 'saw'
  | 'fallingPlatform'
  | 'fan'
  | 'rockHead'
  | 'spikeHead'
  | 'box1'
  | 'box2'
  | 'box3'
  | 'button'
  | 'start'
  | 'checkpoint'
  | 'finish'
  | FruitKind;

/** Animated fruit pickups (collectible kinds with a sheet in `sprites/fruits/`). */
export const FRUIT_KINDS = ['apple', 'strawberry', 'pineapple', 'melon'] as const;
export type FruitKind = (typeof FRUIT_KINDS)[number];

export function isFruitKind(kind: string): kind is FruitKind {
  return (FRUIT_KINDS as readonly string[]).includes(kind);
}

export interface TrapSheet {
  key: string;
  /** Relative to the asset base (`/assets`). */
  path: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  /** Frames in each row (rows are animations). */
  rowFrames: readonly number[];
  bodyX: number;
  bodyY: number;
  /** Colour of the generated placeholder when the sheet fails to load. */
  placeholderColor: number;
}

const sheet = (name: string, def: Omit<TrapSheet, 'key' | 'path'> & { file?: string; dir?: string }): TrapSheet => ({
  key: `trap:${name}`,
  path: `sprites/${def.dir ?? 'traps'}/${def.file ?? name}.png`,
  ...def,
});

/** Level markers: 64×64 frames drawn with their bottom on the ground (no collision body). */
const marker = (name: string, rowFrames: number[], placeholderColor: number): TrapSheet =>
  sheet(name, { dir: 'markers', frameWidth: 64, frameHeight: 64, columns: Math.max(...rowFrames), rowFrames, bodyX: 0, bodyY: 0, placeholderColor });

/** Fruit: 17 frames of 32×32, drawn centred on the pickup. */
const fruit = (name: FruitKind, placeholderColor: number): TrapSheet =>
  sheet(name, { dir: 'fruits', frameWidth: 32, frameHeight: 32, columns: 17, rowFrames: [17], bodyX: 16, bodyY: 16, placeholderColor });

const box = (file: string, hitFrames: number): TrapSheet =>
  sheet(file, { frameWidth: 28, frameHeight: 24, columns: 4, rowFrames: [1, hitFrames, 4], bodyX: 4, bodyY: 2, placeholderColor: 0xb5713c });

export const TRAP_SHEETS: Readonly<Record<TrapSheetName, TrapSheet>> = {
  spikes: sheet('spikes', { frameWidth: 16, frameHeight: 16, columns: 1, rowFrames: [1], bodyX: 0, bodyY: 0, placeholderColor: 0xc9ced6 }),
  trampoline: sheet('trampoline', { frameWidth: 28, frameHeight: 28, columns: 9, rowFrames: [9], bodyX: 2, bodyY: 17, placeholderColor: 0xd9574a }),
  saw: sheet('saw', { frameWidth: 38, frameHeight: 38, columns: 8, rowFrames: [8], bodyX: 19, bodyY: 19, placeholderColor: 0xaab2bd }),
  fallingPlatform: sheet('fallingPlatform', {
    file: 'falling-platform',
    frameWidth: 32,
    frameHeight: 10,
    columns: 4,
    rowFrames: [4],
    bodyX: 0,
    bodyY: 0,
    placeholderColor: 0x8d96a3,
  }),
  // The fan sheet's frame count follows its width (frame 0 = off); see `fanFrameCount`.
  fan: sheet('fan', { frameWidth: 24, frameHeight: 8, columns: 5, rowFrames: [5], bodyX: 0, bodyY: 0, placeholderColor: 0x7f8a99 }),
  rockHead: sheet('rockHead', {
    file: 'rock-head',
    frameWidth: 42,
    frameHeight: 42,
    columns: 5,
    rowFrames: [5, 4, 4],
    bodyX: 5,
    bodyY: 5,
    placeholderColor: 0x8a919c,
  }),
  spikeHead: sheet('spikeHead', {
    file: 'spike-head',
    frameWidth: 54,
    frameHeight: 52,
    columns: 5,
    rowFrames: [5, 4, 4],
    bodyX: 6,
    bodyY: 5,
    placeholderColor: 0xb0603a,
  }),
  box1: box('box1', 3),
  box2: box('box2', 4),
  box3: box('box3', 2),
  // Frame 0: up (off), frame 1: pressed (on). Drawn by scripts/lib/buttonSprite.ts. The body is
  // the pressed cap's outline, down to the floor.
  button: sheet('button', { frameWidth: 24, frameHeight: 8, columns: 2, rowFrames: [2], bodyX: 5, bodyY: 5, placeholderColor: 0xde4840 }),
  // Rows: idle, moving (wobbles when a player runs past).
  start: marker('start', [1, 17], 0xe8b53a),
  // Rows: bare pole, flag out (on activation), flag idle (loop).
  checkpoint: marker('checkpoint', [1, 26, 10], 0x9aa0c3),
  // Rows: idle, pressed (a player reached the exit).
  finish: marker('finish', [1, 8], 0xffd23f),
  apple: fruit('apple', 0xe5484d),
  strawberry: fruit('strawberry', 0xf0566b),
  pineapple: fruit('pineapple', 0xf2a03d),
  melon: fruit('melon', 0x6cc04a),
};

/**
 * Where marker sprites stand (origin, as a fraction of the frame): the bottom row is the ground.
 * The start sign is placed so its checkered start line lies under the first spawn point.
 */
export const MARKER_ORIGIN = {
  start: { x: 43 / 64, y: 1 },
  checkpoint: { x: 0.5, y: 1 },
  finish: { x: 0.5, y: 1 },
} as const;

/** Pixels from the frame bottom to the top of the trophy (for the "n/m at exit" label). */
export const FINISH_ART_HEIGHT = 44;

export const TRAP_SHEET_NAMES = Object.keys(TRAP_SHEETS) as TrapSheetName[];

/** Sheet frame index of frame `i` in `row`. */
export function trapFrame(name: TrapSheetName, row: number, i: number): number {
  return row * TRAP_SHEETS[name].columns + i;
}

/** Animations, by key. `row` and `from..from+frames` index into the sheet. */
export interface TrapClip {
  sheet: TrapSheetName;
  row: number;
  from: number;
  frames: number;
  frameRate: number;
  loop: boolean;
}

export const TRAP_CLIPS = {
  'trampoline:launch': { sheet: 'trampoline', row: 0, from: 0, frames: 9, frameRate: 24, loop: false },
  'saw:spin': { sheet: 'saw', row: 0, from: 0, frames: 8, frameRate: 24, loop: true },
  'fallingPlatform:fly': { sheet: 'fallingPlatform', row: 0, from: 0, frames: 4, frameRate: 14, loop: true },
  // Frame 0 is "off"; the rest spin. The real frame count is read from the loaded image.
  'fan:on': { sheet: 'fan', row: 0, from: 1, frames: 4, frameRate: 24, loop: true },
  'rockHead:blink': { sheet: 'rockHead', row: 0, from: 0, frames: 5, frameRate: 12, loop: false },
  'rockHead:hitSide': { sheet: 'rockHead', row: 1, from: 0, frames: 4, frameRate: 14, loop: false },
  'rockHead:hitEnd': { sheet: 'rockHead', row: 2, from: 0, frames: 4, frameRate: 14, loop: false },
  'spikeHead:blink': { sheet: 'spikeHead', row: 0, from: 0, frames: 5, frameRate: 12, loop: false },
  'spikeHead:hitSide': { sheet: 'spikeHead', row: 1, from: 0, frames: 4, frameRate: 14, loop: false },
  'spikeHead:hitEnd': { sheet: 'spikeHead', row: 2, from: 0, frames: 4, frameRate: 14, loop: false },
  'box1:hit': { sheet: 'box1', row: 1, from: 0, frames: 3, frameRate: 16, loop: false },
  'box2:hit': { sheet: 'box2', row: 1, from: 0, frames: 4, frameRate: 16, loop: false },
  'box3:hit': { sheet: 'box3', row: 1, from: 0, frames: 2, frameRate: 12, loop: false },
  'start:moving': { sheet: 'start', row: 1, from: 0, frames: 17, frameRate: 20, loop: false },
  'checkpoint:flagOut': { sheet: 'checkpoint', row: 1, from: 0, frames: 26, frameRate: 24, loop: false },
  'checkpoint:flagIdle': { sheet: 'checkpoint', row: 2, from: 0, frames: 10, frameRate: 14, loop: true },
  'finish:pressed': { sheet: 'finish', row: 1, from: 0, frames: 8, frameRate: 14, loop: false },
  'apple:idle': { sheet: 'apple', row: 0, from: 0, frames: 17, frameRate: 20, loop: true },
  'strawberry:idle': { sheet: 'strawberry', row: 0, from: 0, frames: 17, frameRate: 20, loop: true },
  'pineapple:idle': { sheet: 'pineapple', row: 0, from: 0, frames: 17, frameRate: 20, loop: true },
  'melon:idle': { sheet: 'melon', row: 0, from: 0, frames: 17, frameRate: 20, loop: true },
} as const satisfies Record<string, TrapClip>;

export type TrapClipName = keyof typeof TRAP_CLIPS;

/** Phaser animation key for a clip. */
export const trapAnimKey = (clip: TrapClipName) => `trap:${clip}`;

/** Debris pieces flying out of a broken box (row 2 of its sheet). */
export const BOX_DEBRIS = { row: 2, pieces: 4, lifeMs: 800, speed: 120, gravity: 600 } as const;

/** Sheet used by each kind (boxes pick by variant). */
export function sheetForTrap(kind: TrapKind, variant = 1): TrapSheetName {
  if (kind === 'box') return variant === 3 ? 'box3' : variant === 2 ? 'box2' : 'box1';
  return kind;
}

/** Fan frames in a loaded fan sheet of `imageWidth` px (at least 2: off + one spin frame). */
export function fanFrameCount(imageWidth: number): number {
  return Math.max(2, Math.floor(imageWidth / TRAP_SHEETS.fan.frameWidth));
}
