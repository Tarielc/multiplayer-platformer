import { describe, expect, it } from 'vitest';
import { normalizeAudioSettings } from './audioSettings';
import { recipeLength, renderSfx, type SfxRecipe } from './sfxSynth';
import { SOUND_CUE_DEFS, SOUND_CUES } from './soundCues';

const RATE = 22050;
const BEEP: SfxRecipe = { layers: [{ wave: 'square', freq: 440, freqEnd: 880, attack: 0.01, sustain: 0.05, decay: 0.1 }] };
const peak = (samples: Float32Array) => samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0);

describe('renderSfx', () => {
  it('renders the recipe length, is audible, and stays in [-1, 1]', () => {
    const samples = renderSfx(BEEP, RATE);
    expect(samples.length).toBe(Math.ceil(recipeLength(BEEP) * RATE));
    expect(peak(samples)).toBeGreaterThan(0.3);
    expect(peak(samples)).toBeLessThanOrEqual(1);
  });

  it('fades to silence at the end (no click)', () => {
    const samples = renderSfx(BEEP, RATE);
    expect(Math.abs(samples[samples.length - 1]!)).toBeLessThan(0.01);
  });

  it('is deterministic for a seed (noise included)', () => {
    const noise: SfxRecipe = { layers: [{ wave: 'noise', freq: 3000, attack: 0, sustain: 0.05, decay: 0.05 }] };
    expect(renderSfx(noise, RATE, 7)).toEqual(renderSfx(noise, RATE, 7));
    expect(renderSfx(noise, RATE, 7)).not.toEqual(renderSfx(noise, RATE, 8));
  });

  it('clamps loud mixes', () => {
    const loud: SfxRecipe = { layers: [BEEP.layers[0]!, BEEP.layers[0]!, BEEP.layers[0]!], gain: 3 };
    expect(peak(renderSfx(loud, RATE))).toBe(1);
  });

  it.each(SOUND_CUES)('renders the %s cue', (cue) => {
    const samples = renderSfx(SOUND_CUE_DEFS[cue].recipe, RATE, 1);
    expect(samples.length).toBeGreaterThan(RATE * 0.02);
    expect(peak(samples)).toBeGreaterThan(0.05);
    expect(peak(samples)).toBeLessThanOrEqual(1);
    expect(samples.every(Number.isFinite)).toBe(true);
  });
});

describe('audio settings', () => {
  it('clamps and fills in defaults', () => {
    expect(normalizeAudioSettings({ volume: 3 })).toEqual({ muted: false, volume: 1 });
    expect(normalizeAudioSettings({ muted: true, volume: Number.NaN })).toEqual({ muted: true, volume: 0.7 });
  });
});
