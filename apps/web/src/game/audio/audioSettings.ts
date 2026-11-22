/** Player audio preferences, persisted per browser. Safe to import during server rendering. */
export interface AudioSettings {
  muted: boolean;
  /** Master volume 0..1. */
  volume: number;
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = { muted: false, volume: 0.7 };

const KEY = 'platformer.audio';

export function loadAudioSettings(): AudioSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_AUDIO_SETTINGS };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<AudioSettings> | null;
    return normalizeAudioSettings(raw ?? {});
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function saveAudioSettings(settings: AudioSettings): AudioSettings {
  const clean = normalizeAudioSettings(settings);
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    // Storage full or disabled (private mode): keep the in-memory value.
  }
  return clean;
}

export function normalizeAudioSettings(value: Partial<AudioSettings>): AudioSettings {
  const volume = typeof value.volume === 'number' && Number.isFinite(value.volume) ? value.volume : DEFAULT_AUDIO_SETTINGS.volume;
  return {
    muted: typeof value.muted === 'boolean' ? value.muted : DEFAULT_AUDIO_SETTINGS.muted,
    volume: Math.min(1, Math.max(0, volume)),
  };
}
