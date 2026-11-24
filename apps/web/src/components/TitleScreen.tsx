'use client';

import { MAX_PLAYERS, isRoomCode, normalizeRoomCode, type CharacterId } from '@platformer/shared';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  saveAudioSettings,
  type AudioSettings,
} from '@/game/audio/audioSettings';
import { BACKDROP_URL, GAME_TITLE } from './brand';
import { CharacterPortrait } from './CharacterPortrait';
import { Fireflies } from './Fireflies';
import { MenuArrow, MossCap } from './PixelIcons';
import styles from './TitleScreen.module.css';

/** What the player picked on the title screen; the character select then carries it out. */
export type PlayIntent = { kind: 'solo' } | { kind: 'create' } | { kind: 'join'; code: string };

type Item = 'solo' | 'create' | 'join' | 'settings';
const ITEMS: readonly { id: Item; label: string }[] = [
  { id: 'solo', label: 'Play solo' },
  { id: 'create', label: 'Create room' },
  { id: 'join', label: 'Join room' },
  { id: 'settings', label: 'Settings' },
];

/** The backdrop is drawn at this width; the character's spot and size are measured in it. */
const BACKDROP_WIDTH = 1280;
/** Pixels per sprite pixel for the character in front of the shrine, at BACKDROP_WIDTH. */
const HERO_SCALE = 3;

/**
 * The game's front screen: the shrine, the logo and a menu driven by mouse, touch or ↑/↓ and
 * Enter. Join room and Settings open in place under their item.
 */
export function TitleScreen({
  character,
  status,
  notice,
  onChoose,
}: {
  /** Stands in front of the shrine: your last pick. */
  character: CharacterId;
  status: ReactNode;
  /** Shown under the menu (server offline, errors). */
  notice: ReactNode;
  onChoose: (intent: PlayIntent) => void;
}) {
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState<'join' | 'settings' | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [audio, setAudio] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const [heroScale, setHeroScale] = useState(HERO_SCALE);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const sceneRef = useRef<HTMLDivElement>(null);

  // localStorage is browser-only: load after hydration.
  useEffect(() => setAudio(loadAudioSettings()), []);

  // A game menu: the first item has focus, so ↑/↓ and Enter work straight away.
  useEffect(() => itemRefs.current[0]?.focus({ preventScroll: true }), []);

  // The backdrop covers the screen at any size: keep the character in proportion, on whole pixels.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const fit = () => setHeroScale(Math.max(2, Math.round((HERO_SCALE * scene.clientWidth) / BACKDROP_WIDTH)));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(scene);
    return () => observer.disconnect();
  }, []);

  // ↑/↓ with nothing focused (after a click on the backdrop) picks the menu back up.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      if (document.activeElement && document.activeElement !== document.body) return;
      if (window.scrollY > window.innerHeight / 2) return;
      event.preventDefault();
      itemRefs.current[selected]?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const onMenuKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      const item = open === 'join' ? 2 : 3;
      setOpen(null);
      itemRefs.current[item]?.focus();
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    // Inside the open join / settings rows the keys belong to the fields.
    if (event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    itemRefs.current[(selected + step + ITEMS.length) % ITEMS.length]?.focus();
  };

  const activate = (item: Item) => {
    setSelected(ITEMS.findIndex((entry) => entry.id === item));
    if (item === 'solo' || item === 'create') onChoose({ kind: item });
    else setOpen((current) => (current === item ? null : item));
  };

  const join = (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (!isRoomCode(normalized)) {
      setCodeError('Enter a room code (letters and digits).');
      return;
    }
    setCodeError(null);
    onChoose({ kind: 'join', code: normalized });
  };

  const updateAudio = (next: AudioSettings) => setAudio(saveAudioSettings(next));
  const volume = Math.round(audio.volume * 100);

  return (
    <section className={styles.title} aria-label={GAME_TITLE}>
      <div ref={sceneRef} className={styles.scene}>
        <img className={`${styles.backdrop} px-sprite`} src={BACKDROP_URL} alt="" />
        <div className={styles.hero} style={{ '--hero': `${32 * heroScale}px` } as CSSProperties}>
          <span className={styles.shadow} aria-hidden />
          <CharacterPortrait characterId={character} scale={heroScale} animated />
        </div>
      </div>
      <div className={styles.scrim} aria-hidden />
      <Fireflies />

      <div className={styles.content}>
        <div className={styles.brand}>
          <h1 className={styles.logo}>{GAME_TITLE}</h1>
          <div className={styles.plate}>
            <MossCap className={styles.moss} />
            <span>1–{MAX_PLAYERS} players · Co-op &amp; races</span>
          </div>
        </div>

        <nav className={styles.menu} aria-label="Main menu" onKeyDown={onMenuKey}>
          {ITEMS.map((item, i) => (
            <div key={item.id} className={styles.entry}>
              <button
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                className={styles.item}
                data-selected={selected === i}
                aria-expanded={item.id === 'join' || item.id === 'settings' ? open === item.id : undefined}
                onMouseEnter={() => setSelected(i)}
                onFocus={() => setSelected(i)}
                onClick={() => activate(item.id)}
              >
                <span className={styles.cursor}>
                  <MenuArrow />
                </span>
                {item.label}
              </button>

              {item.id === 'join' && open === 'join' && (
                <form className={styles.drawer} onSubmit={join}>
                  <label className={styles.codeField}>
                    <span className="px-label">Room code</span>
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      maxLength={12}
                      spellCheck={false}
                      autoCapitalize="characters"
                      autoComplete="off"
                      autoFocus
                      placeholder="K7QX2"
                      aria-invalid={codeError ? true : undefined}
                    />
                  </label>
                  <button type="submit" className="primary" disabled={code.trim() === ''}>
                    Join
                  </button>
                  {codeError && (
                    <p className={styles.error} role="alert">
                      {codeError}
                    </p>
                  )}
                </form>
              )}

              {item.id === 'settings' && open === 'settings' && (
                <div className={styles.drawer} role="group" aria-label="Settings">
                  <div className={styles.setting}>
                    <span className="px-label">Sound</span>
                    <button
                      type="button"
                      className={styles.toggle}
                      aria-pressed={!audio.muted}
                      data-on={!audio.muted}
                      onClick={() => updateAudio({ ...audio, muted: !audio.muted })}
                    >
                      {audio.muted ? 'Off' : 'On'}
                    </button>
                  </div>
                  <label className={styles.setting} data-disabled={audio.muted}>
                    <span className="px-label">Volume</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={volume}
                      disabled={audio.muted}
                      onChange={(e) => updateAudio({ ...audio, volume: Number(e.target.value) / 100 })}
                      style={{ '--fill': `${volume}%` } as CSSProperties}
                    />
                    <span className={styles.volume}>{volume}</span>
                  </label>
                </div>
              )}
            </div>
          ))}
        </nav>

        {notice && <div className={styles.notice}>{notice}</div>}
      </div>

      <div className={styles.bottom}>
        {status}
        <a className={`${styles.more} px-outline-sm`} href="#characters">
          About the game ↓
        </a>
        <div className={styles.keys} aria-hidden>
          <kbd>↑</kbd>
          <kbd>↓</kbd>
          <span className="px-outline-sm">Select</span>
          <kbd>Enter</kbd>
          <span className="px-outline-sm">Confirm</span>
        </div>
      </div>
    </section>
  );
}
