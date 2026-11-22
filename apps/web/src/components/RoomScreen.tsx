'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useGameSession, useRoomView } from '@/hooks/useGameSession';
import { gameServerHttpUrl } from '@/net/serverUrl';
import { GameView } from './GameView';
import { LobbyPanel } from './LobbyPanel';
import { Toasts } from './Toasts';
import styles from './RoomScreen.module.css';

export function RoomScreen({ roomId, solo }: { roomId: string; solo: boolean }) {
  const router = useRouter();
  const session = useGameSession(roomId, solo);
  const view = useRoomView(session.store);
  const [copied, setCopied] = useState(false);
  const { room, fatal, status } = view;
  const inGame = room !== null && room.phase !== 'lobby';

  const copyInvite = async () => {
    const url = `${window.location.origin}/room/${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Invite link', url);
    }
  };

  const leave = () => {
    session.client.leave();
    router.push('/');
  };

  return (
    <div className={styles.screen} data-ingame={inGame}>
      <header className={styles.bar}>
        <Link href="/" className={styles.brand}>
          Platformer
        </Link>
        <div className={styles.room}>
          Room <strong>{roomId}</strong>
          <button className={styles.small} onClick={() => void copyInvite()}>
            {copied ? 'Copied!' : 'Copy invite link'}
          </button>
        </div>
        <div className={styles.right}>
          <span className={styles.conn} data-status={status}>
            {status === 'open' ? (view.rttMs !== null ? `${view.rttMs} ms` : 'online') : status}
          </span>
          <button className={`${styles.small} danger`} onClick={leave}>
            Leave
          </button>
        </div>
      </header>

      <main className={styles.body}>
        {fatal ? (
          <section className={styles.panel}>
            <h2>{fatal.code === 'UNREACHABLE' ? 'Connection lost' : "Can't join this room"}</h2>
            <p>{fatal.message}</p>
            {fatal.code === 'UNREACHABLE' && (
              <p className={styles.dim}>
                Is the game server running at <code>{gameServerHttpUrl()}</code>? Start it with <code>npm run dev</code>.
              </p>
            )}
            <div className={styles.row}>
              {fatal.code === 'UNREACHABLE' && (
                <button className="primary" onClick={() => session.client.retry()}>
                  Retry
                </button>
              )}
              <Link href="/">Back to home</Link>
            </div>
          </section>
        ) : !room ? (
          <section className={styles.panel}>
            <h2>{status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</h2>
            <p className={styles.dim}>Joining room {roomId}</p>
          </section>
        ) : room.phase === 'lobby' ? (
          <LobbyPanel session={session} view={view} />
        ) : (
          <GameView session={session} view={view} />
        )}
      </main>

      <Toasts store={session.store} notices={view.notices} />
    </div>
  );
}
