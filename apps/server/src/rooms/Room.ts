import { randomBytes } from 'node:crypto';
import {
  type CharacterId,
  CloseCode,
  DEFAULT_GAME_MODE,
  GameWorld,
  MODE_CONFIG,
  MAX_PLAYERS,
  NET_CONFIG,
  NEUTRAL_INPUT,
  PROTOCOL_VERSION,
  SNAPSHOT_EVERY_TICKS,
  characterInfo,
  defaultCharacterForSlot,
  diffWorld,
  isDeltaEmpty,
  modeWorldOptions,
  msToTicks,
  pickFreeCharacter,
  racePoints,
  sanitizePlayerName,
  ticksToMs,
  type ClientMessage,
  type DevCommand,
  type ErrorCode,
  type GameEvent,
  type GameMode,
  type LevelManifest,
  type LevelResult,
  type NetConfig,
  type NetWorldState,
  type RoomInfo,
  type RoomPhase,
  type ServerMessage,
} from '@platformer/shared';
import type { LevelSource, ServerLevel } from '../levels/LevelRepository';
import type { Logger } from '../log';
import type { PlayerConnection } from '../net/connection';
import { InputQueue } from './InputQueue';

export interface RoomOptions {
  id: string;
  levels: LevelSource;
  manifest: LevelManifest;
  devCommands: boolean;
  log: Logger;
  net?: Readonly<NetConfig>;
  /** Override for deterministic ids in tests. */
  createPlayerId?: () => string;
}

interface RoomPlayer {
  readonly id: string;
  /** Secret per-tab id used to re-attach after refresh / reconnect. Never broadcast. */
  readonly clientId: string;
  readonly slot: number;
  readonly inputs: InputQueue;
  name: string;
  ready: boolean;
  menuOpen: boolean;
  campaignScore: number;
  characterId: CharacterId;
  connection: PlayerConnection | null;
  /** Ticks left before a disconnected player loses their slot. */
  graceTicks: number;
}

export interface JoinRequest {
  name: string;
  clientId: string;
  /** Preferred character; the next free one is used if someone else has it. */
  characterId?: CharacterId;
}

export type JoinResult =
  | { ok: true; playerId: string; slot: number; rejoined: boolean }
  | { ok: false; code: ErrorCode; message: string };

export interface RoomSummary {
  roomId: string;
  phase: RoomPhase;
  players: number;
  connected: number;
  maxPlayers: number;
  joinable: boolean;
  level: string | null;
}

/**
 * One game room: 1-4 players, lobby flow and the authoritative simulation of the current level.
 *
 *   lobby --(all connected players ready)--> countdown --> playing --(exit rule / race)--> levelComplete
 *   levelComplete --> countdown (next level)  |  lobby + campaignComplete (last level)
 *
 * Everything is driven by `tick()` at the fixed simulation rate; all timers count ticks, so
 * tests can step a room deterministically. The room only talks to `PlayerConnection`s and never
 * touches sockets directly.
 */
export class Room {
  readonly id: string;

  private readonly levels: LevelSource;
  private readonly manifest: LevelManifest;
  private readonly devCommands: boolean;
  private readonly log: Logger;
  private readonly net: Readonly<NetConfig>;
  private readonly createPlayerId: () => string;

  private readonly players = new Map<string, RoomPlayer>();
  private readonly byClientId = new Map<string, RoomPlayer>();

  private phase: RoomPhase = 'lobby';
  private phaseTicks = 0;
  private hostId: string | null = null;
  private selectedLevelId: string;
  /** Game mode the host picked; applies to every level of the campaign. */
  private mode: GameMode = DEFAULT_GAME_MODE;
  private level: ServerLevel | null = null;
  private world: GameWorld | null = null;
  private run = 0;
  private countdownFromLobby = false;
  private results: LevelResult[] | null = null;
  private nextLevelId: string | null = null;
  private campaignComplete = false;

  private lastBroadcast: NetWorldState | null = null;
  private snapshotsSent = 0;
  private snapshotTimer = 0;
  private broadcastNow = false;
  private pendingEvents: GameEvent[] = [];
  private roomDirty = false;
  private emptyTicks = 0;
  private closed = false;

