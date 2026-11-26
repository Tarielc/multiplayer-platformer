import { randomInt } from 'node:crypto';
import {
  NET_CONFIG,
  ROOM_CODE_ALPHABET,
  isRoomCode,
  normalizeRoomCode,
  type ClientMessageOf,
  type ErrorCode,
  type LevelManifest,
  type NetConfig,
} from '@platformer/shared';
import type { RunRecorder } from '../leaderboard/RunRecorder';
import type { LevelSource } from '../levels/LevelRepository';
import type { Logger } from '../log';
import type { PlayerConnection } from '../net/connection';
import { Room } from './Room';

export interface RoomManagerOptions {
  levels: LevelSource;
  manifest: LevelManifest;
  devCommands: boolean;
  maxRooms: number;
  /**
   * Joining an unknown (well-formed) code creates the room. Keeps invite links working after a
   * server restart, which in development happens on every code change.
   */
  autoCreate: boolean;
  /** Where finished runs go (leaderboard); omitted = nothing is recorded. */
  recorder?: RunRecorder;
  log: Logger;
  net?: Readonly<NetConfig>;
}

export type RoomJoinOutcome =
  | { ok: true; room: Room; playerId: string; slot: number; rejoined: boolean }
  | { ok: false; code: ErrorCode; message: string };

export interface RoomStats {
  rooms: number;
  players: number;
  connected: number;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly net: Readonly<NetConfig>;

  constructor(private readonly options: RoomManagerOptions) {
    this.net = options.net ?? NET_CONFIG;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(normalizeRoomCode(code));
  }

  list(): Room[] {
    return [...this.rooms.values()];
  }

  /** Creates a room with a fresh random code (or the given one). `null` when at capacity. */
  create(code?: string): Room | null {
    if (code) {
      const existing = this.rooms.get(code);
      if (existing) return existing;
    }
    if (this.rooms.size >= this.options.maxRooms) {
      this.options.log.warn(`room limit reached (${this.options.maxRooms})`);
      return null;
    }
    const id = code ?? this.uniqueCode();
    const room = new Room({
      id,
      levels: this.options.levels,
      manifest: this.options.manifest,
      devCommands: this.options.devCommands,
      ...(this.options.recorder ? { recorder: this.options.recorder } : {}),
      log: this.options.log.child(id),
      net: this.net,
    });
    this.rooms.set(id, room);
    this.options.log.info(`room ${id} created (${this.rooms.size} active)`);
    return room;
  }

  join(connection: PlayerConnection, message: ClientMessageOf<'join'>): RoomJoinOutcome {
    const code = normalizeRoomCode(message.roomId);
    if (!isRoomCode(code)) return { ok: false, code: 'BAD_REQUEST', message: 'Invalid room code.' };
    let room = this.rooms.get(code);
    if (!room) {
      if (!this.options.autoCreate) return { ok: false, code: 'ROOM_NOT_FOUND', message: `Room ${code} does not exist.` };
      const created = this.create(code);
      if (!created) return { ok: false, code: 'SERVER_FULL', message: 'The server is at capacity. Try again later.' };
      room = created;
    }
    const result = room.join(connection, {
      name: message.name,
      clientId: message.clientId,
      characterId: message.characterId,
    });
    return result.ok ? { ...result, room } : result;
  }

  tick(): void {
    for (const [id, room] of this.rooms) {
      room.tick();
      if (room.expired) {
        this.rooms.delete(id);
        this.options.log.info(`room ${id} closed (empty)`);
      }
    }
  }

  stats(): RoomStats {
    let players = 0;
    let connected = 0;
    for (const room of this.rooms.values()) {
      players += room.playerCount;
      connected += room.connectedCount;
    }
    return { rooms: this.rooms.size, players, connected };
  }

  shutdown(): void {
    for (const room of this.rooms.values()) room.close('SERVER_SHUTDOWN', 'The server is restarting.');
    this.rooms.clear();
  }

  private uniqueCode(): string {
    const { codeLength } = this.net.room;
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < codeLength; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('could not allocate a room code');
  }
}
