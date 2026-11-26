'use client';

import { isRoomCode, normalizeRoomCode } from '@platformer/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { gameServerHttpUrl } from '@/net/serverUrl';

export interface ServerHealth {
  rooms: number;
  connectedPlayers: number;
  levels: { id: string; name: string }[];
}

export type ServerState = { kind: 'checking' } | { kind: 'online'; health: ServerHealth } | { kind: 'offline' };

/** The game server's health, checked now and every 5 s. */
export function useServerHealth(): ServerState {
  const [server, setServer] = useState<ServerState>({ kind: 'checking' });
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch(`${gameServerHttpUrl()}/health`, { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        const health = (await response.json()) as ServerHealth;
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
  return server;
}

/** Making and joining rooms from the home screen. `beforeLeave` runs first (to save the name). */
export function useRoomActions(beforeLeave: () => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createRoom = async (solo: boolean) => {
    setBusy(true);
    setError(null);
    beforeLeave();
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

  /** False (with the error set) when the code is not a room code. */
  const joinRoom = (code: string): boolean => {
    const normalized = normalizeRoomCode(code);
    if (!isRoomCode(normalized)) {
      setError('Enter a room code (letters and digits).');
      return false;
    }
    setError(null);
    beforeLeave();
    router.push(`/room/${normalized}`);
    return true;
  };

  return { busy, error, setError, createRoom, joinRoom };
}