  constructor(options: RoomOptions) {
    this.id = options.id;
    this.levels = options.levels;
    this.manifest = options.manifest;
    this.devCommands = options.devCommands;
    this.log = options.log;
    this.net = options.net ?? NET_CONFIG;
    this.createPlayerId = options.createPlayerId ?? (() => `p${randomBytes(4).toString('hex')}`);
    this.selectedLevelId = this.manifest.firstLevelId;
  }

  // --- queries -------------------------------------------------------------------------------

  get playerCount(): number {
    return this.players.size;
  }

  get connectedCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.connection) n++;
    return n;
  }

  get currentPhase(): RoomPhase {
    return this.phase;
  }

  /** Read-only access for tests and diagnostics. */
  get gameWorld(): GameWorld | null {
    return this.world;
  }

  /** True once the room has been empty for `emptyRoomTtlMs`. */
  get expired(): boolean {
    return this.closed || this.emptyTicks >= msToTicks(this.net.room.emptyRoomTtlMs);
  }

  info(): RoomInfo {
    return {
      roomId: this.id,
      phase: this.phase,
      hostId: this.hostId,
      maxPlayers: MAX_PLAYERS,
      mode: this.mode,
      players: this.playersBySlot().map((p) => ({
        id: p.id,
        name: p.name,
        slot: p.slot,
        ready: p.ready,
        connected: p.connection !== null,
        isHost: p.id === this.hostId,
        menuOpen: p.menuOpen,
        campaignScore: p.campaignScore,
        characterId: p.characterId,
      })),
      selectedLevelId: this.selectedLevelId,
      level: this.level
        ? { id: this.level.entry.id, name: this.level.entry.name, checksum: this.level.checksum, run: this.run }
        : null,
      paused: this.isPaused(),
      countdownMs:
        this.phase === 'countdown' || this.phase === 'levelComplete' ? Math.round(ticksToMs(this.phaseTicks)) : 0,
      raceEndsInMs: this.raceEndsInMs(),
      results: this.results,
      nextLevelId: this.nextLevelId,
      campaignComplete: this.campaignComplete,
      devCommands: this.devCommands,
    };
  }

  private raceEndsInMs(): number | null {
    const ticks = this.phase === 'playing' ? this.world?.raceEndsInTicks : null;
    return ticks === null || ticks === undefined ? null : Math.round(ticksToMs(ticks));
  }

  summary(): RoomSummary {
    return {
      roomId: this.id,
      phase: this.phase,
      players: this.players.size,
      connected: this.connectedCount,
      maxPlayers: MAX_PLAYERS,
      joinable: !this.closed && this.players.size < MAX_PLAYERS && (this.phase === 'lobby' || this.net.room.allowDropIn),
      level: this.level?.entry.id ?? null,
    };
  }

  // --- connection lifecycle ------------------------------------------------------------------

  join(connection: PlayerConnection, request: JoinRequest): JoinResult {
    if (this.closed) return { ok: false, code: 'ROOM_NOT_FOUND', message: `Room ${this.id} is closed` };
    const name = sanitizePlayerName(request.name);

    const known = this.byClientId.get(request.clientId);
    if (known) {
      known.name = name;
      this.attach(known, connection, true);
      this.log.info(`${describe(known)} re-attached (${connection.id})`);
      return { ok: true, playerId: known.id, slot: known.slot, rejoined: true };
    }

    if (this.players.size >= MAX_PLAYERS) {
      return { ok: false, code: 'ROOM_FULL', message: `Room ${this.id} is full (${MAX_PLAYERS} players).` };
    }
    if (this.phase !== 'lobby' && !this.net.room.allowDropIn) {
      return { ok: false, code: 'ROOM_IN_PROGRESS', message: `Room ${this.id} is already playing.` };
    }

    const slot = this.lowestFreeSlot();
    const taken = [...this.players.values()].map((p) => p.characterId);
    const player: RoomPlayer = {
      id: this.uniquePlayerId(),
      clientId: request.clientId,
      slot,
      inputs: new InputQueue(this.net.input),
      name,
      ready: false,
      menuOpen: false,
      campaignScore: 0,
      characterId: pickFreeCharacter(request.characterId ?? defaultCharacterForSlot(slot), taken),
      connection: null,
      graceTicks: 0,
    };
    this.players.set(player.id, player);
    this.byClientId.set(player.clientId, player);
    this.hostId ??= player.id;
    this.attach(player, connection, false);
    this.log.info(`${describe(player)} joined (${connection.id}, ${this.players.size}/${MAX_PLAYERS})`);
    return { ok: true, playerId: player.id, slot: player.slot, rejoined: false };
  }

  /** Socket closed. Keeps the slot for `reconnectGraceMs` unless the connection was replaced. */
  disconnect(playerId: string, connection: PlayerConnection): void {
    const player = this.players.get(playerId);
    if (!player || player.connection !== connection) return;
    player.connection = null;
    player.menuOpen = false;
    player.graceTicks = Math.max(1, msToTicks(this.net.room.reconnectGraceMs));
    this.world?.setPresent(player.id, false);
    this.log.info(`${describe(player)} disconnected; holding slot for ${this.net.room.reconnectGraceMs} ms`);
    this.markRoomDirty();
    this.flushRoom();
  }

  handle(playerId: string, message: ClientMessage): void {
    const player = this.players.get(playerId);
    if (!player?.connection || this.closed) return;
    switch (message.t) {
      case 'input':
        // Inputs only count while playing; the queue also caps how many can pile up while paused.
        if (this.phase === 'playing' && this.world) player.inputs.push(message.seq, message.buttons);
        return;
      case 'ping':
        player.connection.send({ t: 'pong', id: message.id, at: message.at, serverTick: this.world?.tick ?? 0 });
        return;
      case 'resync':
        this.sendKeyframe(player.connection);
        return;
      case 'ready':
        this.setReady(player, message.ready);
        break;
      case 'selectLevel':
        this.selectLevel(player, message.levelId);
        break;
      case 'selectMode':
        this.selectMode(player, message.mode);
        break;
      case 'selectCharacter':
        this.selectCharacter(player, message.characterId);
        break;
      case 'menu':
        if (player.menuOpen !== message.open) {
          player.menuOpen = message.open;
          this.markRoomDirty();
        }
        break;
      case 'leave':
        this.log.info(`${describe(player)} left`);
        this.removePlayer(player.id);
        break;
      case 'dev':
        this.runDevCommand(player, message.cmd);
        break;
      case 'join':
        break; // Handled by the gateway before a player exists.
    }
    this.flushRoom();
  }

  /** Disconnects everyone (server shutdown). */
  close(code: ErrorCode, message: string, closeCode: number = CloseCode.SHUTDOWN): void {
    if (this.closed) return;
    this.closed = true;
    for (const player of this.players.values()) {
      player.connection?.send({ t: 'error', code, message });
      player.connection?.close(closeCode, message);
      player.connection = null;
    }
  }

  // --- fixed tick ----------------------------------------------------------------------------

  tick(): void {
    if (this.closed) return;
    this.expireDisconnected();
    this.emptyTicks = this.players.size === 0 ? this.emptyTicks + 1 : 0;

    switch (this.phase) {
      case 'lobby':
        if (this.canStart()) this.startCampaign();
        break;
      case 'countdown':
        this.updateCountdown();
        break;
      case 'playing':
        this.updatePlaying();
        break;
      case 'levelComplete':
        this.updateLevelComplete();
        break;
    }

    this.flushRoom();
    this.pumpSnapshots();
  }

  // --- phases --------------------------------------------------------------------------------

  private canStart(): boolean {
    const connected = this.playersBySlot().filter((p) => p.connection);
    return (
      connected.length >= Math.max(1, this.net.room.minPlayersToStart) &&
      connected.every((p) => p.ready) &&
      this.levels.get(this.selectedLevelId) !== undefined
    );
  }

  private startCampaign(): void {
    this.campaignComplete = false;
    this.results = null;
    for (const player of this.players.values()) player.campaignScore = 0;
    this.startLevel(this.selectedLevelId, true);
  }

  private startLevel(levelId: string, fromLobby: boolean): void {
    const level = this.levels.get(levelId);
    if (!level) {
      this.log.error(`cannot start unknown/unloaded level "${levelId}"`);
      this.returnToLobby(false);
      return;
    }
    this.run += 1;
    this.level = level;
    this.world = new GameWorld({ level: level.data, movement: level.movement, ...modeWorldOptions(this.mode) });
    for (const player of this.playersBySlot()) {
      this.world.addPlayer(player.id, player.slot, player.characterId);
      this.world.setPresent(player.id, player.connection !== null);
      player.inputs.reset();
      player.menuOpen = false;
    }
    this.lastBroadcast = null;
    this.snapshotsSent = 0;
    this.snapshotTimer = 0;
    this.pendingEvents = [];
    this.broadcastNow = true;
    this.countdownFromLobby = fromLobby;
    this.results = null;
    this.nextLevelId = null;
    this.setPhase('countdown', Math.max(1, msToTicks(this.net.room.countdownMs)));
    this.log.info(`starting "${level.entry.id}" (run ${this.run}, ${this.mode}) with ${this.players.size} player(s)`);
  }

  private updateCountdown(): void {
    // A lobby countdown only runs while its start condition holds (someone un-readied or joined).
    if (this.countdownFromLobby && !this.canStart()) {
      this.log.info('countdown cancelled');
      this.returnToLobby(false);
      return;
    }
    this.phaseTicks -= 1;
    if (this.phaseTicks <= 0) this.setPhase('playing', 0);
  }

  private updatePlaying(): void {
    const world = this.world;
    if (!world) return;
    if (!this.isPaused() && this.connectedCount > 0) {
      for (const player of this.playersBySlot()) {
        if (!world.getPlayer(player.id)) continue;
        if (player.connection) {
          player.inputs.drain((buttons) => world.stepPlayer(player.id, buttons));
        } else {
          // Absent (reconnecting) players are stepped idle so they don't hang in mid-air.
          world.stepPlayer(player.id, NEUTRAL_INPUT);
        }
      }
      world.endTick();
    }
    const events = world.drainEvents();
    // A finish starts (or shortens) the race clock: clients read it from the room info.
    if (events.some((e) => e.type === 'finish')) this.markRoomDirty();
    this.pendingEvents.push(...events);
    if (world.completed) this.finishLevel(world);
  }

  private finishLevel(world: GameWorld): void {
    const results: LevelResult[] = world.listPlayers().map((wp) => {
      const player = this.players.get(wp.id);
      const place = wp.place > 0 ? wp.place : null;
      const placePoints = racePoints(place, this.mode);
      if (player) player.campaignScore += wp.score + placePoints;
      return {
        playerId: wp.id,
        name: player?.name ?? 'Player',
        slot: wp.slot,
        score: wp.score,
        collected: wp.collected,
        deaths: wp.deaths,
        place,
        timeMs: place === null ? null : Math.round(ticksToMs(wp.finishTick)),
        placePoints,
      };
    });
    this.results = results;
    this.nextLevelId = this.level?.entry.next ?? null;
    this.broadcastNow = true; // final positions + the levelComplete event
    this.setPhase('levelComplete', Math.max(1, msToTicks(this.net.room.levelCompleteMs)));
    this.log.info(`level "${this.level?.entry.id}" complete; next: ${this.nextLevelId ?? '(campaign done)'}`);
  }

  private updateLevelComplete(): void {
    this.phaseTicks -= 1;
    if (this.phaseTicks > 0) return;
    if (this.nextLevelId) this.startLevel(this.nextLevelId, false);
    else this.returnToLobby(true);
  }

  private returnToLobby(campaignComplete: boolean): void {
    this.world = null;
    this.level = null;
    this.lastBroadcast = null;
    this.pendingEvents = [];
    this.nextLevelId = null;
    this.campaignComplete = campaignComplete;
    if (!campaignComplete) this.results = null;
    for (const player of this.players.values()) {
      player.menuOpen = false;
      if (campaignComplete) player.ready = false;
    }
    this.setPhase('lobby', 0);
  }

  private setPhase(phase: RoomPhase, ticks: number): void {
    this.phase = phase;
    this.phaseTicks = ticks;
    this.markRoomDirty();
  }

  /** Pause rule: playing, someone connected, and every connected player has the menu open. */
  private isPaused(): boolean {
    if (this.phase !== 'playing') return false;
    let connected = 0;
    for (const p of this.players.values()) {
      if (!p.connection) continue;
      connected++;
      if (!p.menuOpen) return false;
    }
    return connected > 0;
  }

  // --- lobby actions -------------------------------------------------------------------------

  private setReady(player: RoomPlayer, ready: boolean): void {
    const lobbyCountdown = this.phase === 'countdown' && this.countdownFromLobby;
    if (this.phase !== 'lobby' && !lobbyCountdown) return;
    if (player.ready === ready) return;
    player.ready = ready;
    this.markRoomDirty();
  }

  private selectLevel(player: RoomPlayer, levelId: string): void {
    if (player.id !== this.hostId) return this.reject(player, 'NOT_ALLOWED', 'Only the host can choose the level.');
    if (this.phase !== 'lobby') return this.reject(player, 'NOT_ALLOWED', 'The level can only be changed in the lobby.');
    if (!this.manifest.has(levelId) || !this.levels.get(levelId)) {
      return this.reject(player, 'BAD_REQUEST', `Unknown level "${levelId}".`);
    }
    if (this.selectedLevelId === levelId) return;
    this.selectedLevelId = levelId;
    this.markRoomDirty();
  }

  private selectMode(player: RoomPlayer, mode: GameMode): void {
    if (player.id !== this.hostId) return this.reject(player, 'NOT_ALLOWED', 'Only the host can choose the mode.');
    if (this.phase !== 'lobby') return this.reject(player, 'NOT_ALLOWED', 'The mode can only be changed in the lobby.');
    if (this.mode === mode) return;
    this.mode = mode;
    this.log.info(`mode set to ${MODE_CONFIG[mode].name} by ${describe(player)}`);
    this.markRoomDirty();
  }

  private selectCharacter(player: RoomPlayer, characterId: CharacterId): void {
    if (this.phase !== 'lobby') {
      return this.reject(player, 'NOT_ALLOWED', 'Characters can only be changed in the lobby.');
    }
    if (player.characterId === characterId) return;
    const owner = [...this.players.values()].find((p) => p !== player && p.characterId === characterId);
    if (owner) {
      const label = `P${owner.slot + 1}`;
      return this.reject(player, 'NOT_ALLOWED', `${characterInfo(characterId).name} is taken by ${label}.`);
    }
    player.characterId = characterId;
    this.markRoomDirty();
  }

  private runDevCommand(player: RoomPlayer, cmd: DevCommand): void {
    if (!this.devCommands) return this.reject(player, 'NOT_ALLOWED', 'Dev commands are disabled on this server.');
    this.log.info(`dev command "${cmd}" from ${describe(player)}`);
    switch (cmd) {
      case 'skipLevel':
        if (this.phase === 'playing') this.world?.complete();
        else if (this.phase === 'countdown' || this.phase === 'levelComplete') this.phaseTicks = 1;
        break;
      case 'respawn':
        if (this.phase === 'playing') this.world?.killPlayer(player.id, 'dev');
        break;
    }
  }

  private reject(player: RoomPlayer, code: ErrorCode, message: string): void {
    player.connection?.send({ t: 'error', code, message });
  }

  // --- players -------------------------------------------------------------------------------

  private attach(player: RoomPlayer, connection: PlayerConnection, rejoined: boolean): void {
    const previous = player.connection;
    if (previous && previous !== connection) {
      previous.send({ t: 'error', code: 'REPLACED', message: 'This player joined from another tab or connection.' });
      previous.close(CloseCode.REPLACED, 'replaced');
    }
    player.connection = connection;
    player.graceTicks = 0;
    player.menuOpen = false;
    player.inputs.reset();
    if (this.world) {
      // Drop-in (new player mid-level) or return from a disconnect.
      this.world.addPlayer(player.id, player.slot, player.characterId);
      this.world.setPresent(player.id, true);
    }
    connection.send({
      t: 'welcome',
      protocol: PROTOCOL_VERSION,
      roomId: this.id,
      playerId: player.id,
      slot: player.slot,
      rejoined,
      tickRate: this.net.tickRate,
      snapshotRate: this.net.snapshotRate,
    });
    this.markRoomDirty();
    this.flushRoom();
    this.sendKeyframe(connection);
  }

  private removePlayer(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    this.players.delete(id);
    this.byClientId.delete(player.clientId);
    this.world?.removePlayer(id);
    if (this.hostId === id) {
      const next = this.playersBySlot();
      this.hostId = (next.find((p) => p.connection) ?? next[0])?.id ?? null;
    }
    this.markRoomDirty();
  }

  private expireDisconnected(): void {
    for (const player of [...this.players.values()]) {
      if (player.connection) continue;
      player.graceTicks -= 1;
      if (player.graceTicks <= 0) {
        this.log.info(`${describe(player)} did not reconnect; slot released`);
        this.removePlayer(player.id);
      }
    }
  }

  private playersBySlot(): RoomPlayer[] {
    return [...this.players.values()].sort((a, b) => a.slot - b.slot);
  }

  private lowestFreeSlot(): number {
    const used = new Set([...this.players.values()].map((p) => p.slot));
    for (let slot = 0; slot < MAX_PLAYERS; slot++) if (!used.has(slot)) return slot;
    throw new Error('no free slot'); // guarded by the MAX_PLAYERS check in join()
  }

  private uniquePlayerId(): string {
    for (;;) {
      const id = this.createPlayerId();
      if (!this.players.has(id)) return id;
    }
  }

  // --- broadcasting --------------------------------------------------------------------------

  private markRoomDirty(): void {
    this.roomDirty = true;
  }

  private flushRoom(): void {
    if (!this.roomDirty) return;
    this.roomDirty = false;
    this.broadcast({ t: 'room', room: this.info() });
  }

  private pumpSnapshots(): void {
    if (!this.world) return;
    this.snapshotTimer += 1;
    if (!this.broadcastNow && this.snapshotTimer < SNAPSHOT_EVERY_TICKS) return;
    this.snapshotTimer = 0;
    this.broadcastNow = false;
    this.broadcastWorld(this.world);
  }

  /**
   * Full keyframe every `keyframeEverySnapshots`, field-level deltas in between. Every connected
   * client holds `lastBroadcast` (late joiners get it via `sendKeyframe`), so one delta fits all.
   */
  private broadcastWorld(world: GameWorld): void {
    const state = world.toNetState((id) => this.players.get(id)?.inputs.lastProcessedSeq ?? 0);
    const events = this.pendingEvents;
    const base = this.lastBroadcast;
    let message: ServerMessage;
    if (base === null || this.snapshotsSent % this.net.keyframeEverySnapshots === 0) {
      message = { t: 'snapshot', run: this.run, tick: state.tick, state, events };
    } else {
      const delta = diffWorld(base, state);
      // Frozen world (countdown, results, pause) and nothing changed: skip the broadcast.
      if (isDeltaEmpty(delta) && events.length === 0 && state.tick === base.tick) return;
      message = { t: 'delta', run: this.run, tick: state.tick, baseTick: base.tick, ...delta, events };
    }
    this.pendingEvents = [];
    this.lastBroadcast = state;
    this.snapshotsSent += 1;
    this.broadcast(message);
  }

  /** Brings one client up to the shared delta base. */
  private sendKeyframe(connection: PlayerConnection): void {
    if (!this.world || !this.lastBroadcast) return; // the next broadcast is a keyframe anyway
    connection.send({ t: 'snapshot', run: this.run, tick: this.lastBroadcast.tick, state: this.lastBroadcast, events: [] });
  }

  private broadcast(message: ServerMessage): void {
    for (const player of this.players.values()) player.connection?.send(message);
  }
}

function describe(player: RoomPlayer): string {
  return `P${player.slot + 1} "${player.name}" (${player.id})`;
}
