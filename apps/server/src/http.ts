import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import {
  LEADERBOARD_MAX_LIMIT,
  LEVELS,
  MAX_PLAYERS,
  NET_CONFIG,
  PROTOCOL_VERSION,
  isGameMode,
  type LevelManifest,
} from '@platformer/shared';
import { buildLeaderboard, type LeaderboardRequest } from './leaderboard/boards';
import { NullRunRecorder, type RunRecorder } from './leaderboard/RunRecorder';
import type { LevelRepository } from './levels/LevelRepository';
import type { Logger } from './log';
import type { RoomManager } from './rooms/RoomManager';

export interface HttpDeps {
  rooms: RoomManager;
  levels: LevelRepository;
  corsOrigin: string;
  connections: () => number;
  startedAt?: number;
  /** Fastest-runs store; leaderboard requests answer `{ enabled: false }` without one. */
  leaderboard?: RunRecorder;
  manifest?: LevelManifest;
  log?: Logger;
}

/**
 * Tiny JSON API next to the WebSocket endpoint:
 *   GET  /health        server status (used by the home screen)
 *   POST /rooms         allocate a fresh room code -> { roomId }
 *   GET  /rooms/:code   room summary (exists, phase, player count, joinable)
 *   GET  /leaderboard   fastest runs: ?mode=race|coop&solo=0|1&limit=1..50
 */
export function createHttpHandler(deps: HttpDeps): RequestListener {
  const startedAt = deps.startedAt ?? Date.now();
  const leaderboard = deps.leaderboard ?? new NullRunRecorder();
  const manifest = deps.manifest ?? LEVELS;
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', deps.corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');
    req.resume(); // no endpoint reads a body; drain it so keep-alive works

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      const stats = deps.rooms.stats();
      return json(res, 200, {
        ok: true,
        protocol: PROTOCOL_VERSION,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        tickRate: NET_CONFIG.tickRate,
        snapshotRate: NET_CONFIG.snapshotRate,
        maxPlayers: MAX_PLAYERS,
        rooms: stats.rooms,
        players: stats.players,
        connectedPlayers: stats.connected,
        connections: deps.connections(),
        levels: deps.levels.list().map((l) => ({ id: l.entry.id, name: l.entry.name, checksum: l.checksum })),
      });
    }

    if (req.method === 'POST' && url.pathname === '/rooms') {
      const room = deps.rooms.create();
      if (!room) return json(res, 503, { error: 'SERVER_FULL' });
      return json(res, 201, { roomId: room.id });
    }

    if (req.method === 'GET' && url.pathname === '/leaderboard') {
      const request = parseLeaderboardQuery(url.searchParams);
      if (!request) return json(res, 400, { error: 'BAD_REQUEST' });
      buildLeaderboard(leaderboard, manifest, deps.levels, request).then(
        (body) => json(res, 200, body),
        (error: unknown) => {
          deps.log?.warn(`leaderboard query failed: ${error instanceof Error ? error.message : String(error)}`);
          json(res, 503, { error: 'LEADERBOARD_UNAVAILABLE' });
        },
      );
      return;
    }

    const match = /^\/rooms\/([A-Za-z0-9]{3,12})$/.exec(url.pathname);
    if (req.method === 'GET' && match?.[1]) {
      const room = deps.rooms.get(match[1]);
      return room ? json(res, 200, room.summary()) : json(res, 404, { error: 'ROOM_NOT_FOUND' });
    }

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Platformer game server. WebSocket endpoint: /ws  Status: /health\n');
      return;
    }

    json(res, 404, { error: 'NOT_FOUND' });
  };
}

/** `mode` defaults to race, `solo` to all players, `limit` to 10 (clamped to 1..50). */
export function parseLeaderboardQuery(params: URLSearchParams): LeaderboardRequest | null {
  const mode = params.get('mode') ?? 'race';
  if (!isGameMode(mode)) return null;
  const soloParam = params.get('solo') ?? '0';
  if (soloParam !== '0' && soloParam !== '1') return null;
  const limitParam = params.get('limit');
  const limit = limitParam === null ? 10 : Number.parseInt(limitParam, 10);
  if (!Number.isFinite(limit)) return null;
  return { mode, solo: soloParam === '1', limit: Math.min(LEADERBOARD_MAX_LIMIT, Math.max(1, limit)) };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
