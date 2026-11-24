'use client';

import {
  CHARACTER_IDS,
  CHARACTERS,
  GAME_MODES,
  LEVELS,
  MAX_PLAYERS,
  MODE_CONFIG,
  PLAYER_CONFIG,
  isRoomCode,
  normalizeRoomCode,
  type CharacterId,
  type GameMode,
} from '@platformer/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { abilityIconPath } from '@/game/abilities/abilityArt';
import { DEFAULT_ASSET_BASE } from '@/game/services';
import { loadPlayerName, loadPreferredCharacter, savePlayerName, savePreferredCharacter } from '@/net/identity';
import { gameServerHttpUrl } from '@/net/serverUrl';
import { ABILITY_BLURBS, BACKDROP_URL, GAME_TITLE, abilityName } from './brand';
import { CharacterPicker } from './CharacterPicker';
import { CharacterPortrait } from './CharacterPortrait';
import { Fireflies } from './Fireflies';
import { MossCap } from './PixelIcons';
import styles from './HomeScreen.module.css';

interface Health {
  rooms: number;
  connectedPlayers: number;
  levels: { id: string; name: string }[];
}

type ServerState = { kind: 'checking' } | { kind: 'online'; health: Health } | { kind: 'offline' };

const MODE_ART: Record<GameMode, { image: string; alt: string }> = {
  coop: { image: '/ui/mode-coop.png', alt: "Four players face the rhino boss in Rhino's Den" },
  race: { image: '/ui/mode-race.png', alt: 'Three racers run through Orchard Hills' },
};

