import { ABILITIES, Ability, Held, abilityForCharacter, type AbilityId, type CompiledAbilities } from '../config/abilities';
import type { CharacterId } from '../config/characters';
import { resolveCombat, type CompiledCombat } from '../config/combat';
import { ENTITY_CONFIG, type EntityConfig } from '../config/entities';
import { FOE_TUNING, type FoeTuning } from '../config/foes';
import type { CompiledMovement } from '../config/movement';
import { msToTicks, TICK_DT } from '../config/net';
import { PLAYER_CONFIG, type PlayerConfig } from '../config/players';
import { TRAP_CONFIG, type CompiledTraps } from '../config/traps';
import { CellFlag, type LevelData, type LevelZone } from '../level/types';
import type { NetPlayerState, NetWorldState } from '../protocol/state';
import { circleOverlapsRect, rectsOverlap, type Rect, type Vec2 } from '../util/math';
import { cellAt } from './collision';
import type { DeathCause, GameEvent } from './events';
import { giantActive } from './abilities';
import { AbilitySystem, cloneAbilityPlayerState, newAbilityPlayerState, type AbilityHit, type AbilityPlayerState } from './abilitySystem';
import { attackReachBox, isAttackActive, stepPlayerBody } from './actions';
import { FoeField, type Foe } from './foes/FoeField';
import type { FoeStrike, FoeTarget } from './foes/types';
import { cloneBody, createBody, resetBody, type MovementBody, type MovementContext, type StepContacts } from './movement';
import { TrapField } from './traps/TrapField';
import type { Dir4, TrapHazard } from './traps/types';

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
  /** Server-only hit bookkeeping (not replicated): the swing `swingHits` belongs to. */
  swingSeq: number;
  /** Bitmask of slots already hit by the current swing (one hit per target per swing). */
  swingHits: number;
  /** Ticks left during which this player can't be hit (stun + immunity). Server-only. */
  hitImmuneTicks: number;
  /** Hearts left (`PlayerConfig.maxHp` when alive and unhurt, 0 while dead). */
  hp: number;
  /** Traps can't hurt this player before this tick (replicated, so clients can blink them). */
  invulnUntil: number;
  /** Server-only: boxes already hit by the current swing (`boxSwingSeq`), one hit per swing. */
  boxSwingSeq: number;
  swingBoxes: Set<number>;
  /** Server-only: foes already hit by the current swing (`foeSwingSeq`), one hit per swing. */
  foeSwingSeq: number;
  swingFoes: Set<number>;
  /** Server-only special ability bookkeeping (what it holds, flights, ...). */
  ability: AbilityPlayerState;
}

export interface GameWorldOptions {
  level: LevelData;
  movement: CompiledMovement;
  /** Attack/hurt tuning (defaults to `resolveCombat()`). */
  combat?: CompiledCombat;
  players?: Readonly<PlayerConfig>;
  entities?: Readonly<EntityConfig>;
  /** Trap physics and damage (defaults to `TRAP_CONFIG`; trap placement comes from the level). */
  traps?: Readonly<CompiledTraps>;
  /** Fixed step in seconds (defaults to 1 / tickRate). */
  dt?: number;
  /** Special ability tuning (defaults to `ABILITIES`). */
  abilities?: CompiledAbilities;
  /** Foe tuning (defaults to `FOE_TUNING`; where they are comes from the level). `null`: no foes. */
  foes?: Readonly<FoeTuning> | null;
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
  private traps: TrapField;
  private abilities: AbilitySystem;
  private foes: FoeField;
  private readonly foeInvulnerabilityTicks: number;

  constructor(private readonly options: GameWorldOptions) {
    this.level = options.level;
    this.playerConfig = options.players ?? PLAYER_CONFIG;
    this.entityConfig = options.entities ?? ENTITY_CONFIG;
    this.traps = TrapField.forLevel(options.level, options.traps ?? TRAP_CONFIG);
    this.ctx = {
      level: options.level,
      movement: options.movement,
      hitbox: this.playerConfig.hitbox,
      combat: options.combat ?? resolveCombat(),
      dt: options.dt ?? TICK_DT,
      traps: this.traps.traps.length > 0 ? this.traps : null,
      abilities: options.abilities ?? ABILITIES,
    };
    this.abilities = new AbilitySystem(this.abilityHost());
    this.respawnDelayTicks = Math.max(1, msToTicks(this.playerConfig.respawnDelayMs));
    const foes = options.foes ?? FOE_TUNING;
    this.foes = FoeField.forLevel(options.foes === null ? { ...options.level, foes: [] } : options.level, foes, this.ctx.dt);
    this.foeInvulnerabilityTicks = msToTicks(foes.hit.invulnerabilityMs);
  }

