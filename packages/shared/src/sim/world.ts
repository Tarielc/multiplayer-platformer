import { ENTITY_CONFIG, type EntityConfig } from '../config/entities';
import type { CompiledMovement } from '../config/movement';
import { msToTicks, TICK_DT } from '../config/net';
import { PLAYER_CONFIG, type PlayerConfig } from '../config/players';
import { CellFlag, type LevelData, type LevelZone } from '../level/types';
import type { NetPlayerState, NetWorldState } from '../protocol/state';
import { circleOverlapsRect, rectsOverlap, type Rect, type Vec2 } from '../util/math';
import { cellAt } from './collision';
import type { DeathCause, GameEvent } from './events';
import { createBody, resetBody, stepPlayerMovement, type MovementBody, type MovementContext } from './movement';

export interface WorldPlayer {
  readonly id: string;
  readonly slot: number;
  readonly body: MovementBody;
  score: number;
  deaths: number;
  collected: number;
  /** > 0 while dead. */
  respawnTicks: number;
  /** Feet position used on the next respawn. */
  respawnPoint: Vec2;
  checkpointId: number | null;
  atExit: boolean;
  tp: number;
  /**
   * False while the player's client is disconnected (within the reconnect grace period).
   * Absent players stay in the world but don't count towards the exit rule.
   */
  present: boolean;
}

export interface GameWorldOptions {
  level: LevelData;
  movement: CompiledMovement;
  players?: Readonly<PlayerConfig>;
  entities?: Readonly<EntityConfig>;
  /** Fixed step in seconds (defaults to 1 / tickRate). */
  dt?: number;
}

/**
 * Authoritative gameplay rules for one level run: movement, hazards, collectibles,
 * checkpoints, exits and respawns. Environment-agnostic (no timers, no I/O), so it runs on
 * the server and could run in the browser for an offline mode.
 *
 * Per tick the host calls `stepPlayer` for each consumed input, then `endTick` once.
 */
export class GameWorld {
  readonly level: LevelData;
  tick = 0;
  completed = false;

  private readonly ctx: MovementContext;
  private readonly playerConfig: Readonly<PlayerConfig>;
  private readonly entityConfig: Readonly<EntityConfig>;
  private readonly respawnDelayTicks: number;
  private readonly players = new Map<string, WorldPlayer>();
  private readonly collected = new Set<number>();
  private teamCheckpoint: LevelZone | null = null;
  private events: GameEvent[] = [];

  constructor(options: GameWorldOptions) {
    this.level = options.level;
    this.playerConfig = options.players ?? PLAYER_CONFIG;
    this.entityConfig = options.entities ?? ENTITY_CONFIG;
    this.ctx = {
      level: options.level,
      movement: options.movement,
      hitbox: this.playerConfig.hitbox,
      dt: options.dt ?? TICK_DT,
    };
    this.respawnDelayTicks = Math.max(1, msToTicks(this.playerConfig.respawnDelayMs));
  }

  get movementContext(): Readonly<MovementContext> {
    return this.ctx;
  }

  get playerCount(): number {
    return this.players.size;
  }

  getPlayer(id: string): WorldPlayer | undefined {
    return this.players.get(id);
  }

  listPlayers(): WorldPlayer[] {
    return [...this.players.values()].sort((a, b) => a.slot - b.slot);
  }

  isCollected(entityId: number): boolean {
    return this.collected.has(entityId);
  }

