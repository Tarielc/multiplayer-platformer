'use client';

import { CHARACTER_IDS, CHARACTERS, PLAYER_CONFIG, PLAYER_SLOTS, type CharacterId } from '@platformer/shared';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { abilityIconPath } from '@/game/abilities/abilityArt';
import { DEFAULT_ASSET_BASE } from '@/game/services';
import { ABILITY_BLURBS, BACKDROP_URL, abilityName } from './brand';
import { CharacterPortrait } from './CharacterPortrait';
import styles from './CharacterSelect.module.css';
import type { PlayIntent } from './TitleScreen';

const CONFIRM_LABEL: Record<PlayIntent['kind'], string> = { solo: 'Play', create: 'Create room', join: 'Join room' };

/**
 * Full-screen "Choose your character" step between the title menu and the game: four large
 * cards (the picked one lifts, runs and gets your marker), your name, Back and Confirm.
 * ←/→ choose, Enter confirms, Esc goes back.
 */
export function CharacterSelect({
  intent,
  initialCharacter,
  initialName,
  busy,
  error,
  onBack,
  onConfirm,
}: {
  intent: PlayIntent;
  initialCharacter: CharacterId;
  initialName: string;
  busy: boolean;
  error: ReactNode;
  onBack: () => void;
  onConfirm: (character: CharacterId, name: string) => void;
}) {
  const [picked, setPicked] = useState<CharacterId>(initialCharacter);
  const [name, setName] = useState(initialName);
  const radios = useRef(new Map<CharacterId, HTMLInputElement>());

  // Focus the picked card so the arrow keys move straight away.
  useEffect(() => radios.current.get(initialCharacter)?.focus({ preventScroll: true }), [initialCharacter]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!busy) onBack();
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      // Radios move themselves; text fields keep their caret keys.
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const index = CHARACTER_IDS.indexOf(picked);
      const next = CHARACTER_IDS[(index + step + CHARACTER_IDS.length) % CHARACTER_IDS.length]!;
      setPicked(next);
      radios.current.get(next)?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onBack, picked]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) onConfirm(picked, name);
  };

  // Solo and new rooms make you the host, P1; joining, your slot is not known yet.
  const marker =
    intent.kind === 'join'
      ? { label: 'You', color: 'var(--firefly)' }
      : { label: PLAYER_SLOTS[0]!.label, color: PLAYER_SLOTS[0]!.css };

  return (
    <form className={styles.select} onSubmit={submit} aria-labelledby="select-title">
      <img className={`${styles.backdrop} px-sprite`} src={BACKDROP_URL} alt="" />
      <div className={styles.scrim} aria-hidden />

      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 id="select-title" className={`${styles.title} px-outline`}>
            Choose your character
          </h1>
          <p>Each one has a special ability. Fruit tops it up.</p>
        </div>
        <div className={`${styles.who} px-notch`} style={{ '--mark': marker.color } as CSSProperties}>
          <span className={styles.whoMode}>
            {intent.kind === 'solo' ? 'Solo' : intent.kind === 'create' ? 'New room' : `Room ${intent.code}`}
          </span>
          <span className={styles.whoName}>{name.trim() || PLAYER_CONFIG.defaultName}</span>
        </div>
      </header>

      <div className={styles.cards} role="radiogroup" aria-label="Character">
        {CHARACTER_IDS.map((id) => {
          const selected = picked === id;
          return (
            <label key={id} className={styles.card} data-selected={selected}>
              <input
                ref={(el) => {
                  if (el) radios.current.set(id, el);
                  else radios.current.delete(id);
                }}
                className={styles.radio}
                type="radio"
                name="character"
                value={id}
                checked={selected}
                onChange={() => setPicked(id)}
                aria-describedby={`ability-${id}`}
              />
              {selected && (
                <span className={styles.marker} style={{ '--mark': marker.color } as CSSProperties} aria-hidden>
                  <span className="px-notch">{marker.label}</span>
                  <svg width="16" height="8" viewBox="0 0 4 2" shapeRendering="crispEdges">
                    <path d="M0 0h4v1h-1v1h-2v-1h-1z" />
                  </svg>
                </span>
              )}
              <span className={styles.alcove}>
                <CharacterPortrait
                  characterId={id}
                  scale={6}
                  animated
                  clip={selected ? 'run' : 'idle'}
                  className={styles.portrait}
                />
              </span>
              <span className={`${styles.name} px-outline-sm`}>{CHARACTERS[id].name}</span>
              <span className={styles.ability}>
                <span className={`${styles.abilityIcon} px-notch`}>
                  <img className="px-sprite" src={`${DEFAULT_ASSET_BASE}/${abilityIconPath(id)}`} alt="" />
                </span>
                <span className={styles.abilityText}>
                  <span className={styles.special}>Special</span>
                  <span className={styles.abilityName}>{abilityName(id)}</span>
                </span>
              </span>
              <span id={`ability-${id}`} className={styles.desc}>
                {ABILITY_BLURBS[id]}
              </span>
            </label>
          );
        })}
      </div>

      <footer className={styles.foot}>
        <label className={styles.nameField}>
          <span className="px-label">Your name</span>
          <input
            value={name}
            maxLength={PLAYER_CONFIG.nameMaxLength}
            onChange={(e) => setName(e.target.value)}
            placeholder={PLAYER_CONFIG.defaultName}
            autoComplete="nickname"
          />
        </label>
        <div className={styles.keys} aria-hidden>
          <kbd>←</kbd>
          <kbd>→</kbd>
          <span className="px-outline-sm">Choose</span>
        </div>
        <div className={styles.buttons}>
          <button type="button" onClick={onBack} disabled={busy}>
            Back
          </button>
          <button type="submit" className={`primary ${styles.confirm}`} disabled={busy}>
            {busy ? 'Starting…' : CONFIRM_LABEL[intent.kind]}
          </button>
        </div>
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
      </footer>
    </form>
  );
}