  get movementContext(): Readonly<MovementContext> {
    return this.ctx;
  }

  /** Live trap state (box hits, falling platforms). Read-only use outside the world. */
  get trapField(): TrapField {
    return this.traps;
  }

  /** Live foes and their shots. Read-only use outside the world. */
  get foeField(): FoeField {
    return this.foes;
  }

  /**
   * Independent deep copy (players, collectibles, traps, pending events). Used by the level
   * solver to branch, and by tests.
   */
  clone(): GameWorld {
    const copy = new GameWorld(this.options);
    copy.tick = this.tick;
    copy.completed = this.completed;
    copy.teamCheckpoint = this.teamCheckpoint;
    copy.events = [...this.events];
    for (const id of this.collected) copy.collected.add(id);
    for (const [id, p] of this.players) {
      copy.players.set(id, {
        ...p,
        body: cloneBody(p.body),
        respawnPoint: { ...p.respawnPoint },
        swingBoxes: new Set(p.swingBoxes),
        swingFoes: new Set(p.swingFoes),
        ability: cloneAbilityPlayerState(p.ability),
      });
    }
    copy.traps = this.traps.clone();
    copy.ctx.traps = copy.ctx.traps ? copy.traps : null;
    copy.abilities = this.abilities.cloneFor(copy.abilityHost());
    copy.foes = this.foes.clone();
    return copy;
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

  /**
   * Adds a player (no-op if the id exists). `character` decides the special ability; without
   * one the player has none.
   */
  addPlayer(id: string, slot: number, character?: CharacterId): WorldPlayer {
    const existing = this.players.get(id);
    if (existing) return existing;
    const respawnPoint = this.teamCheckpoint
      ? this.checkpointSpawn(this.teamCheckpoint, slot)
      : this.levelSpawn(slot);
    const player: WorldPlayer = {
      id,
      slot,
      body: createBody(respawnPoint.x, respawnPoint.y, this.ctx.hitbox, this.tick - 1, this.ctx.movement.airJumps),
      score: 0,
      deaths: 0,
      collected: 0,
      respawnTicks: 0,
      respawnPoint,
      checkpointId: this.teamCheckpoint?.id ?? null,
      atExit: false,
      tp: 0,
      present: true,
      swingSeq: 0,
      swingHits: 0,
      hitImmuneTicks: 0,
      hp: this.playerConfig.maxHp,
      invulnUntil: 0,
      boxSwingSeq: 0,
      swingBoxes: new Set(),
      foeSwingSeq: 0,
      swingFoes: new Set(),
      ability: newAbilityPlayerState(),
    };
    player.body.ability = character ? abilityForCharacter(character) : Ability.NONE;
    this.players.set(id, player);
    return player;
  }

  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (player) this.abilities.onRemove(player);
    this.players.delete(id);
  }

  /** Sets a player's special ability directly (tests, dev tools). */
  setAbility(id: string, ability: AbilityId): void {
    const player = this.players.get(id);
    if (player) player.body.ability = ability;
  }

  /** Hearts when full: the base, plus the giant bonus while it lasts. */
  maxHp(player: WorldPlayer): number {
    return this.playerConfig.maxHp + (giantActive(player.body) ? this.abilityTuning.giant.bonusHp : 0);
  }

  private get abilityTuning(): CompiledAbilities {
    return this.ctx.abilities ?? ABILITIES;
  }

  setPresent(id: string, present: boolean): void {
    const player = this.players.get(id);
    if (player) player.present = present;
  }

  /** Applies one input frame to one player: actions + movement first, then interactions. */
  stepPlayer(id: string, buttons: number): void {
    const player = this.players.get(id);
    if (!player) return;
    const contacts = stepPlayerBody(player.body, buttons, this.ctx, this.tick);
    if (player.body.alive) this.resolveInteractions(player, contacts);
  }