  addPlayer(id: string, slot: number): WorldPlayer {
    const existing = this.players.get(id);
    if (existing) return existing;
    const respawnPoint = this.teamCheckpoint
      ? this.checkpointSpawn(this.teamCheckpoint, slot)
      : this.levelSpawn(slot);
    const player: WorldPlayer = {
      id,
      slot,
      body: createBody(respawnPoint.x, respawnPoint.y, this.ctx.hitbox),
      score: 0,
      deaths: 0,
      collected: 0,
      respawnTicks: 0,
      respawnPoint,
      checkpointId: this.teamCheckpoint?.id ?? null,
      atExit: false,
      tp: 0,
      present: true,
    };
    this.players.set(id, player);
    return player;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  setPresent(id: string, present: boolean): void {
    const player = this.players.get(id);
    if (player) player.present = present;
  }

  /** Applies one input frame to one player: movement first, then interactions. */
  stepPlayer(id: string, buttons: number): void {
    const player = this.players.get(id);
    if (!player) return;
    stepPlayerMovement(player.body, buttons, this.ctx);
    if (player.body.alive) this.resolveInteractions(player);
  }

  /** World-level rules that run once per tick regardless of input (respawns, exit rule). */
  endTick(): void {
    for (const player of this.players.values()) {
      if (player.body.alive) continue;
      player.respawnTicks -= 1;
      if (player.respawnTicks <= 0) this.respawn(player);
    }
    if (!this.completed && this.level.exits.length > 0) {
      const list = [...this.players.values()].filter((p) => p.present);
      const arrived = (p: WorldPlayer) => p.body.alive && p.atExit;
      const done = this.entityConfig.exitRule === 'all' ? list.every(arrived) : list.some(arrived);
      if (list.length > 0 && done) this.complete();
    }
    this.tick += 1;
  }

  /** Dev/debug helpers. */
  complete(): void {
    if (this.completed) return;
    this.completed = true;
    this.events.push({ type: 'levelComplete' });
  }

  killPlayer(id: string, cause: DeathCause = 'dev'): void {
    const player = this.players.get(id);
    if (player) this.kill(player, cause);
  }

  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  toNetState(ackFor: (playerId: string) => number): NetWorldState {
    return {
      tick: this.tick,
      players: this.listPlayers().map((p) => toNetPlayer(p, ackFor(p.id))),
      collected: [...this.collected].sort((a, b) => a - b),
    };
  }

  // --- internals -----------------------------------------------------------------------

  private levelSpawn(slot: number): Vec2 {
    const spawns = this.level.spawns;
    const spawn = spawns.find((s) => s.slot === slot) ?? spawns[slot % Math.max(1, spawns.length)];
    if (spawn) return { x: spawn.x, y: spawn.y };
    const ts = this.level.tileSize;
    return { x: ts * 2, y: ts * 2 };
  }

  private checkpointSpawn(zone: LevelZone, slot: number): Vec2 {
    // Slight per-slot spread so respawned players don't stack perfectly.
    return { x: zone.x + zone.width / 2 + (slot - 1.5) * 6, y: zone.y + zone.height };
  }

  private resolveInteractions(player: WorldPlayer): void {
    const body = player.body;
    const box: Rect = { x: body.x, y: body.y, width: this.ctx.hitbox.width, height: this.ctx.hitbox.height };

    if (body.y > this.level.heightPx + this.entityConfig.killPlaneMargin) {
      this.kill(player, 'fall');
      return;
    }
    if (this.touchesHazardTile(box) || this.level.hazards.some((zone) => rectsOverlap(box, zone))) {
      this.kill(player, 'hazard');
      return;
    }
    for (const item of this.level.collectibles) {
      if (this.collected.has(item.id) || !circleOverlapsRect(item.x, item.y, item.radius, box)) continue;
      this.collected.add(item.id);
      player.score += item.value;
      player.collected += 1;
      this.events.push({ type: 'collect', playerId: player.id, entityId: item.id, kind: item.kind, value: item.value });
    }
    for (const zone of this.level.checkpoints) {
      if (rectsOverlap(box, zone)) this.activateCheckpoint(player, zone);
    }
    player.atExit = this.level.exits.some((zone) => rectsOverlap(box, zone));
  }

  private touchesHazardTile(box: Rect): boolean {
    const { level } = this;
    const ts = level.tileSize;
    const inset = this.entityConfig.hazardTileHitbox;
    const c0 = Math.max(0, Math.floor(box.x / ts));
    const c1 = Math.min(level.widthTiles - 1, Math.floor((box.x + box.width - 1e-6) / ts));
    const r0 = Math.max(0, Math.floor(box.y / ts));
    const r1 = Math.min(level.heightTiles - 1, Math.floor((box.y + box.height - 1e-6) / ts));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        if ((cellAt(level, col, row) & CellFlag.HAZARD) === 0) continue;
        const hurt: Rect = {
          x: col * ts + inset.insetX,
          y: row * ts + inset.insetTop,
          width: ts - inset.insetX * 2,
          height: ts - inset.insetTop - inset.insetBottom,
        };
        if (rectsOverlap(box, hurt)) return true;
      }
    }
    return false;
  }

  private activateCheckpoint(player: WorldPlayer, zone: LevelZone): void {
    if (this.entityConfig.checkpointScope === 'team') {
      if (this.teamCheckpoint?.id === zone.id) return;
      this.teamCheckpoint = zone;
      for (const p of this.players.values()) {
        p.checkpointId = zone.id;
        p.respawnPoint = this.checkpointSpawn(zone, p.slot);
      }
    } else {
      if (player.checkpointId === zone.id) return;
      player.checkpointId = zone.id;
      player.respawnPoint = this.checkpointSpawn(zone, player.slot);
    }
    this.events.push({ type: 'checkpoint', playerId: player.id, checkpointId: zone.id });
  }

  private kill(player: WorldPlayer, cause: DeathCause): void {
    const body = player.body;
    if (!body.alive) return;
    body.alive = false;
    body.vx = 0;
    body.vy = 0;
    body.jumping = false;
    player.respawnTicks = this.respawnDelayTicks;
    player.deaths += 1;
    player.atExit = false;
    this.events.push({
      type: 'death',
      playerId: player.id,
      cause,
      x: body.x + this.ctx.hitbox.width / 2,
      y: body.y + this.ctx.hitbox.height / 2,
    });
  }

  private respawn(player: WorldPlayer): void {
    resetBody(player.body, player.respawnPoint.x, player.respawnPoint.y, this.ctx.hitbox);
    player.respawnTicks = 0;
    player.tp += 1;
    this.events.push({ type: 'respawn', playerId: player.id });
  }
}

function toNetPlayer(p: WorldPlayer, ack: number): NetPlayerState {
  const b = p.body;
  return {
    id: p.id,
    x: b.x,
    y: b.y,
    vx: b.vx,
    vy: b.vy,
    facing: b.facing,
    grounded: b.grounded,
    jumpHeld: b.jumpHeld,
    jumping: b.jumping,
    coyote: b.coyote,
    buffer: b.buffer,
    drop: b.drop,
    alive: b.alive,
    respawnIn: p.respawnTicks,
    score: p.score,
    deaths: p.deaths,
    atExit: p.atExit,
    checkpointId: p.checkpointId,
    tp: p.tp,
    ack,
  };
}
