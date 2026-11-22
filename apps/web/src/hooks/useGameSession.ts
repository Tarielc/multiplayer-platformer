'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { registerDevProvider } from '@/devtools/devHook';
import { GameClient } from '@/net/GameClient';
import { getClientId, loadPlayerName } from '@/net/identity';
import { RoomStore, type RoomView } from '@/net/RoomStore';
import { gameServerWsUrl } from '@/net/serverUrl';

export interface GameSession {
  client: GameClient;
  store: RoomStore;
}

/**
 * One GameClient + RoomStore per room screen. Construction is side-effect free (safe for
 * Strict Mode's double render); the socket is opened/closed by the effect.
 */
export function useGameSession(roomId: string, autoReady: boolean): GameSession {
  const [session] = useState<GameSession>(() => {
    const client = new GameClient({
      roomId,
      autoReady,
      name: loadPlayerName,
      clientId: getClientId,
      url: gameServerWsUrl,
    });
    return { client, store: new RoomStore(client) };
  });

  useEffect(() => {
    const { client } = session;
    client.connect();
    const unregister = registerDevProvider('client', () => ({
      status: client.status,
      roomId: client.roomId,
      playerId: client.playerId,
      slot: client.slot,
      phase: client.room?.phase ?? null,
      run: client.room?.level?.run ?? null,
      paused: client.room?.paused ?? false,
      serverTick: client.latestWorld?.tick ?? null,
      players: client.room?.players.length ?? 0,
      rttMs: client.rttMs === null ? null : Math.round(client.rttMs),
    }));
    return () => {
      unregister();
      client.disconnect();
    };
  }, [session]);

  return session;
}

export function useRoomView(store: RoomStore): RoomView {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
