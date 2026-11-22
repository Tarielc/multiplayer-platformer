import type { SfxRecipe } from './sfxSynth';

/**
 * Every sound the game makes, as data. Each cue is synthesized from its `recipe` at boot;
 * set `file` (a path under the asset base, e.g. `audio/jump.ogg`, placed in
 * `packages/shared/data/audio/`) to use a recorded sound instead. If the file fails to load,
 * the recipe is used.
 */
export const SOUND_CUES = [
  'jump',
  'land',
  'step',
  'attack',
  'hit',
  'hurt',
  'death',
  'respawn',
  'coin',
  'gem',
  'checkpoint',
  'levelComplete',
  'bounce',
  'boxHit',
  'boxBreak',
  'thud',
  'shake',
] as const;
export type SoundCue = (typeof SOUND_CUES)[number];

export interface SoundCueDef {
  recipe: SfxRecipe;
  /** Optional recorded override, relative to the asset base. */
  file?: string;
  /** 0..1 before master volume. */
  volume: number;
  /** Random pitch variation per play, ± cents (stops repeated sounds feeling robotic). */
  detuneJitter: number;
  /** Same-cue plays closer together than this are dropped. */
  minIntervalMs: number;
  /** At most this many instances of the cue at once. */
  maxVoices: number;
  /** Remote players' sounds fade with distance from the camera and pan left/right. */
  spatial: boolean;
  /** Only the local player's version plays (footsteps would be noise ×4). */
  selfOnly: boolean;
  /** Pitched by the character's voice (`CHARACTER_ART[id].voiceDetune`). */
  voiced: boolean;
}

const cue = (def: Partial<SoundCueDef> & Pick<SoundCueDef, 'recipe'>): SoundCueDef => ({
  volume: 0.6,
  detuneJitter: 40,
  minIntervalMs: 40,
  maxVoices: 3,
  spatial: true,
  selfOnly: false,
  voiced: false,
  ...def,
});