export function HomeScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  // null until picked: the server then uses the slot default (P1 Bunny Man, P2 Virtual Guy, …).
  const [character, setCharacter] = useState<CharacterId | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<ServerState>({ kind: 'checking' });

  useEffect(() => {
    setName(loadPlayerName());
    setCharacter(loadPreferredCharacter());
  }, []);

  const pickCharacter = (id: CharacterId) => {
    setCharacter(id);
    savePreferredCharacter(id);
  };

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch(`${gameServerHttpUrl()}/health`, { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        const health = (await response.json()) as Health;
        if (!cancelled) setServer({ kind: 'online', health });
      } catch {
        if (!cancelled) setServer({ kind: 'offline' });
      }
    };
    void check();
    const timer = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const createRoom = async (solo: boolean) => {
    setBusy(true);
    setError(null);
    savePlayerName(name);
    try {
      const response = await fetch(`${gameServerHttpUrl()}/rooms`, { method: 'POST' });
      if (!response.ok) throw new Error(response.status === 503 ? 'The server is full.' : `HTTP ${response.status}`);
      const { roomId } = (await response.json()) as { roomId: string };
      router.push(`/room/${roomId}${solo ? '?solo=1' : ''}`);
    } catch (err) {
      setError(`Could not create a room: ${err instanceof Error ? err.message : String(err)}`);
      setBusy(false);
    }
  };

  const joinRoom = (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (!isRoomCode(normalized)) {
      setError('Enter a room code (letters and digits).');
      return;
    }
    savePlayerName(name);
    router.push(`/room/${normalized}`);
  };

  const levelCount = LEVELS.entries.length;

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-label="Play">
        <img className={`${styles.backdrop} px-sprite`} src={BACKDROP_URL} alt="" />
        <div className={styles.scrim} aria-hidden />
        <Fireflies className={styles.fireflies} />

        <div className={styles.wrap}>
          <nav className={styles.nav} aria-label="Site">
            <a href="#top" className={`${styles.brand} px-outline`}>
              {GAME_TITLE}
            </a>
            <div className={styles.links}>
              <a className="px-outline-sm" href="#characters">
                Characters
              </a>
              <a className="px-outline-sm" href="#modes">
                Modes
              </a>
              <a className="px-outline-sm" href="#levels">
                Levels
              </a>
              <a className="px-outline-sm" href="#controls">
                Controls
              </a>
              <ServerStatus server={server} />
            </div>
          </nav>

          <div id="top" className={styles.heroBody}>
            <h1 className={styles.logo}>{GAME_TITLE}</h1>
            <p className={`${styles.tagline} px-outline-sm`}>
              An online platformer for 1–{MAX_PLAYERS} players. Team up to topple the rhino, or race your friends to the
              trophy through {levelCount} overgrown levels.
            </p>

            <div className={`${styles.play} px-panel`}>
              <MossCap className={styles.moss} />
              <label className={styles.field}>
                <span className="px-label">Your name</span>
                <input
                  value={name}
                  maxLength={PLAYER_CONFIG.nameMaxLength}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setName(savePlayerName(name))}
                  placeholder={PLAYER_CONFIG.defaultName}
                  autoComplete="nickname"
                />
              </label>

              <CharacterPicker value={character} onChange={pickCharacter} />

              <div className={styles.actions}>
                <button className="primary" disabled={busy} onClick={() => void createRoom(true)}>
                  Play solo
                </button>
                <button disabled={busy} onClick={() => void createRoom(false)}>
                  Create room
                </button>
              </div>

              <form className={styles.join} onSubmit={joinRoom}>
                <label htmlFor="room-code" className="px-label">
                  Got a code?
                </label>
                <input
                  id="room-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="ROOM CODE"
                  maxLength={12}
                  spellCheck={false}
                  autoCapitalize="characters"
                />
                <button type="submit" disabled={busy || code.trim() === ''}>
                  Join
                </button>
              </form>

              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              {server.kind === 'offline' && (
                <p className={styles.offline}>
                  Game server not reachable at <code>{gameServerHttpUrl()}</code>. Start everything with{' '}
                  <code>npm run dev</code>.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section id="characters" className={styles.section} aria-labelledby="characters-title">
        <header className={styles.sectionHead}>
          <span className={styles.kicker}>Characters</span>
          <h2 id="characters-title" className="px-outline">
            One special each. Fruit recharges it.
          </h2>
        </header>
        <div className={styles.cards}>
          {CHARACTER_IDS.map((id) => (
            <article key={id} className={`${styles.card} px-panel`}>
              <div className={styles.alcove}>
                <CharacterPortrait characterId={id} scale={6} animated className={styles.alcovePortrait} />
              </div>
              <h3 className="px-outline-sm">{CHARACTERS[id].name}</h3>
              <div className={styles.ability}>
                <span className={`${styles.abilityIcon} px-notch`}>
                  <img className="px-sprite" src={`${DEFAULT_ASSET_BASE}/${abilityIconPath(id)}`} alt="" />
                </span>
                <span className={styles.abilityName}>{abilityName(id)}</span>
              </div>
              <p>{ABILITY_BLURBS[id]}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="modes" className={styles.section} aria-labelledby="modes-title">
        <header className={styles.sectionHead}>
          <span className={styles.kicker}>Modes</span>
          <h2 id="modes-title" className="px-outline">
            Together, or against each other.
          </h2>
        </header>
        <div className={styles.modes}>
          {GAME_MODES.map((mode) => {
            const config = MODE_CONFIG[mode];
            return (
              <article key={mode} className={`${styles.mode} px-panel`} data-mode={mode}>
                <img className={`${styles.modeArt} px-sprite`} src={MODE_ART[mode].image} alt={MODE_ART[mode].alt} />
                <div className={styles.modeHead}>
                  <h3 className="px-outline">{config.name}</h3>
                  <span className="px-label">
                    {config.race ? `${config.race.placePoints.join(' · ')} pts` : 'Shared checkpoints'}
                  </span>
                </div>
                <p>{config.summary}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="levels" className={styles.section} aria-labelledby="levels-title">
        <header className={styles.sectionHead}>
          <span className={styles.kicker}>Levels</span>
          <h2 id="levels-title" className="px-outline">
            {levelCount} levels, played in order.
          </h2>
        </header>
        <ol className={styles.levels}>
          {LEVELS.entries.map((entry, index) => (
            <li key={entry.id} className="px-notch" data-final={entry.next === null}>
              <span className={`${styles.levelNo} px-outline`}>{index + 1}</span>
              <span className={styles.levelName}>{entry.name}</span>
              {entry.next === null && <span className={styles.levelTag}>Finale</span>}
            </li>
          ))}
        </ol>
      </section>

      <section id="controls" className={styles.section} aria-labelledby="controls-title">
        <header className={styles.sectionHead}>
          <span className={styles.kicker}>Controls</span>
          <h2 id="controls-title" className="px-outline">
            Keyboard, pad or thumbs.
          </h2>
        </header>
        <div className={`${styles.controls} px-panel`}>
          <div className={styles.tableScroll}>
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Keyboard</th>
                  <th>Gamepad</th>
                  <th>Touch</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Move</td>
                  <td>
                    <kbd>←</kbd> <kbd>→</kbd> / <kbd>A</kbd> <kbd>D</kbd>
                  </td>
                  <td>Left stick, D-pad</td>
                  <td>Walk stick (left)</td>
                </tr>
                <tr>
                  <td>Jump · hold for higher, again in mid-air to double jump</td>
                  <td>
                    <kbd>Space</kbd> <kbd>↑</kbd> <kbd>W</kbd> <kbd>Z</kbd> <kbd>K</kbd>
                  </td>
                  <td>A / B</td>
                  <td>Jump button</td>
                </tr>
                <tr>
                  <td>Drop through planks</td>
                  <td>
                    <kbd>↓</kbd> + jump
                  </td>
                  <td>Down + A</td>
                  <td>Walk stick down + Jump</td>
                </tr>
                <tr>
                  <td>Attack · shoves players, breaks boxes</td>
                  <td>
                    <kbd>J</kbd> <kbd>X</kbd>
                  </td>
                  <td>X / □</td>
                  <td>Attack stick: lift to swing, drag first to aim</td>
                </tr>
                <tr>
                  <td>Special ability</td>
                  <td>
                    <kbd>L</kbd> <kbd>C</kbd> right-click · aim with arrows or mouse
                  </td>
                  <td>Y / RB · aim with the right stick</td>
                  <td>Special stick: drag to aim, lift to fire</td>
                </tr>
                <tr>
                  <td>Menu · debug overlay</td>
                  <td>
                    <kbd>Esc</kbd> · <kbd>F3</kbd>
                  </td>
                  <td>Start</td>
                  <td>Menu button (top right)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerRow}>
          <span className={`${styles.footerBrand} px-outline`}>{GAME_TITLE}</span>
          <span>
            1–{MAX_PLAYERS} players per room · {levelCount} levels · server-authoritative netcode
          </span>
          <ServerStatus server={server} />
        </div>
      </footer>
    </div>
  );
}

function ServerStatus({ server }: { server: ServerState }) {
  return (
    <span className={styles.status} data-state={server.kind} role="status">
      <span className={styles.dot} aria-hidden />
      {server.kind === 'checking' && 'Checking server…'}
      {server.kind === 'online' &&
        `Server online · ${server.health.rooms} room${server.health.rooms === 1 ? '' : 's'} · ${server.health.connectedPlayers} player${server.health.connectedPlayers === 1 ? '' : 's'}`}
      {server.kind === 'offline' && 'Server offline'}
    </span>
  );
}
