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
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
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
  coop: { image: '/ui/mode-coop.png', alt: "Four players face the rhino boss in the Rhino Coliseum" },
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
  const [menuOpen, setMenuOpen] = useState(false);

  // The phone menu closes with Esc, like the game's.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

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
  const coopCount = LEVELS.campaign('coop').length;
  const raceCount = LEVELS.campaign('race').length;

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
              {SECTIONS.map(([id, label]) => (
                <a key={id} className="px-outline-sm" href={`#${id}`}>
                  {label}
                </a>
              ))}
              <ServerStatus server={server} />
            </div>
            {/* Phones: the links fold into a sheet behind this button. */}
            <div className={styles.compact}>
              <ServerStatus server={server} compact />
              <button
                type="button"
                className={styles.menuButton}
                aria-expanded={menuOpen}
                aria-controls="site-menu"
                onClick={() => setMenuOpen((open) => !open)}
              >
                <MenuGlyph open={menuOpen} />
                Menu
              </button>
            </div>
            {menuOpen && (
              <div id="site-menu" className={`${styles.sheet} px-panel`}>
                {SECTIONS.map(([id, label]) => (
                  <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}>
                    {label}
                  </a>
                ))}
                <ServerStatus server={server} />
              </div>
            )}
          </nav>

          <div id="top" className={styles.heroBody}>
            <h1 className={styles.logo}>{GAME_TITLE}</h1>
            <p className={`${styles.tagline} px-outline-sm`}>
              An online platformer for 1–{MAX_PLAYERS} players. Team up through {coopCount} co-op levels to topple the rhino,
              or race your friends (or the clock) to the trophy across {raceCount} more.
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
            Two campaigns, played in order.
          </h2>
        </header>
        {GAME_MODES.map((mode) => (
          <div key={mode} className={styles.campaign}>
            <h3 className={`${styles.campaignTitle} px-outline-sm`}>
              {mode === 'coop' ? 'Co-op · 2–4 players' : 'Race · solo or 2–4 players'}
            </h3>
            <ol className={styles.levels}>
              {LEVELS.campaign(mode).map((entry, index) => (
                <li key={entry.id} className="px-notch" data-final={entry.next === null}>
                  <span className={`${styles.levelNo} px-outline`}>{index + 1}</span>
                  <span className={styles.levelName}>{entry.name}</span>
                  {entry.next === null && <span className={styles.levelTag}>{mode === 'coop' ? 'Boss' : 'Finale'}</span>}
                </li>
              ))}
            </ol>
          </div>
        ))}
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
                {CONTROLS.map((row) => (
                  <tr key={row.action}>
                    <td>
                      {row.action}
                      {row.detail && ` · ${row.detail}`}
                    </td>
                    <td>{row.keys}</td>
                    <td>{row.pad}</td>
                    <td>{row.touch}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* Phones: one card per action, the touch control first. */}
        <ul className={styles.controlCards}>
          {CONTROLS.map((row) => (
            <li key={row.action} className="px-panel">
              <h3>{row.action}</h3>
              <p className={styles.touchLine}>{row.touch}</p>
              {row.detail && <p className={styles.detail}>{row.detail}</p>}
              <p className={styles.otherInputs}>
                {row.keys} <span aria-hidden>·</span> {row.pad}
              </p>
            </li>
          ))}
        </ul>
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

const SECTIONS = [
  ['characters', 'Characters'],
  ['modes', 'Modes'],
  ['levels', 'Levels'],
  ['controls', 'Controls'],
] as const;

interface ControlRow {
  action: string;
  /** Extra how-to, after the action in the table and under it on a card. */
  detail?: string;
  keys: ReactNode;
  pad: string;
  touch: string;
}

const CONTROLS: ControlRow[] = [
  {
    action: 'Move',
    keys: (
      <>
        <kbd>←</kbd> <kbd>→</kbd> / <kbd>A</kbd> <kbd>D</kbd>
      </>
    ),
    pad: 'Left stick, D-pad',
    touch: 'Walk stick (left)',
  },
  {
    action: 'Jump',
    detail: 'hold for higher, again in mid-air to double jump',
    keys: (
      <>
        <kbd>Space</kbd> <kbd>↑</kbd> <kbd>W</kbd> <kbd>Z</kbd> <kbd>K</kbd>
      </>
    ),
    pad: 'A / B',
    touch: 'Jump button',
  },
  {
    action: 'Drop through planks',
    keys: (
      <>
        <kbd>↓</kbd> + jump
      </>
    ),
    pad: 'Down + A',
    touch: 'Walk stick down + Jump',
  },
  {
    action: 'Attack',
    detail: 'shoves players, breaks boxes',
    keys: (
      <>
        <kbd>J</kbd> <kbd>X</kbd>
      </>
    ),
    pad: 'X / □',
    touch: 'Attack stick: lift to swing, drag first to aim',
  },
  {
    action: 'Special ability',
    keys: (
      <>
        <kbd>L</kbd> <kbd>C</kbd> right-click · aim with arrows or mouse
      </>
    ),
    pad: 'Y / RB · aim with the right stick',
    touch: 'Special stick: drag to aim, lift to fire',
  },
  {
    action: 'Menu',
    detail: 'F3 toggles the debug overlay',
    keys: (
      <>
        <kbd>Esc</kbd> · <kbd>F3</kbd>
      </>
    ),
    pad: 'Start',
    touch: 'Menu button (top right)',
  },
];

function MenuGlyph({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 7 7" width="14" height="14" shapeRendering="crispEdges" aria-hidden>
      <path
        fill="currentColor"
        d={
          open
            ? 'M0 0h2v1h1v1h1v-1h1v-1h2v1h-1v1h-1v1h-1v1h1v1h1v1h1v1h-2v-1h-1v-1h-1v1h-1v1h-2v-1h1v-1h1v-1h1v-1h-1v-1h-1z'
            : 'M0 0h7v1h-7zM0 3h7v1h-7zM0 6h7v1h-7z'
        }
      />
    </svg>
  );
}

function ServerStatus({ server, compact = false }: { server: ServerState; compact?: boolean }) {
  const full =
    server.kind === 'checking'
      ? 'Checking server…'
      : server.kind === 'offline'
        ? 'Server offline'
        : `Server online · ${server.health.rooms} room${server.health.rooms === 1 ? '' : 's'} · ${server.health.connectedPlayers} player${server.health.connectedPlayers === 1 ? '' : 's'}`;
  const short =
    server.kind === 'checking' ? '…' : server.kind === 'offline' ? 'Offline' : `${server.health.connectedPlayers} on`;
  return (
    <span
      className={styles.status}
      data-state={server.kind}
      role="status"
      aria-label={compact ? full : undefined}
      title={compact ? full : undefined}
    >
      <span className={styles.dot} aria-hidden />
      {compact ? short : full}
    </span>
  );
}
