import type { CharacterId } from '@platformer/shared';
import * as Phaser from 'phaser';
import { CHARACTER_ART } from '../characters/characterArt';
import type { AudioSettings } from './audioSettings';
import { renderSfx } from './sfxSynth';
import { SOUND_CUE_DEFS, SOUND_CUES, sfxKey, type SoundCue } from './soundCues';

export const SOUND_CONFIG = {
  /** Remote sounds within this distance of the camera centre play at full volume (px). */
  fullVolumeRadius: 220,
  /** … and fade out completely at this distance. */
  hearingRadius: 720,
  /** Max stereo pan for sounds at the edge of the screen (0..1). */
  maxPan: 0.6,
} as const;

/** Queues recorded overrides (`SOUND_CUE_DEFS[cue].file`). Call from a scene's preload. */
export function queueSoundOverrides(scene: Phaser.Scene, assetBase: string): void {
  if (scene.sound instanceof Phaser.Sound.NoAudioSoundManager) return;
  for (const cue of SOUND_CUES) {
    const file = SOUND_CUE_DEFS[cue].file;
    if (file && !scene.cache.audio.exists(sfxKey(cue))) scene.load.audio(sfxKey(cue), `${assetBase}/${file}`);
  }
}

/**
 * Synthesizes every cue that has no loaded recording into an AudioBuffer in the game's audio
 * cache, where Phaser's WebAudio sounds read it from. Web Audio only; on HTML5 audio only
 * recorded overrides play. Call once per game, after preload.
 */
export function prepareSoundCues(scene: Phaser.Scene): void {
  const sound = scene.sound;
  if (!(sound instanceof Phaser.Sound.WebAudioSoundManager) || !sound.context) return;
  const context = sound.context;
  SOUND_CUES.forEach((cue, index) => {
    const key = sfxKey(cue);
    if (scene.cache.audio.exists(key)) return;
    const samples = renderSfx(SOUND_CUE_DEFS[cue].recipe, context.sampleRate, index + 1);
    const buffer = context.createBuffer(1, samples.length, context.sampleRate);
    buffer.getChannelData(0).set(samples);
    scene.cache.audio.add(key, buffer);
  });
}

export interface PlayOptions {
  /** World position; remote sounds fade with distance and pan. */
  x?: number;
  y?: number;
  /** Caused by the local player (never attenuated). Defaults to true. */
  isSelf?: boolean;
  /** Applies the character's voice pitch to voiced cues. */
  characterId?: CharacterId;
}

/**
 * Plays cues for one scene: master mute/volume, per-cue throttling and voice limits, distance
 * attenuation and panning for remote players, pitch jitter and per-character voices.
 *
 * Sounds requested while the audio context is locked (no user gesture yet) or suspended
 * (background tab) are dropped rather than queued, so nothing bursts out later.
 */
export class SoundController {
  private readonly lastPlayed = new Map<SoundCue, number>();
  private readonly active = new Map<SoundCue, Phaser.Sound.BaseSound[]>();
  private readonly counts: Partial<Record<SoundCue, number>> = {};

  constructor(
    private readonly scene: Phaser.Scene,
    settings: AudioSettings,
  ) {
    this.applySettings(settings);
  }

  applySettings(settings: AudioSettings): void {
    this.scene.sound.setMute(settings.muted);
    this.scene.sound.setVolume(settings.volume);
  }

  play(cue: SoundCue, options: PlayOptions = {}): void {
    const def = SOUND_CUE_DEFS[cue];
    const isSelf = options.isSelf ?? true;
    if (def.selfOnly && !isSelf) return;
    const key = sfxKey(cue);
    if (!this.ready || !this.scene.cache.audio.exists(key)) return;

    const now = this.scene.time.now;
    const last = this.lastPlayed.get(cue);
    if (last !== undefined && now - last < def.minIntervalMs) return;
    const voices = (this.active.get(cue) ?? []).filter((s) => s.isPlaying && !s.pendingRemove);
    this.active.set(cue, voices);
    if (voices.length >= def.maxVoices) return;

    let volume = def.volume;
    let pan = 0;
    if (def.spatial && !isSelf && options.x !== undefined && options.y !== undefined) {
      const camera = this.scene.cameras.main;
      const dx = options.x - camera.midPoint.x;
      const dy = options.y - camera.midPoint.y;
      const distance = Math.hypot(dx, dy);
      const { fullVolumeRadius: near, hearingRadius: far, maxPan } = SOUND_CONFIG;
      const falloff = distance <= near ? 1 : Math.max(0, 1 - (distance - near) / (far - near));
      if (falloff < 0.02) return;
      volume *= falloff;
      pan = Phaser.Math.Clamp(dx / (camera.width / 2), -1, 1) * maxPan;
    }
    let detune = (Math.random() * 2 - 1) * def.detuneJitter;
    if (def.voiced && options.characterId) detune += CHARACTER_ART[options.characterId].voiceDetune;

    const sound = this.scene.sound.add(key, { volume, detune, pan });
    sound.once(Phaser.Sound.Events.COMPLETE, () => sound.destroy());
    if (!sound.play()) {
      sound.destroy();
      return;
    }
    voices.push(sound);
    this.lastPlayed.set(cue, now);
    this.counts[cue] = (this.counts[cue] ?? 0) + 1;
  }

  /** True when sounds can actually be heard right now. */
  get ready(): boolean {
    const sound = this.scene.sound;
    if (sound instanceof Phaser.Sound.NoAudioSoundManager || sound.locked || sound.mute) return false;
    if (sound instanceof Phaser.Sound.WebAudioSoundManager) return sound.context?.state === 'running';
    return true;
  }

  /** Dev/debug view: readiness and per-cue play counts. */
  stats(): Record<string, unknown> {
    const sound = this.scene.sound;
    return {
      webAudio: sound instanceof Phaser.Sound.WebAudioSoundManager,
      locked: sound.locked,
      contextState: sound instanceof Phaser.Sound.WebAudioSoundManager ? (sound.context?.state ?? null) : null,
      muted: sound.mute,
      volume: Math.round(sound.volume * 100) / 100,
      cues: SOUND_CUES.filter((cue) => this.scene.cache.audio.exists(sfxKey(cue))),
      played: { ...this.counts },
    };
  }

  destroy(): void {
    for (const voices of this.active.values()) {
      for (const sound of voices) {
        if (sound.pendingRemove) continue; // already finished and destroyed itself
        sound.stop();
        sound.destroy();
      }
    }
    this.active.clear();
  }
}
