'use client';

import type { GameMode, LeaderboardResponse } from '@platformer/shared';
import { useEffect, useState } from 'react';
import { gameServerHttpUrl } from './serverUrl';

export type LeaderboardState =
  | { kind: 'loading' }
  /** No database on the server, or the server can't be reached. */
  | { kind: 'offline' }
  | { kind: 'ready'; data: Extract<LeaderboardResponse, { enabled: true }> };

export async function fetchLeaderboard(mode: GameMode, solo: boolean, limit = 10, signal?: AbortSignal): Promise<LeaderboardResponse> {
  const params = new URLSearchParams({ mode, solo: solo ? '1' : '0', limit: String(limit) });
  const response = await fetch(`${gameServerHttpUrl()}/leaderboard?${params}`, { cache: 'no-store', signal: signal ?? null });
  if (!response.ok) throw new Error(`leaderboard: HTTP ${response.status}`);
  return (await response.json()) as LeaderboardResponse;
}

/** Fetches one mode's boards; refetches when the mode or the solo filter changes. */
export function useLeaderboard(mode: GameMode, solo: boolean, limit = 10): LeaderboardState {
  const [state, setState] = useState<LeaderboardState>({ kind: 'loading' });
  useEffect(() => {
    const abort = new AbortController();
    setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    fetchLeaderboard(mode, solo, limit, abort.signal).then(
      (data) => setState(data.enabled ? { kind: 'ready', data } : { kind: 'offline' }),
      () => {
        if (!abort.signal.aborted) setState({ kind: 'offline' });
      },
    );
    return () => abort.abort();
  }, [mode, solo, limit]);
  return state;
}
