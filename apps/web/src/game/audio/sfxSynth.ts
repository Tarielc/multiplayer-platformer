import { mulberry32 } from '@platformer/shared';

/**
 * Tiny retro sound-effect synthesizer (no Phaser, no Web Audio): recipes are rendered into
 * plain sample arrays at boot, so the template ships sound without any audio files. Output is
 * deterministic for a given seed, which keeps it unit-testable.
 */
export type Wave = 'square' | 'saw' | 'triangle' | 'sine' | 'noise';

export interface SfxLayer {
  wave: Wave;
  /** Start frequency in Hz (for noise: how often a new random value is drawn). */
  freq: number;
  /** End frequency; the pitch slides exponentially from `freq` over the layer's length. */
  freqEnd?: number;
  /** Envelope in seconds: linear rise, hold, then a curved fall to silence. */
  attack: number;
  sustain: number;
  decay: number;
  /** Square-wave duty cycle (0..1, default 0.5). */
  duty?: number;
  /** Pitch wobble: `depth` in semitones at `rate` Hz. */
  vibrato?: { depth: number; rate: number };
  /** Pitch steps: from `at` seconds on, the frequency is multiplied by `mult` (classic coin "ding-ding"). */
  arpeggio?: readonly { at: number; mult: number }[];
  /** One-pole low-pass cutoff in Hz (softens noise and square waves). */
  lowpass?: number;
  gain?: number;
  /** Start offset in seconds. */
  delay?: number;
}

export interface SfxRecipe {
  layers: readonly SfxLayer[];
  /** Master gain applied after mixing (default 1). */
  gain?: number;
}

export function layerLength(layer: SfxLayer): number {
  return (layer.delay ?? 0) + layer.attack + layer.sustain + layer.decay;
}

export function recipeLength(recipe: SfxRecipe): number {
  return recipe.layers.reduce((max, layer) => Math.max(max, layerLength(layer)), 0);
}

/** Renders a recipe to mono samples in [-1, 1]. */
export function renderSfx(recipe: SfxRecipe, sampleRate: number, seed = 1): Float32Array {
  const total = Math.ceil(recipeLength(recipe) * sampleRate);
  const out = new Float32Array(Math.max(1, total));
  recipe.layers.forEach((layer, index) => renderLayer(out, layer, sampleRate, mulberry32(seed * 7919 + index)));
  const master = recipe.gain ?? 1;
  for (let i = 0; i < out.length; i++) {
    const v = out[i]! * master;
    out[i] = v > 1 ? 1 : v < -1 ? -1 : v;
  }
  return out;
}

function renderLayer(out: Float32Array, layer: SfxLayer, sampleRate: number, random: () => number): void {
  const start = Math.floor((layer.delay ?? 0) * sampleRate);
  const length = layer.attack + layer.sustain + layer.decay;
  const count = Math.min(out.length - start, Math.ceil(length * sampleRate));
  const ratio = (layer.freqEnd ?? layer.freq) / layer.freq;
  const duty = layer.duty ?? 0.5;
  const gain = layer.gain ?? 1;
  const smoothing = layer.lowpass ? 1 - Math.exp((-2 * Math.PI * layer.lowpass) / sampleRate) : 1;
  let phase = 0;
  let noise = random() * 2 - 1;
  let filtered = 0;

  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    let freq = layer.freq * Math.pow(ratio, length > 0 ? t / length : 0);
    if (layer.arpeggio) {
      let mult = 1;
      for (const step of layer.arpeggio) if (t >= step.at) mult = step.mult;
      freq *= mult;
    }
    if (layer.vibrato) freq *= Math.pow(2, (layer.vibrato.depth / 12) * Math.sin(2 * Math.PI * layer.vibrato.rate * t));

    phase += freq / sampleRate;
    if (phase >= 1) {
      phase -= Math.floor(phase);
      noise = random() * 2 - 1;
    }

    let sample: number;
    switch (layer.wave) {
      case 'square':
        sample = phase < duty ? 1 : -1;
        break;
      case 'saw':
        sample = phase * 2 - 1;
        break;
      case 'triangle':
        sample = 1 - 4 * Math.abs(phase - 0.5);
        break;
      case 'sine':
        sample = Math.sin(2 * Math.PI * phase);
        break;
      case 'noise':
        sample = noise;
        break;
    }
    filtered += smoothing * (sample - filtered);
    out[start + i] = (out[start + i] ?? 0) + filtered * envelope(t, layer) * gain;
  }
}

function envelope(t: number, layer: SfxLayer): number {
  if (t < layer.attack) return layer.attack > 0 ? t / layer.attack : 1;
  const afterSustain = t - layer.attack - layer.sustain;
  if (afterSustain < 0) return 1;
  if (layer.decay <= 0) return 0;
  const x = Math.max(0, 1 - afterSustain / layer.decay);
  return x * x; // curved fall sounds punchier than a straight line
}
