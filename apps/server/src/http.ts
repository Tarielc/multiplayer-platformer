import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { MAX_PLAYERS, NET_CONFIG, PROTOCOL_VERSION } from '@platformer/shared';
import type { LevelRepository } from './levels/LevelRepository';
import type { RoomManager } from './rooms/RoomManager';

export interface HttpDeps {
  rooms: RoomManager;
  levels: LevelRepository;
  corsOrigin: string;
  connections: () => number;
  startedAt?: number;
}

/**
 * Tiny JSON API next to the WebSocket endpoint:
 *   GET  /health        server status (used by the home screen)
 *   POST /rooms         allocate a fresh room code -> { roomId }
 *   GET  /rooms/:code   room summary (exists, phase, player count, joinable)
 */
export function createHttpHandler(deps: HttpDeps): RequestListener {
  const startedAt = deps.startedAt ?? Date.now();
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

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