  /** World-level rules that run once per tick regardless of input (hits, respawns, exit rule). */
  endTick(): void {
    this.abilities.update();
    if (this.ctx.combat.playerHits) this.resolveAttacks();
    this.resolveBoxAttacks();
    this.resolveFoes();
    this.traps.expire(this.tick);
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
      players: this.listPlayers().map((p) => toNetPlayer(p, ackFor(p.id), this.maxHp(p))),
      collected: [...this.collected].sort((a, b) => a - b),
      traps: this.traps.toNet(),
      props: this.abilities.toNet(),
      foes: this.foes.toNetFoes(),
      shots: this.foes.toNetShots(),
    };
  }

  // --- internals -----------------------------------------------------------------------

  private abilityHost() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const world = this;
    return {
      get tick() {
        return world.tick;
      },
      get ctx() {
        return world.ctx;
      },
      get traps() {
        return world.traps;
      },
      get foes() {
        return world.foes;
      },
      listPlayers: () => world.listPlayers(),
      getPlayer: (id: string) => world.players.get(id),
      emit: (event: GameEvent) => {
        world.events.push(event);
      },
      maxHp: (p: WorldPlayer) => world.maxHp(p),
      hurt: (target: WorldPlayer, hit: AbilityHit) => world.abilityHurt(target, hit),
      hitBox: (by: WorldPlayer | null, boxId: number, count: number) => world.hitBox(by, boxId, count),
      hurtFoe: (by: WorldPlayer | null, foe: Foe, damage: number, dir: 1 | -1) => world.hurtFoe(by, foe, damage, dir, 'spit'),
      ticksFor: (seconds: number) => msToTicks(seconds * 1000),
    };
  }

  /** Hearts lost to an ability, then death or the usual stun + knockback. */
  private abilityHurt(target: WorldPlayer, hit: AbilityHit): void {
    const t = target.body;
    if (!t.alive || t.held !== Held.NONE) return;
    target.hp = Math.max(0, target.hp - hit.damage);
    this.events.push({
      type: 'abilityHit',
      playerId: target.id,
      by: hit.by,
      hp: target.hp,
      x: t.x + this.ctx.hitbox.width / 2,
      y: t.y + this.ctx.hitbox.height / 2,
    });
    if (target.hp <= 0) {
      this.kill(target, 'ability');
      return;
    }
    const taken = giantActive(t) ? this.abilityTuning.giant.knockbackTaken : 1;
    this.stun(target, hit.dirX >= 0 ? 1 : -1, hit.knockbackX * taken, hit.knockbackY * taken);
  }

  /** Stun + knockback towards `dir` (shared by swings and abilities). */
  private stun(target: WorldPlayer, dir: 1 | -1, knockbackX: number, knockbackY: number): void {
    const combat = this.ctx.combat;
    const t = target.body;
    target.hitImmuneTicks = msToTicks((combat.stun + combat.immunity) * 1000);
    t.hurt = combat.stun;
    t.attack = 0; // a hit cancels the target's own swing
    t.flight = 0;
    t.vx = dir * knockbackX;
    t.vy = -knockbackY;
    t.grounded = false;
    t.jumping = false;
    t.coyote = 0;
    t.buffer = 0;
    // Face the attacker: the Hurt frames draw the impact on the side the body faces.
    t.facing = dir > 0 ? -1 : 1;
  }

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

  private resolveInteractions(player: WorldPlayer, contacts: StepContacts): void {
    const body = player.body;
    const box: Rect = { x: body.x, y: body.y, width: this.ctx.hitbox.width, height: this.ctx.hitbox.height };

    if (body.y > this.level.heightPx + this.entityConfig.killPlaneMargin) {
      this.kill(player, 'fall');
      return;
    }
    if (contacts.crushed) {
      this.kill(player, 'crush');
      return;
    }
    if (this.touchesHazardTile(box) || this.level.hazards.some((zone) => rectsOverlap(box, zone))) {
      this.kill(player, 'hazard');
      return;
    }
    if (this.ctx.traps) {
      if (contacts.ground >= 0) this.traps.trigger(contacts.ground, this.tick);
      if (contacts.bounced >= 0) this.events.push({ type: 'bounce', playerId: player.id, trapId: contacts.bounced });
      this.resolveTrapHazards(player, box);
      if (!body.alive) return;
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
    // The exit stays shut while a boss is alive.
    player.atExit = !this.foes.bossAlive && this.level.exits.some((zone) => rectsOverlap(box, zone));
  }

  /**
   * Player-vs-player swings, in two passes: every hit is found against the state at the start
   * of the pass, then applied. Simultaneous swings therefore trade (both players are hit)
   * instead of the lower slot always winning, and the result doesn't depend on order. A target
   * hit by several swings on the same tick takes the lowest slot's hit.
   */
  private resolveAttacks(): void {
    const combat = this.ctx.combat;
    const hitbox = this.ctx.hitbox;
    const players = this.listPlayers();
    for (const player of players) {
      if (player.hitImmuneTicks > 0) player.hitImmuneTicks -= 1;
      if (player.body.attackSeq !== player.swingSeq) {
        player.swingSeq = player.body.attackSeq;
        player.swingHits = 0;
      }
    }
    const hits = new Map<WorldPlayer, WorldPlayer>(); // target -> attacker
    for (const attacker of players) {
      const a = attacker.body;
      if (!isAttackActive(a, combat)) continue;
      const reach = attackReachBox(a, hitbox, combat, this.reachScale(a));
      for (const target of players) {
        const t = target.body;
        if (target === attacker || !t.alive || t.hurt > 0 || target.hitImmuneTicks > 0 || t.held !== Held.NONE) continue;
        if (attacker.swingHits & (1 << target.slot)) continue;
        if (!rectsOverlap(reach, { x: t.x, y: t.y, width: hitbox.width, height: hitbox.height })) continue;
        if (!hits.has(target)) hits.set(target, attacker);
      }
    }
    const giant = this.abilityTuning.giant;
    for (const [target, attacker] of hits) {
      const a = attacker.body;
      const t = target.body;
      attacker.swingHits |= 1 << target.slot;
      // Away from the attacker; when exactly overlapping, along the attacker's facing.
      const away = t.x - a.x;
      const dir = away > 0 ? 1 : away < 0 ? -1 : a.facing;
      const big = giantActive(a);
      if (big) {
        // Giant swings cost hearts.
        target.hp = Math.max(0, target.hp - giant.swingDamage);
        this.events.push({
          type: 'abilityHit',
          playerId: target.id,
          by: attacker.id,
          hp: target.hp,
          x: t.x + hitbox.width / 2,
          y: t.y + hitbox.height / 2,
        });
        if (target.hp <= 0) {
          this.kill(target, 'ability');
          continue;
        }
      }
      const scale = (big ? giant.knockbackMultiplier : 1) * (giantActive(t) ? giant.knockbackTaken : 1);
      this.stun(target, dir, combat.knockbackX * scale, combat.knockbackY * scale);
    }
  }

  /** Giants swing further. */
  private reachScale(body: MovementBody): number {
    return giantActive(body) ? this.abilityTuning.giant.reachMultiplier : 1;
  }

  /** First trap hurting the player this tick costs a heart (none while invulnerable or stunned). */
  private resolveTrapHazards(player: WorldPlayer, box: Rect): void {
    if (this.tick < player.invulnUntil || player.body.hurt > 0) return;
    for (const hazard of this.traps.hazards(this.tick)) {
      const hit = hazard.rect
        ? rectsOverlap(box, hazard.rect)
        : circleOverlapsRect(hazard.circle!.x, hazard.circle!.y, hazard.circle!.r, box);
      if (!hit) continue;
      this.damage(player, hazard, box);
      return;
    }
  }

  /**
   * Trap damage: lose a heart, then either die (no hearts left) or get the shove treatment
   * (stun + knockback away from the trap) and a moment of invulnerability.
   */
  private damage(player: WorldPlayer, hazard: TrapHazard, box: Rect): void {
    const body = player.body;
    const cfg = this.traps.config.damage;
    const side = contactSide(box, hazard);
    player.hp = Math.max(0, player.hp - cfg.amount);
    this.events.push({ type: 'trapHit', playerId: player.id, trapId: hazard.id, hp: player.hp, side });
    if (player.hp <= 0) {
      this.kill(player, 'trap');
      return;
    }
    const away = box.x + box.width / 2 - hazard.sourceX;
    const dir = Math.abs(away) > 0.5 ? Math.sign(away) : -body.facing;
    body.hurt = this.ctx.combat.stun;
    body.attack = 0;
    body.vx = (side === 'up' || side === 'down' ? 0.5 : 1) * dir * cfg.knockbackX;
    body.vy = side === 'down' ? cfg.knockbackY * 0.25 : side === 'up' ? -cfg.knockbackY : -cfg.knockbackY * 0.6;
    body.grounded = false;
    body.jumping = false;
    body.coyote = 0;
    body.buffer = 0;
    body.facing = dir > 0 ? -1 : 1; // face the trap: the Hurt frames show the impact in front
    player.invulnUntil = this.tick + cfg.invulnerabilityTicks;
  }

  private hitBox(player: WorldPlayer | null, boxId: number, count = 1): void {
    const result = this.traps.hitBox(boxId, this.tick, count);
    if (result) this.events.push({ type: 'boxHit', playerId: player?.id ?? '', boxId, hits: result.hits, broken: result.broken });
  }

  /** Swings break boxes too (whether or not they can hit players), once per box per swing. */
  private resolveBoxAttacks(): void {
    if (!this.ctx.traps) return;
    const combat = this.ctx.combat;
    let boxes: ReturnType<TrapField['colliders']> | null = null;
    for (const player of this.players.values()) {
      const body = player.body;
      if (body.attackSeq !== player.boxSwingSeq) {
        player.boxSwingSeq = body.attackSeq;
        player.swingBoxes.clear();
      }
      if (!isAttackActive(body, combat)) continue;
      const reach = attackReachBox(body, this.ctx.hitbox, combat, this.reachScale(body));
      boxes ??= this.traps.colliders(this.tick).filter((c) => c.kind === 'box');
      const count = giantActive(body) ? this.abilityTuning.giant.boxHits : 1;
      for (const box of boxes) {
        if (player.swingBoxes.has(box.id) || !rectsOverlap(reach, box)) continue;
        player.swingBoxes.add(box.id);
        this.hitBox(player, box.id, count);
      }
    }
  }

  /**
   * Foes, once per tick after everyone moved: swings and stomps hurt them, then they think,
   * move and attack, and whoever they (or their shots) hit loses a heart.
   */
  private resolveFoes(): void {
    const foes = this.foes;
    if (foes.empty) return;
    const combat = this.ctx.combat;
    const hitbox = this.ctx.hitbox;
    const tuning = foes.config;
    const players = this.listPlayers();
    // Swings hit each foe once per swing (giants harder) and knock shots out of the air.
    for (const player of players) {
      const body = player.body;
      if (body.attackSeq !== player.foeSwingSeq) {
        player.foeSwingSeq = body.attackSeq;
        player.swingFoes.clear();
      }
      if (!body.alive || !isAttackActive(body, combat)) continue;
      const reach = attackReachBox(body, hitbox, combat, this.reachScale(body));
      const damage = giantActive(body) ? this.abilityTuning.giant.swingDamage : tuning.swingDamage;
      for (const foe of foes.live()) {
        if (player.swingFoes.has(foe.id) || !rectsOverlap(reach, foes.hitbox(foe))) continue;
        player.swingFoes.add(foe.id);
        const away = foe.x - (body.x + hitbox.width / 2);
        this.hurtFoe(player, foe, damage, away > 0 ? 1 : away < 0 ? -1 : body.facing, 'swing');
      }
      if (foes.parry(reach) > 0) {
        this.events.push({ type: 'parry', playerId: player.id, x: reach.x + reach.width / 2, y: reach.y + reach.height / 2 });
      }
    }
    // Stomps: landing on a foe's head hurts it and bounces the player back up (double jump restored).
    const targets = players.map((p) => this.foeTarget(p));
    players.forEach((player, i) => {
      const target = targets[i]!;
      if (!target.visible) return;
      const foe = foes.stompVictim(target);
      if (!foe) return;
      const body = player.body;
      this.hurtFoe(player, foe, tuning.stomp.damage, foe.x >= target.x + target.width / 2 ? 1 : -1, 'stomp');
      body.vy = -tuning.stomp.bounce;
      body.grounded = false;
      body.jumping = false;
      body.coyote = 0;
      body.airJumpsLeft = this.ctx.movement.airJumps;
      target.vy = body.vy;
      target.vulnerable = false;
    });
    for (const strike of foes.step(this.tick, targets)) {
      const player = this.players.get(strike.targetId);
      if (player) this.foeStrike(player, strike);
    }
  }

  /** A player as the foes see them. */
  private foeTarget(player: WorldPlayer): FoeTarget {
    const body = player.body;
    const free = body.alive && body.held === Held.NONE;
    return {
      id: player.id,
      x: body.x,
      y: body.y,
      width: this.ctx.hitbox.width,
      height: this.ctx.hitbox.height,
      vy: body.vy,
      visible: free,
      vulnerable: free && this.tick >= player.invulnUntil && body.hurt <= 0,
    };
  }

  /**
   * A player hurt a foe (a swing, a stomp, or something the frog spat; `player` is null when the
   * frog already left); finishing it scores its points.
   */
  private hurtFoe(player: WorldPlayer | null, foe: Foe, damage: number, dir: 1 | -1, how: 'swing' | 'stomp' | 'spit'): void {
    const result = this.foes.hurt(foe, damage, dir, player?.id ?? '');
    if (result === null) return;
    const blocked = result === 'blocked';
    const hp = blocked ? foe.hp : result;
    const score = hp === 0 && player ? this.foes.config[foe.kind].score : 0;
    if (player) player.score += score;
    const box = this.foes.hitbox(foe);
    this.events.push({
      type: 'foeHurt',
      playerId: player?.id ?? '',
      foeId: foe.id,
      kind: foe.kind,
      hp,
      blocked,
      stomp: how === 'stomp',
      spit: how === 'spit',
      score,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    });
  }

  /** A foe's hit, like a trap's: a heart, then death, or a shove and a moment of invulnerability. */
  private foeStrike(player: WorldPlayer, strike: FoeStrike): void {
    const body = player.body;
    if (!body.alive || body.held !== Held.NONE) return;
    player.hp = Math.max(0, player.hp - strike.damage);
    this.events.push({ type: 'foeHit', playerId: player.id, foeId: strike.foeId, hp: player.hp, x: strike.x, y: strike.y });
    if (player.hp <= 0) {
      this.kill(player, 'foe');
      return;
    }
    const taken = giantActive(body) ? this.abilityTuning.giant.knockbackTaken : 1;
    this.stun(player, strike.dir, strike.knockbackX * taken, strike.knockbackY * taken);
    player.invulnUntil = this.tick + this.foeInvulnerabilityTicks;
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
    this.abilities.onDeath(player);
    body.alive = false;
    body.vx = 0;
    body.vy = 0;
    body.jumping = false;
    body.attack = 0;
    body.attackCooldown = 0;
    body.hurt = 0;
    player.hitImmuneTicks = 0;
    player.hp = 0;
    player.invulnUntil = 0;
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
    resetBody(player.body, player.respawnPoint.x, player.respawnPoint.y, this.ctx.hitbox, this.ctx.movement.airJumps);
    player.respawnTicks = 0;
    player.hp = this.playerConfig.maxHp;
    player.tp += 1;
    this.events.push({ type: 'respawn', playerId: player.id });
  }
}

