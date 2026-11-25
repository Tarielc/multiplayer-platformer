import {
  MOVEMENT_TUNING,
  defineLevels,
  levelChecksum,
  resolveMovement,
  type LevelManifest,
  type LevelManifestEntry,
  type ServerMessage,
  type ServerMessageOf,
} from '@platformer/shared';
import { asciiToLevel } from '@platformer/shared/dev';
import type { LevelSource, ServerLevel } from '../levels/LevelRepository';
import type { PlayerConnection } from '../net/connection';

let nextId = 0;

/** In-memory `PlayerConnection` that records everything a room sends to it. */
export class FakeConnection implements PlayerConnection {
  readonly id = `fake-${++nextId}`;
  readonly remoteAddress = '127.0.0.1';
  isOpen = true;
  readonly sent: ServerMessage[] = [];
  closed: { code: number; reason: string } | null = null;

  send(message: ServerMessage): void {
    // Copy like a real transport would, so tests never share objects with the room.
    this.sent.push(JSON.parse(JSON.stringify(message)) as ServerMessage);
  }

  close(code: number, reason: string): void {
    this.isOpen = false;
    this.closed = { code, reason };
  }

  all<T extends ServerMessage['t']>(type: T): ServerMessageOf<T>[] {
    return this.sent.filter((m): m is ServerMessageOf<T> => m.t === type);
  }

  last<T extends ServerMessage['t']>(type: T): ServerMessageOf<T> | undefined {
    return this.all(type).at(-1);
  }
}

/**
 * Two two-level test campaigns (co-op: first, second; race: sprint, dash). Spawns 1-4 stand at columns 1-4, a coin floats at column 6 and the
 * exit is at column 8, so a player holding RIGHT collects the coin and finishes in about a second.
 */
export const TEST_ROWS = ['           ', ' 1234 o E  ', '###########'];

export const TEST_MANIFEST: LevelManifest = defineLevels([
  { id: 'first', name: 'First', mode: 'coop', map: 'maps/first.json', next: 'second' },
  { id: 'second', name: 'Second', mode: 'coop', map: 'maps/second.json', next: null },
  { id: 'sprint', name: 'Sprint', mode: 'race', map: 'maps/sprint.json', next: 'dash' },
  { id: 'dash', name: 'Dash', mode: 'race', map: 'maps/dash.json', next: null },
]);

export function testLevel(entry: LevelManifestEntry, rows: string[] = TEST_ROWS): ServerLevel {
  const data = asciiToLevel({ rows }, { id: entry.id, name: entry.name });
  return { entry, data, checksum: levelChecksum(data), movement: resolveMovement(MOVEMENT_TUNING, entry.tuning), issues: [] };
}

export const TEST_LEVELS: LevelSource = new Map(TEST_MANIFEST.entries.map((entry) => [entry.id, testLevel(entry)]));
