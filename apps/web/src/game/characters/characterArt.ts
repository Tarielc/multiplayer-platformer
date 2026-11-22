import { COMBAT_TUNING, type CharacterId } from '@platformer/shared';

/**
 * Character art as data. No Phaser import, so React (portraits) and tests can use it too.
 *
 * Sheet layout (`all-characters.png`): 64×32 frames, 11 columns. Each character owns a block of
 * `rowsPerCharacter` rows, one row per clip (see `CLIPS`), frames left to right. Bodies face
 * right with their feet on the bottom pixel row, centred horizontally, so the sprite origin is
 * (0.5, 1) at the hitbox's bottom-centre and no scaling is needed.
 *
 * To add a character: append its id in `@platformer/shared` (config/characters.ts), add a
 * block of rows to the sheet and an entry to `CHARACTER_ART`.
 */
export const CHARACTER_SHEET = {
  key: 'characters',
  /** Relative to the asset base (`/assets`). */
  path: 'sprites/all-characters.png',
  frameWidth: 64,
  frameHeight: 32,
  columns: 11,
  rowsPerCharacter: 7,
  /** Full sheet size in px (used by the CSS portraits and the placeholder sheet). */
  width: 704,
  height: 896,
} as const;

export const CLIP_NAMES = ['idle', 'run', 'attack', 'jump', 'fall', 'hurt', 'death'] as const;
export type ClipName = (typeof CLIP_NAMES)[number];

/** Named moments inside a clip, emitted by the animation controller (footsteps, …). */
export type ClipFrameEvent = 'step';

export interface ClipDef {
  /** Row inside the character's block. */
  row: number;
  frames: number;
  /** Playback speed, or `durationMs` for clips that must match a gameplay timer. */
  frameRate?: number;
  durationMs?: number;
  loop: boolean;
  /**
   * Loop only frames `loopFrom..end` after playing the whole clip once (e.g. Fall: a
   * transition frame, then a two-frame loop).
   */
  loopFrom?: number;
  /** Frame index (0-based, within the clip) → event. */
  frameEvents?: Readonly<Record<number, ClipFrameEvent>>;
}

export const CLIPS: Readonly<Record<ClipName, ClipDef>> = {
  idle: { row: 0, frames: 11, frameRate: 20, loop: true },
  run: { row: 1, frames: 8, frameRate: 18, loop: true, frameEvents: { 0: 'step', 4: 'step' } },
  // Same length as the simulated swing, so the slash frames line up with the hit window.
  attack: { row: 2, frames: 7, durationMs: COMBAT_TUNING.attack.durationMs, loop: false },
  jump: { row: 3, frames: 4, frameRate: 14, loop: false },
  fall: { row: 4, frames: 3, frameRate: 12, loop: true, loopFrom: 1 },
  hurt: { row: 5, frames: 4, durationMs: COMBAT_TUNING.hurt.stunMs, loop: false },
  // Must finish before the respawn (PLAYER_CONFIG.respawnDelayMs); a test checks this.
  death: { row: 6, frames: 10, durationMs: 750, loop: false },
};

export interface CharacterArt {
  /** Block index in the sheet (sheet order, top to bottom). */
  block: number;
  /** Pitch offset for the character's voiced sounds, in cents. */
  voiceDetune: number;
  /** Colour of the generated placeholder when the sheet fails to load. */
  placeholderColor: number;
}

export const CHARACTER_ART: Readonly<Record<CharacterId, CharacterArt>> = {
  'bunny-man': { block: 0, voiceDetune: 200, placeholderColor: 0xe8d9c4 },
  'virtual-guy': { block: 1, voiceDetune: 0, placeholderColor: 0x3f7fd9 },
  'mask-dude': { block: 2, voiceDetune: -250, placeholderColor: 0xf0b032 },
  'ninja-frog': { block: 3, voiceDetune: 400, placeholderColor: 0x4fbf5a },
};

/** Sheet frame index of frame `i` of `clip` for `id`. */
export function sheetFrame(id: CharacterId, clip: ClipName, i: number): number {
  const row = CHARACTER_ART[id].block * CHARACTER_SHEET.rowsPerCharacter + CLIPS[clip].row;
  return row * CHARACTER_SHEET.columns + i;
}

/** Phaser animation key (animations are global to a game, so keys include the character). */
export function animKey(id: CharacterId, clip: ClipName, part: 'intro' | 'loop' | null = null): string {
  return part ? `${id}:${clip}:${part}` : `${id}:${clip}`;
}

/** Length of one full play of a clip, in ms. */
export function clipDurationMs(clip: ClipName): number {
  const def = CLIPS[clip];
  return def.durationMs ?? (def.frames / (def.frameRate ?? 10)) * 1000;
}