function toNetPlayer(p: WorldPlayer, ack: number, maxHp: number): NetPlayerState {
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
    airJumpsLeft: b.airJumpsLeft,
    alive: b.alive,
    respawnIn: p.respawnTicks,
    score: p.score,
    deaths: p.deaths,
    atExit: p.atExit,
    checkpointId: p.checkpointId,
    tp: p.tp,
    attackHeld: b.attackHeld,
    attack: b.attack,
    attackCooldown: b.attackCooldown,
    attackSeq: b.attackSeq,
    hurt: b.hurt,
    stepTick: b.stepTick,
    hp: p.hp,
    invulnUntil: p.invulnUntil,
    ability: b.ability,
    specialHeld: b.specialHeld,
    phase: b.phase,
    phaseTime: b.phaseTime,
    specialCooldown: b.specialCooldown,
    specialSeq: b.specialSeq,
    aim: b.aim,
    reach: b.reach,
    giant: b.giant,
    droneX: b.droneX,
    droneY: b.droneY,
    droneVx: b.droneVx,
    droneVy: b.droneVy,
    cargo: b.cargo,
    held: b.held,
    flight: b.flight,
    grab: grabKey(p),
    maxHp,
    ack,
  };
}

function grabKey(p: WorldPlayer): string {
  const grab = p.ability.grab;
  if (!grab) return '';
  return grab.kind === 'player' ? `p:${grab.id}` : grab.kind === 'foe' ? `f:${grab.id}` : `b:${grab.id}`;
}

/** Which side of the hazard the player touched (for knockback and the spike-head squash). */
function contactSide(box: Rect, hazard: TrapHazard): Dir4 {
  const r = hazard.rect;
  if (hazard.kind === 'spikeHead' && r) {
    const slack = 3;
    if (box.y + box.height <= r.y + slack) return 'up';
    if (box.y >= r.y + r.height - slack) return 'down';
    return box.x + box.width / 2 < hazard.sourceX ? 'left' : 'right';
  }
  const dx = box.x + box.width / 2 - hazard.sourceX;
  const dy = box.y + box.height / 2 - hazard.sourceY;
  if (Math.abs(dy) >= Math.abs(dx) * 0.5) return dy < 0 ? 'up' : 'down';
  return dx < 0 ? 'left' : 'right';
}