export const SOUND_CUE_DEFS: Readonly<Record<SoundCue, SoundCueDef>> = {
  jump: cue({
    recipe: { layers: [{ wave: 'square', duty: 0.25, freq: 260, freqEnd: 640, attack: 0.004, sustain: 0.04, decay: 0.12, lowpass: 5000, gain: 0.5 }] },
    volume: 0.45,
    voiced: true,
  }),
  land: cue({
    recipe: {
      layers: [
        { wave: 'noise', freq: 2400, freqEnd: 600, attack: 0.002, sustain: 0.01, decay: 0.08, lowpass: 1600, gain: 0.8 },
        { wave: 'sine', freq: 140, freqEnd: 60, attack: 0.002, sustain: 0.01, decay: 0.07, gain: 0.6 },
      ],
    },
    volume: 0.4,
    detuneJitter: 120,
  }),
  step: cue({
    recipe: { layers: [{ wave: 'noise', freq: 3000, freqEnd: 1200, attack: 0.001, sustain: 0.004, decay: 0.035, lowpass: 2600, gain: 0.7 }] },
    volume: 0.22,
    detuneJitter: 200,
    minIntervalMs: 90,
    selfOnly: true,
  }),
  attack: cue({
    recipe: {
      layers: [
        { wave: 'noise', freq: 1800, freqEnd: 7000, attack: 0.03, sustain: 0.03, decay: 0.12, lowpass: 3500, gain: 0.9 },
        { wave: 'saw', freq: 520, freqEnd: 260, attack: 0.01, sustain: 0.02, decay: 0.08, lowpass: 1800, gain: 0.15 },
      ],
    },
    volume: 0.5,
    detuneJitter: 80,
    voiced: true,
  }),
  hit: cue({
    recipe: {
      layers: [
        { wave: 'noise', freq: 4000, freqEnd: 500, attack: 0.001, sustain: 0.02, decay: 0.14, lowpass: 2400, gain: 0.9 },
        { wave: 'square', freq: 200, freqEnd: 60, attack: 0.001, sustain: 0.02, decay: 0.1, lowpass: 1200, gain: 0.35 },
      ],
    },
    volume: 0.6,
    detuneJitter: 60,
  }),
  hurt: cue({
    recipe: {
      layers: [{ wave: 'square', duty: 0.5, freq: 560, freqEnd: 240, attack: 0.004, sustain: 0.05, decay: 0.14, vibrato: { depth: 0.6, rate: 28 }, lowpass: 3000, gain: 0.45 }],
    },
    volume: 0.5,
    voiced: true,
  }),
  death: cue({
    recipe: {
      layers: [
        { wave: 'square', duty: 0.5, freq: 640, freqEnd: 80, attack: 0.005, sustain: 0.12, decay: 0.5, vibrato: { depth: 0.8, rate: 10 }, lowpass: 2600, gain: 0.45 },
        { wave: 'noise', freq: 1200, freqEnd: 200, attack: 0.002, sustain: 0.02, decay: 0.2, lowpass: 1500, gain: 0.3 },
      ],
    },
    volume: 0.55,
    voiced: true,
    maxVoices: 2,
  }),
  respawn: cue({
    recipe: {
      layers: [
        {
          wave: 'triangle',
          freq: 392,
          attack: 0.005,
          sustain: 0.24,
          decay: 0.12,
          arpeggio: [{ at: 0.07, mult: 1.26 }, { at: 0.14, mult: 1.5 }, { at: 0.21, mult: 2 }],
          gain: 0.6,
        },
      ],
    },
    volume: 0.4,
    detuneJitter: 0,
  }),
  coin: cue({
    recipe: {
      layers: [{ wave: 'square', duty: 0.5, freq: 988, attack: 0.002, sustain: 0.09, decay: 0.16, arpeggio: [{ at: 0.06, mult: 1.335 }], lowpass: 6000, gain: 0.35 }],
    },
    volume: 0.45,
    detuneJitter: 0,
    minIntervalMs: 30,
    maxVoices: 4,
  }),
  gem: cue({
    recipe: {
      layers: [
        {
          wave: 'triangle',
          freq: 1047,
          attack: 0.002,
          sustain: 0.2,
          decay: 0.22,
          arpeggio: [{ at: 0.05, mult: 1.26 }, { at: 0.1, mult: 1.5 }, { at: 0.15, mult: 2 }],
          gain: 0.6,
        },
        { wave: 'sine', freq: 2094, attack: 0.002, sustain: 0.05, decay: 0.3, vibrato: { depth: 0.3, rate: 12 }, gain: 0.2, delay: 0.15 },
      ],
    },
    volume: 0.5,
    detuneJitter: 0,
  }),
  checkpoint: cue({
    recipe: {
      layers: [
        {
          wave: 'square',
          duty: 0.25,
          freq: 523,
          attack: 0.004,
          sustain: 0.3,
          decay: 0.2,
          arpeggio: [{ at: 0.08, mult: 1.26 }, { at: 0.16, mult: 1.5 }, { at: 0.24, mult: 2 }],
          lowpass: 5000,
          gain: 0.35,
        },
      ],
    },
    volume: 0.5,
    detuneJitter: 0,
    spatial: false,
    maxVoices: 1,
  }),
  levelComplete: cue({
    recipe: {
      layers: [
        {
          wave: 'triangle',
          freq: 523,
          attack: 0.005,
          sustain: 0.55,
          decay: 0.45,
          arpeggio: [{ at: 0.12, mult: 1.26 }, { at: 0.24, mult: 1.5 }, { at: 0.36, mult: 2 }],
          gain: 0.6,
        },
        {
          wave: 'square',
          duty: 0.125,
          freq: 262,
          attack: 0.005,
          sustain: 0.55,
          decay: 0.45,
          arpeggio: [{ at: 0.12, mult: 1.26 }, { at: 0.24, mult: 1.5 }, { at: 0.36, mult: 2 }],
          lowpass: 3000,
          gain: 0.2,
        },
      ],
    },
    volume: 0.55,
    detuneJitter: 0,
    spatial: false,
    maxVoices: 1,
  }),
  // --- traps ---------------------------------------------------------------------------------
  /** Trampoline spring. */
  bounce: cue({
    recipe: {
      layers: [
        { wave: 'square', duty: 0.25, freq: 180, freqEnd: 900, attack: 0.002, sustain: 0.05, decay: 0.16, vibrato: { depth: 0.25, rate: 30 }, lowpass: 4000, gain: 0.45 },
        { wave: 'triangle', freq: 90, freqEnd: 60, attack: 0.001, sustain: 0.02, decay: 0.08, gain: 0.4 },
      ],
    },
    volume: 0.5,
    detuneJitter: 50,
  }),
  /** A box takes a hit (not the last). */
  boxHit: cue({
    recipe: {
      layers: [
        { wave: 'noise', freq: 2400, freqEnd: 700, attack: 0.001, sustain: 0.015, decay: 0.08, lowpass: 1800, gain: 0.7 },
        { wave: 'triangle', freq: 220, freqEnd: 140, attack: 0.001, sustain: 0.02, decay: 0.07, gain: 0.5 },
      ],
    },
    volume: 0.5,
    detuneJitter: 80,
  }),
  /** A box bursts into pieces. */
  boxBreak: cue({
    recipe: {
      layers: [
        { wave: 'noise', freq: 3200, freqEnd: 300, attack: 0.001, sustain: 0.04, decay: 0.22, lowpass: 2200, gain: 0.85 },
        { wave: 'square', freq: 160, freqEnd: 50, attack: 0.001, sustain: 0.03, decay: 0.15, lowpass: 900, gain: 0.35 },
        { wave: 'noise', freq: 5000, attack: 0.001, sustain: 0.01, decay: 0.05, lowpass: 5000, gain: 0.3, delay: 0.06 },
      ],
    },
    volume: 0.55,
    detuneJitter: 60,
  }),
  /** A rock-head slams into a wall (fades with distance, so far ones stay quiet). */
  thud: cue({
    recipe: {
      layers: [
        { wave: 'sine', freq: 110, freqEnd: 38, attack: 0.001, sustain: 0.04, decay: 0.26, gain: 0.9 },
        { wave: 'noise', freq: 900, freqEnd: 120, attack: 0.001, sustain: 0.02, decay: 0.16, lowpass: 700, gain: 0.6 },
      ],
    },
    volume: 0.6,
    detuneJitter: 40,
    minIntervalMs: 60,
  }),
  /** A falling platform starts shaking. */
  shake: cue({
    recipe: {
      layers: [{ wave: 'noise', freq: 1600, attack: 0.005, sustain: 0.2, decay: 0.1, vibrato: { depth: 0.5, rate: 24 }, lowpass: 1400, gain: 0.35 }],
    },
    volume: 0.35,
    detuneJitter: 60,
    maxVoices: 2,
  }),
};

/** Phaser audio cache key of a cue. */
export const sfxKey = (cue: SoundCue) => `sfx:${cue}`;
