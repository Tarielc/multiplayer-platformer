'use client';

import {
  LEVELS,
  MAX_PLAYERS,
  PLAYER_CONFIG,
  isRoomCode,
  normalizeRoomCode,
  type CharacterId,
} from '@platformer/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { loadPlayerName, loadPreferredCharacter, savePlayerName, savePreferredCharacter } from '@/net/identity';
import { gameServerHttpUrl } from '@/net/serverUrl';
import { CharacterPicker } from './CharacterPicker';
import styles from './HomeScreen.module.css';

interface Health {
  rooms: number;
  connectedPlayers: number;
  levels: { id: string; name: string }[];
}

type ServerState = { kind: 'checking' } | { kind: 'online'; health: Health } | { kind: 'offline' };

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

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <header className={styles.header}>
          <h1>Platformer Template</h1>
          <p>
            1–{MAX_PLAYERS} players per room · {LEVELS.entries.length} levels · server-authoritative netcode
          </p>
        </header>

        <label className={styles.field}>
          <span>Your name</span>
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
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ROOM CODE"
            aria-label="Room code"
            maxLength={12}
            spellCheck={false}
            autoCapitalize="characters"
          />
          <button type="submit" disabled={busy || code.trim() === ''}>
            Join
          </button>
        </form>

        {error && <p className={styles.error}>{error}</p>}

        <footer className={styles.status} data-state={server.kind}>
          <span className={styles.dot} />
          {server.kind === 'checking' && 'Checking game server…'}
          {server.kind === 'online' &&
            `Game server online · ${server.health.rooms} room(s) · ${server.health.connectedPlayers} player(s)`}
          {server.kind === 'offline' && (
            <span>
              Game server not reachable at <code>{gameServerHttpUrl()}</code>. Start everything with{' '}
              <code>npm run dev</code>.
            </span>
          )}
        </footer>
      </section>

      <section className={styles.help}>
        <h2>Controls</h2>
        <ul>
          <li>
            <kbd>←</kbd> <kbd>→</kbd> / <kbd>A</kbd> <kbd>D</kbd> move · <kbd>Space</kbd> / <kbd>W</kbd> / <kbd>↑</kbd>{' '}
            jump (hold for higher)
          </li>
          <li>
            <kbd>J</kbd> / <kbd>X</kbd> attack (shoves other players)
          </li>
          <li>
            <kbd>↓</kbd> + jump drops through wooden platforms · <kbd>Esc</kbd> menu · <kbd>F3</kbd> debug overlay
          </li>
          <li>Gamepad: stick / D-pad, A to jump, X to attack, Start for the menu</li>
        </ul>
      </section>
    </main>
  );
}
