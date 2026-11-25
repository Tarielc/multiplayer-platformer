import {
  ABILITIES,
  Ability,
  CARRIED_FEET_BELOW_GRIP,
  CHARACTER_ABILITY,
  Cargo,
  Held,
  LEVELS,
  MOVEMENT_TUNING,
  NET_CONFIG,
  NEUTRAL_INPUT,
  PLAYER_CONFIG,
  Phase,
  TICK_DT,
  TICK_MS,
  TrapField,
  TypedEmitter,
  attackReachBox,
  bodyRect,
  defaultCharacterForSlot,
  droneDeck,
  droneGrip,
  healHugFeet,
  healPullCenter,
  healShoulder,
  isAttackActive,
  levelChecksum,
  ordinal,
  parseTiledLevel,
  playerHead,
  hitboxOf,
  giantActive,
  propertiesToRecord,
  resolveCombat,
  resolveMovement,
  slotStyle,
  tongueOrigin,
  tongueTip,
  type Collider,
  type CompiledCombat,
  type GameEvent,
  type LevelData,
  type LevelManifestEntry,
  type MovementBody,
  type MovementContext,
  type NetWorldState,
  type Rect,
  type RoomInfo,
  type RoomLevelInfo,
  type TiledMap,
  type TiledProperty,
  type TiledTileset,
} from '@platformer/shared';
import * as Phaser from 'phaser';
import { devVirtualButtons, registerDevProvider } from '@/devtools/devHook';
import type { WorldUpdate } from '@/net/GameClient';
import { Interpolator, type RemoteSample } from '@/net/Interpolator';
import { LocalPredictor } from '@/net/LocalPredictor';
import { ABILITY_SHEETS } from '../abilities/abilityArt';
import { playFx } from '../abilities/abilityFx';
import { PropViews } from '../abilities/PropViews';
import { fallbackTilesetCanvas } from '../art/tilesetFallback';
import { SoundController } from '../audio/SoundController';
import { VIEW_CONFIG } from '../config';
import { DebugDraw, type DebugBox } from '../debug/DebugDraw';
import { FoeViews, type FoeAnchor } from '../foes/FoeViews';
import { InputController } from '../input/InputController';
import { signalsFromBody, signalsFromSample } from '../player/playerSignals';
import type { PlayerCueEvent, PresentationEvents, WorldCueEvent } from '../presentation';
import type { GameServices } from '../services';
import { listen, onSceneEnd } from '../util/listen';
import { Backdrop } from '../views/Backdrop';
import { EntityViews } from '../views/EntityViews';
import { airPuff, floatText, puff } from '../views/effects';
import { PlayerView } from '../views/PlayerView';
import { TrapViews } from '../traps/TrapViews';
import { SCENE_KEYS } from './keys';

const INTERPOLATION_DELAY_TICKS = NET_CONFIG.interpolationDelayMs / TICK_MS;
const HEAL_AFTERGLOW_MS = ABILITIES.heal.afterglow * 1000;

/** Positions of what the local player's ability holds (players: feet; boxes: top-left; foes: see `FoeAnchor`). */
interface Attachments {
  players: ReadonlyMap<string, { x: number; y: number }>;
  props: ReadonlyMap<number, { x: number; y: number }>;
  foes: ReadonlyMap<number, FoeAnchor>;
}
const NO_ATTACHMENTS: Attachments = { players: new Map(), props: new Map(), foes: new Map() };
const HITBOX = PLAYER_CONFIG.hitbox;
/** Sizes players' hitboxes (a giant's is bigger), as the simulation does. */
const SIZES = { hitbox: HITBOX, abilities: ABILITIES };

/** Whether feet at (x, y) stand on a drone's `deck` (within `tolerance` px of its top). */
function onDeck(x: number, y: number, deck: Rect, tolerance = 1.5): boolean {
  return Math.abs(y - deck.y) <= tolerance && x + HITBOX.width / 2 > deck.x && x - HITBOX.width / 2 < deck.x + deck.width;
}

const tilesetKey = (def: TiledTileset) => `tileset:${def.name ?? 'tileset'}:${def.image ?? ''}`;

/**
 * Renders the current level run and drives local prediction.
 *
 *  - preload: fetch the Tiled map (cache-busted by the server checksum) and its tileset images;
 *    images that fail to load are replaced by generated textures in create().
 *  - create: parse with the shared parser (same LevelData as the server), compare checksums,
 *    build tile layers, entities, camera, input, and subscribe to the net client.
 *  - update: fixed 60 Hz accumulator -> sample input -> send -> predict; render the local player
 *    from the predictor and remote players from the interpolation buffer.
 *  - presentation: player views turn replicated state into animation states and cues
 *    (PlayerStateMachine); cues and server events go on a presentation bus that drives sound
 *    (SoundController) and effects. Nothing on that bus affects gameplay.
 *
 * Phaser re-uses the scene instance on restart (new level run), so all per-run state is reset
 * in init().
 */
export class LevelScene extends Phaser.Scene {
  private info: RoomLevelInfo | null = null;
  private entry: LevelManifestEntry | null = null;
  private mapUrl = '';
  private mapKey = '';
  private failedFiles = new Set<string>();
  private levelData: LevelData | null = null;
  private predictor: LocalPredictor | null = null;
  private interpolator = new Interpolator();
  private views = new Map<string, PlayerView>();
  private entityViews: EntityViews | null = null;
  private traps: TrapField | null = null;
  /** Other players' drone decks and heads in the latest server state: what the prediction can stand on. */
  private readonly decks = new Map<string, Rect>();
  private readonly heads = new Map<string, Rect>();
  private deckColliders: Collider[] = [];
  private trapViews: TrapViews | null = null;
  private propViews: PropViews | null = null;
  private foeViews: FoeViews | null = null;
  private followTarget: Phaser.GameObjects.GameObject | null = null;
  private backdrop: Backdrop | null = null;
  private debugDraw: DebugDraw | null = null;
  private controls: InputController | null = null;
  private combat: CompiledCombat = resolveCombat();
  private presentation = new TypedEmitter<PresentationEvents>();
  private sfx: SoundController | null = null;
  private accumulator = 0;
  private lastFrame = 0;
  private statsElapsed = 0;
  private frameCount = 0;
  private fps = 0;
  private remoteRenderTick = 0;
  private cameraSnapped = false;
  private restarting = false;

  constructor(private readonly services: GameServices) {
    super({ key: SCENE_KEYS.level });
  }

  init(): void {
    this.info = null;
    this.entry = null;
    this.failedFiles = new Set();
    this.levelData = null;
    this.predictor = null;
    this.interpolator = new Interpolator();
    this.views = new Map();
    this.entityViews = null;
    this.traps = null;
    this.trapViews = null;
    this.propViews = null;
    this.foeViews = null;
    this.followTarget = null;
    this.backdrop = null;
    this.debugDraw = null;
    this.controls = null;
    this.presentation = new TypedEmitter<PresentationEvents>();
    this.sfx = null;
    this.accumulator = 0;
    this.statsElapsed = 0;
    this.frameCount = 0;
    this.cameraSnapped = false;
    this.restarting = false;

    const level = this.services.client.room?.level ?? null;
    const entry = level ? LEVELS.get(level.id) : undefined;
    if (!level || !entry) return;
    this.info = { ...level };
    this.entry = entry;
    this.mapUrl = new URL(`${this.services.assetBase}/${entry.map}?v=${level.checksum}`, window.location.href).href;
    this.mapKey = `map:${entry.id}:${level.checksum}`;
  }

  preload(): void {
    if (!this.entry) return;
    this.showLoadingBar();
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, this.onLoadError);
    const cached: unknown = this.cache.json.get(this.mapKey);
    if (cached) {
      this.queueTilesetImages(cached);
      return;
    }
    this.load.json(this.mapKey, this.mapUrl);
    this.load.once(`filecomplete-json-${this.mapKey}`, (_key: string, _type: string, data: unknown) =>
      this.queueTilesetImages(data),
    );
  }

  create(): void {
    this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, this.onLoadError);
    const { client, bridge } = this.services;
    if (!this.entry || !this.info) return this.showError('The room has no level to load.');

    const json: unknown = this.cache.json.get(this.mapKey);
    if (!json) return this.showError(`Could not load ${this.mapUrl}. Run "npm run assets:sync" and reload.`);
    let level: LevelData;
    try {
      level = parseTiledLevel(json, {
        id: this.entry.id,
        name: this.entry.name,
        backgroundColor: this.entry.backgroundColor,
      });
    } catch (error) {
      return this.showError(`Invalid map ${this.entry.map}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const checksum = levelChecksum(level);
    if (checksum !== this.info.checksum) {
      bridge.emit('level:warning', {
        message: `Your copy of "${this.entry.name}" differs from the server's (${checksum} vs ${this.info.checksum}). Reload the page.`,
      });
    }
    this.levelData = level;

    // Same trap runtime as the server's world; the predictor keeps it in sync with snapshots.
    const traps = TrapField.forLevel(level);
    this.traps = traps;
    const ctx: MovementContext = {
      level,
      movement: resolveMovement(MOVEMENT_TUNING, this.entry.tuning),
      hitbox: HITBOX,
      combat: this.combat,
      dt: TICK_DT,
      traps: level.traps.length > 0 ? traps : null,
      platforms: { platformsFor: () => this.deckColliders },
    };
    this.predictor = new LocalPredictor(ctx);
    const sound = new SoundController(this, bridge.audio);
    this.sfx = sound;
    this.presentation.on('player', this.onPlayerCue);
    this.presentation.on('world', this.onWorldCue);

    this.setupCamera(level);
    this.backdrop = new Backdrop(this, this.entry.background);
    this.buildTilemap(json as TiledMap);
    this.entityViews = new EntityViews(this, level);
    this.trapViews = new TrapViews(this, traps, (event) => this.presentation.emit('world', event));
    this.propViews = new PropViews(this, traps.config.box);
    this.foeViews = new FoeViews(this, (event) => this.presentation.emit('world', event));
    this.debugDraw = new DebugDraw(this, level, HITBOX);
    this.debugDraw.setVisible(bridge.debug);
    this.controls = new InputController(this, () => bridge.emit('input:menu'), bridge.touch);
    this.controls.setEnabled(!bridge.menuOpen);

    listen(this, client.events, 'world', this.onWorld);
    listen(this, client.events, 'room', this.onRoom);
    listen(this, client.events, 'welcome', () => this.predictor?.clearPending());
    listen(this, bridge, 'ui:menu', (open) => this.controls?.setEnabled(!open));
    listen(this, bridge, 'ui:debug', (on) => this.debugDraw?.setVisible(on));
    listen(this, bridge, 'ui:audio', (settings) => sound.applySettings(settings));

    const unregister = registerDevProvider('scene', () => this.devSnapshot());
    const unregisterAudio = registerDevProvider('audio', () => sound.stats());
    onSceneEnd(this, () => {
      unregister();
      unregisterAudio();
      this.controls?.destroy();
      this.controls = null;
      for (const view of this.views.values()) view.destroy();
      this.views.clear();
      this.trapViews?.destroy();
      this.trapViews = null;
      this.propViews?.destroy();
      this.propViews = null;
      this.foeViews?.destroy();
      this.foeViews = null;
      this.presentation.removeAllListeners();
      sound.destroy();
      this.sfx = null;
    });

    const latest = client.latestWorld;
    if (latest && client.worldStore.run === this.info.run) this.applyWorld(latest, []);
    this.lastFrame = performance.now();
    bridge.emit('scene:ready', { levelId: this.entry.id, run: this.info.run });
  }

  override update(): void {
    const { predictor, controls, entityViews, trapViews, propViews } = this;
    if (!predictor || !controls || !entityViews || !trapViews || !propViews) return;
    const { client, bridge } = this.services;
    const now = performance.now();
    const frameMs = Math.min(now - this.lastFrame, VIEW_CONFIG.maxFrameMs);
    this.lastFrame = now;
    controls.pollMenu();

    // Fixed-step prediction at the server's tick rate.
    const room = client.room;
    const simulate = room?.phase === 'playing' && !room.paused && client.isOpen && predictor.ready;
    // Aim of the special ability, from the predicted body (mouse / stick / arrow keys).
    const aim = this.sampleAim(controls, predictor.current);
    const piloting = predictor.current?.phase === Phase.DRONE_PILOT;
    if (simulate) {
      this.accumulator += frameMs;
      let steps = 0;
      while (this.accumulator >= TICK_MS) {
        if (steps === VIEW_CONFIG.maxStepsPerFrame) {
          this.accumulator = 0;
          break;
        }
        const buttons = bridge.menuOpen ? NEUTRAL_INPUT : controls.sample(aim, piloting) | devVirtualButtons();
        const seq = client.sendInput(buttons);
        const contacts = predictor.step(seq, buttons);
        // Trampolines spring the moment you land on them (the server event is for everyone else).
        if (contacts && contacts.bounced >= 0) trapViews.bounce(contacts.bounced, true);
        controls.consumeLatch();
        this.accumulator -= TICK_MS;
        steps += 1;
      }
    } else {
      this.accumulator = 0;
    }

    // Render.
    predictor.decay(frameMs);
    const alpha = simulate ? this.accumulator / TICK_MS : 1;
    const debug = bridge.debug;
    const boxes: DebugBox[] = [];
    const selfId = client.playerId;

    const local = selfId ? this.views.get(selfId) : undefined;
    const position = predictor.renderPosition(alpha);
    const body = predictor.current;
    const renderTick = client.clock.tickAt(now) - INTERPOLATION_DELAY_TICKS;
    this.remoteRenderTick = renderTick;
    const samples = this.interpolator.sample(renderTick);
    // What the local player's ability holds is drawn where the prediction has it, not 100 ms late.
    const attached = body && position ? this.localAttachments({ ...body, x: position.x, y: position.y }) : NO_ATTACHMENTS;
    if (local && position && body) {
      const signals = signalsFromBody(body, predictor.teleports);
      const server = predictor.lastServer;
      local.setFinished(server !== null && server.place > 0);
      local.setInvulnerable(server !== null && server.invulnUntil > server.stepTick);
      // Held by someone else's ability: the server places us, in step with the (interpolated) captor.
      const self = body.held !== Held.NONE && selfId ? samples.get(selfId) : undefined;
      const size = hitboxOf(body, SIZES);
      let feetX = self ? self.x + HITBOX.width / 2 : position.x + size.width / 2;
      let feetY = self ? self.y + HITBOX.height : position.y + size.height;
      // Riding someone's drone or standing on someone's head: stand on it where it is drawn
      // (100 ms behind), not where the server had it last. A head doesn't carry anyone along,
      // so only the height follows it.
      if (!self && body.grounded) {
        const riding = this.ridden(feetX, feetY);
        const sample = riding ? samples.get(riding.id) : undefined;
        const drawn = riding && sample ? (riding.kind === 'deck' ? droneDeck(sample, ABILITIES) : playerHead(sample, SIZES)) : null;
        if (riding && drawn) {
          if (riding.kind === 'deck') feetX = drawn.x + (feetX - riding.rect.x);
          feetY = drawn.y;
        }
      }
      const ability = CHARACTER_ABILITY[local.characterId];
      const ahead = body.facing > 0 ? 0 : Math.PI;
      const preview =
        ability === Ability.TONGUE ? (aim ?? (body.phase === Phase.TONGUE_HOLD ? ahead : null)) : ability === Ability.HEAL ? aim : null;
      local.render(feetX, feetY, body.facing, signals, frameMs, preview);
      // Race: once you finished, watch someone still racing; dead, watch a teammate until you respawn.
      const spectating = local.isFinished || !body.alive;
      this.follow((spectating ? this.spectateTarget(samples) : null) ?? local.droneTarget ?? local.container);
      if (!this.cameraSnapped) {
        this.cameras.main.centerOn(local.container.x, local.container.y);
        this.cameraSnapped = true;
      }
      if (debug) {
        const color = slotStyle(client.slot ?? 0).color;
        boxes.push({ x: position.x, y: position.y, ...size, color });
        this.pushReachBox(boxes, { ...body, x: position.x, y: position.y }, color);
        const ghost = predictor.lastServer;
        if (ghost) boxes.push({ ...bodyRect(ghost, SIZES), color: 0xffffff, ghost: true });
      }
    }

    // Players riding the local drone stand on it where the prediction has it; those on the local
    // player's head are only pushed up by it (as the server does), never carried or pulled down.
    const ownSample = selfId ? samples.get(selfId) : undefined;
    const ownDeckThen = ownSample ? droneDeck(ownSample, ABILITIES) : null;
    const ownDeckNow = body ? droneDeck(body, ABILITIES) : null;
    const ownHeadThen = ownSample ? playerHead(ownSample, SIZES) : null;
    const ownHeadNow = body && position ? playerHead({ ...body, x: position.x, y: position.y }, SIZES) : null;
    for (const [id, view] of this.views) {
      if (id === selfId) continue;
      const s = samples.get(id);
      if (!s) continue;
      view.setInvulnerable(s.invulnUntil > renderTick);
      view.setFinished(s.place > 0);
      const size = hitboxOf(s, SIZES);
      let feet = attached.players.get(id) ?? { x: s.x + size.width / 2, y: s.y + size.height };
      if (ownDeckThen && ownDeckNow && s.grounded && !attached.players.has(id) && onDeck(feet.x, feet.y, ownDeckThen)) {
        feet = { x: ownDeckNow.x + (feet.x - ownDeckThen.x), y: ownDeckNow.y };
      } else if (ownHeadThen && ownHeadNow && s.grounded && !attached.players.has(id) && onDeck(feet.x, feet.y, ownHeadThen)) {
        feet = { x: feet.x, y: Math.min(feet.y, ownHeadNow.y) };
      }
      view.render(feet.x, feet.y, s.facing, signalsFromSample(s), frameMs);
      if (debug) {
        boxes.push({ x: s.x, y: s.y, ...size, color: this.slotColor(id) });
        this.pushReachBox(boxes, s, this.slotColor(id));
      }
    }

    // Boxes an ability carries or spat; their trap views hide meanwhile.
    trapViews.setProps(propViews.update(this.interpolator.sampleProps(renderTick), attached.props, frameMs));
    // Traps are drawn at the local player's predicted tick: where they are when you meet them.
    trapViews.update(predictor.renderTick(alpha) ?? renderTick, frameMs);
    if (debug) trapViews.debugBoxes(boxes);
    // Foes and their shots: server-only, drawn where the other players are (100 ms behind).
    if (room) this.foeViews?.setTeam(room.mode, room.scaledFor);
    this.foeViews?.update(this.interpolator.sampleFoes(renderTick), this.interpolator.sampleShots(renderTick), attached.foes, frameMs);
    if (debug) this.foeViews?.debugBoxes(boxes);
    entityViews.update(frameMs);
    this.backdrop?.update(frameMs);
    this.debugDraw?.draw(boxes);
    this.reportStats(frameMs);
  }

  // --- network -------------------------------------------------------------------------------

  private readonly onWorld = (update: WorldUpdate) => {
    if (!this.info || update.run !== this.info.run) return;
    this.applyWorld(update.state, update.events);
  };

  private readonly onRoom = (room: RoomInfo) => {
    if (!this.info || this.restarting) return;
    if (room.level && room.level.run !== this.info.run) {
      this.restarting = true;
      this.scene.restart();
      return;
    }
    for (const [id, view] of this.views) {
      const player = room.players.find((p) => p.id === id);
      if (!player) continue;
      view.setName(player.name);
      view.setConnected(player.connected);
      view.setCharacter(player.characterId);
    }
  };

  private applyWorld(state: NetWorldState, events: GameEvent[]): void {
    const { predictor, entityViews } = this;
    if (!predictor || !entityViews) return;
    this.interpolator.push(state);

    const present = new Set<string>();
    for (const player of state.players) {
      present.add(player.id);
      this.ensureView(player.id);
    }
    for (const [id, view] of this.views) {
      if (present.has(id)) continue;
      view.destroy();
      this.views.delete(id);
    }

    const selfId = this.services.client.playerId;
    const me = selfId ? state.players.find((p) => p.id === selfId) : undefined;
    this.decks.clear();
    this.heads.clear();
    for (const player of state.players) {
      if (player.id === selfId) continue;
      const deck = droneDeck(player, ABILITIES);
      if (deck) this.decks.set(player.id, deck);
      const head = playerHead(player, SIZES);
      if (head) this.heads.set(player.id, head);
    }
    this.deckColliders = [...this.decks.values(), ...this.heads.values()].map((rect) => ({ ...rect, id: -1, oneWay: true, bounce: 0 }));
    if (me) predictor.reconcile(me, state.traps);
    else this.traps?.applyNet(state.traps);

    for (const event of events) this.playEvent(event, state);
    entityViews.sync(state, this.services.client.room?.mode === 'race');
  }

  private ensureView(id: string): PlayerView {
    const existing = this.views.get(id);
    if (existing) return existing;
    const { client } = this.services;
    const info = client.room?.players.find((p) => p.id === id);
    const isSelf = id === client.playerId;
    const slot = info?.slot ?? 0;
    const view = new PlayerView(this, {
      id,
      slot,
      name: info?.name ?? '…',
      isSelf,
      hitbox: HITBOX,
      characterId: info?.characterId ?? defaultCharacterForSlot(slot),
      onCue: (event) => this.presentation.emit('player', event),
    });
    view.setConnected(info?.connected ?? true);
    this.views.set(id, view);
    if (isSelf) this.follow(view.container);
    return view;
  }

  /** The drone deck or head (in the latest server state) that feet at (x, y) stand on, if any. */
  private ridden(x: number, y: number): { id: string; kind: 'deck' | 'head'; rect: Rect } | null {
    for (const [id, rect] of this.decks) if (onDeck(x, y, rect)) return { id, kind: 'deck', rect };
    for (const [id, rect] of this.heads) if (onDeck(x, y, rect)) return { id, kind: 'head', rect };
    return null;
  }

  /** Who to watch while out of play: the lowest-slot other player alive and still in the level (or their drone), if any. */
  private spectateTarget(samples: ReadonlyMap<string, RemoteSample>): (Phaser.GameObjects.GameObject & { x: number; y: number }) | null {
    const { client } = this.services;
    const players = [...(client.room?.players ?? [])].sort((a, b) => a.slot - b.slot);
    for (const player of players) {
      if (player.id === client.playerId) continue;
      const view = this.views.get(player.id);
      const sample = samples.get(player.id);
      if (view && sample && sample.alive && sample.place === 0) return view.droneTarget ?? view.container;
    }
    return null;
  }

  /** The camera follows the local player, or their drone while they fly it. */
  private follow(target: Phaser.GameObjects.GameObject & { x: number; y: number }): void {
    if (this.followTarget === target) return;
    this.followTarget = target;
    const { lerp } = VIEW_CONFIG.camera;
    this.cameras.main.startFollow(target, true, lerp, lerp);
  }

  /** The special ability's aim this frame (null = straight ahead), from where it leaves the body. */
  private sampleAim(controls: InputController, body: Readonly<MovementBody> | null): number | null {
    if (!body) return null;
    const local = this.services.client.playerId ? this.views.get(this.services.client.playerId) : undefined;
    const heal = local !== undefined && CHARACTER_ABILITY[local.characterId] === Ability.HEAL;
    const origin = heal ? healShoulder(body, HITBOX, ABILITIES) : tongueOrigin(body, HITBOX, ABILITIES);
    return controls.aimAngle(origin.x, origin.y, body.facing);
  }

  /**
   * Where the local player's ability holds its catch (players by feet, boxes by top-left, foes
   * by the grip or tongue tip), from the predicted body: the claw's grip, the tongue tip, the hug spot.
   */
  private localAttachments(body: Readonly<MovementBody>): Attachments {
    const grab = this.predictor?.lastServer?.grab ?? '';
    if (!grab) return NO_ATTACHMENTS;
    const kind = grab.slice(0, 2);
    const id = grab.slice(2);
    const box = this.traps?.config.box ?? { width: 20, height: 20 };
    let feet: { x: number; y: number } | null = null;
    let topLeft: { x: number; y: number } | null = null;
    let foe: FoeAnchor | null = null;
    if (body.phase === Phase.DRONE_PILOT && body.cargo !== Cargo.NONE) {
      const grip = droneGrip(body, ABILITIES);
      feet = { x: grip.x, y: grip.y + CARRIED_FEET_BELOW_GRIP };
      topLeft = { x: grip.x - box.width / 2, y: grip.y };
      foe = { at: 'claw', ...grip };
    } else if (body.phase === Phase.TONGUE_PULL) {
      const tip = tongueTip(body, HITBOX, ABILITIES);
      feet = { x: tip.x, y: tip.y + HITBOX.height / 2 };
      topLeft = { x: tip.x - box.width / 2, y: tip.y - box.height / 2 };
      foe = { at: 'tongue', ...tip };
    } else if (body.phase === Phase.TONGUE_GULP || body.phase === Phase.TONGUE_HOLD || body.phase === Phase.TONGUE_SPIT) {
      foe = { at: 'mouth', x: 0, y: 0 };
    } else if (body.phase === Phase.HEAL_PULL) {
      const center = healPullCenter(body, HITBOX, ABILITIES);
      feet = { x: center.x, y: center.y + HITBOX.height / 2 };
    } else if (body.phase === Phase.HEAL_HUG) {
      feet = healHugFeet(body, HITBOX, body.phaseTime, ABILITIES);
    }
    const out = {
      players: new Map<string, { x: number; y: number }>(),
      props: new Map<number, { x: number; y: number }>(),
      foes: new Map<number, FoeAnchor>(),
    };
    if (kind === 'b:') {
      if (topLeft) out.props.set(Number(id), topLeft);
    } else if (kind === 'f:') {
      if (foe) out.foes.set(Number(id), foe);
    } else if (feet) {
      out.players.set(id, feet);
    }
    return out;
  }

  private playEvent(event: GameEvent, state: NetWorldState): void {
    const entities = this.entityViews!;
    const selfId = this.services.client.playerId;
    switch (event.type) {
      case 'collect': {
        const position = entities.itemPosition(event.entityId);
        entities.collect(event.entityId);
        if (position) {
          floatText(this, position.x, position.y - 8, `+${event.value}`, this.slotCss(event.playerId));
          this.presentation.emit('world', {
            cue: event.kind === 'gem' || event.kind === 'melon' ? 'gem' : 'coin',
            x: position.x,
            y: position.y,
            isSelf: event.playerId === selfId,
          });
        }
        break;
      }
      case 'death':
        // The Death clip plays on the player view (death cue); only the camera reacts here.
        if (event.playerId === selfId) this.cameras.main.shake(140, 0.004);
        break;
      case 'respawn': {
        const player = state.players.find((p) => p.id === event.playerId);
        if (player) puff(this, player.x + HITBOX.width / 2, player.y + HITBOX.height / 2, 0xffffff, 8);
        break;
      }
      case 'checkpoint': {
        const position = entities.flagPosition(event.checkpointId);
        if (position) {
          floatText(this, position.x, position.y, 'Checkpoint!', '#7ee081');
          this.presentation.emit('world', { cue: 'checkpoint', x: position.x, y: position.y, isSelf: event.playerId === selfId });
        }
        break;
      }
      case 'trapHit':
        // The damage itself shows on the player view (Hurt, blink); spike-heads also squash.
        this.trapViews?.trapHit(event.trapId, event.side);
        break;
      case 'fallHit':
        // The hearts lost show on the player view (Hurt, blink); the ground takes the impact.
        puff(this, event.x, event.y - 2, 0xd9c8a9, 6 + 4 * event.damage);
        this.presentation.emit('world', { cue: 'thud', x: event.x, y: event.y, isSelf: event.playerId === selfId });
        if (event.playerId === selfId) this.cameras.main.shake(120 + 60 * event.damage, 0.004 + 0.002 * event.damage);
        break;
      case 'crateHit':
        // A falling box on the head: the hearts show on the player view; splinters and a knock here.
        puff(this, event.x, event.y, 0xc8955a, 10);
        this.presentation.emit('world', { cue: 'boxHit', x: event.x, y: event.y, isSelf: event.playerId === selfId || event.by === selfId });
        if (event.playerId === selfId) this.cameras.main.shake(160, 0.006);
        break;
      case 'bounce':
        if (event.playerId !== selfId) this.trapViews?.bounce(event.trapId, false);
        break;
      case 'boxHit':
        this.trapViews?.boxHit(event.boxId, event.broken, event.playerId === selfId);
        break;
      case 'heal': {
        const fx = ABILITY_SHEETS.healFx.key;
        const depth = VIEW_CONFIG.depth.effects;
        const heart = '\u2665';
        playFx(this, fx, 'heal_ring', event.x, event.y + HITBOX.height / 2, { depth });
        playFx(this, fx, 'heart_burst', event.x, event.y - 6, { depth });
        playFx(this, fx, 'heal_sparkles', event.x, event.y + HITBOX.height / 2, { depth, durationMs: HEAL_AFTERGLOW_MS, fade: true });
        floatText(this, event.x, event.y - 12, `+${ABILITIES.heal.amount} ${heart}`, '#ff8fb8');
        const healer = state.players.find((p) => p.id === event.playerId);
        if (healer && event.targetId) {
          floatText(this, healer.x + HITBOX.width / 2, healer.y - 12, `+${ABILITIES.heal.selfAmount} ${heart}`, '#ff8fb8');
        }
        this.presentation.emit('world', { cue: 'heal', x: event.x, y: event.y, isSelf: event.playerId === selfId || event.targetId === selfId });
        break;
      }
      case 'grab': {
        if (event.targetId === null && event.boxId === null && event.foeId === null) break;
        const captor = state.players.find((p) => p.id === event.playerId);
        if (captor) this.presentation.emit('world', { cue: 'grab', x: captor.x, y: captor.y, isSelf: event.playerId === selfId });
        break;
      }
      case 'release':
        if (!event.spit) this.presentation.emit('world', { cue: 'drop', x: event.x, y: event.y, isSelf: event.playerId === selfId });
        break;
      case 'abilityHit': {
        const attacker = this.services.client.room?.players.find((p) => p.id === event.by);
        const spat = attacker ? CHARACTER_ABILITY[attacker.characterId] === Ability.TONGUE : false;
        if (spat) playFx(this, ABILITY_SHEETS.spitFx.key, 'impact', event.x, event.y, { depth: VIEW_CONFIG.depth.effects });
        else puff(this, event.x, event.y, 0xffe08a, 12);
        this.presentation.emit('world', { cue: 'splat', x: event.x, y: event.y, isSelf: event.playerId === selfId });
        if (event.playerId === selfId) this.cameras.main.shake(160, 0.006);
        break;
      }
      case 'propBreak':
        this.trapViews?.burstAt(event.boxId, event.variant, event.x, event.y, false);
        break;
      case 'foeHit':
        // The heart lost shows on the player view (Hurt, blink); a puff marks the blow.
        puff(this, event.x, event.y, 0xffffff, 6);
        break;
      case 'foeHurt': {
        const isSelf = event.playerId === selfId;
        if (event.blocked) {
          // Glanced off armour (the rhino): a spark and a clang, nothing more.
          puff(this, event.x, event.y, 0xc9d3e0, 5);
          this.presentation.emit('world', { cue: 'clang', x: event.x, y: event.y, isSelf });
          if (event.stomp) this.presentation.emit('world', { cue: 'stomp', x: event.x, y: event.y, isSelf });
          break;
        }
        const beaten = event.hp <= 0;
        // Something the frog spat splats like any spit hit; swings and stomps puff.
        if (event.spit) playFx(this, ABILITY_SHEETS.spitFx.key, 'impact', event.x, event.y, { depth: VIEW_CONFIG.depth.effects });
        else puff(this, event.x, event.y, beaten ? 0xfff1c1 : 0xffffff, beaten ? 12 : 7);
        if (event.stomp) this.presentation.emit('world', { cue: 'stomp', x: event.x, y: event.y, isSelf });
        // A hard landing, or a box or another foe on the head: a thud and dust.
        if (event.fall || event.crush || event.squash) {
          puff(this, event.x, event.y, 0xd9c8a9, 8);
          const cue = event.crush ? 'boxHit' : event.squash ? 'stomp' : 'thud';
          this.presentation.emit('world', { cue, x: event.x, y: event.y, isSelf });
        }
        this.presentation.emit('world', { cue: beaten ? 'foeDefeat' : event.spit ? 'splat' : 'hit', x: event.x, y: event.y, isSelf });
        if (beaten && event.score > 0) floatText(this, event.x, event.y - 12, `+${event.score}`, this.slotCss(event.playerId));
        if (isSelf) this.cameras.main.shake(80, beaten ? 0.003 : 0.002);
        break;
      }
      case 'parry':
        puff(this, event.x, event.y, 0xfff1c1, 8);
        this.presentation.emit('world', { cue: 'parry', x: event.x, y: event.y, isSelf: event.playerId === selfId });
        break;
      case 'finish': {
        // The racer's view hides (it left play); the trophy celebrates the arrival.
        const color = this.slotCss(event.playerId);
        puff(this, event.x, event.y, this.slotColor(event.playerId), 14, 1.4);
        floatText(this, event.x, event.y - HITBOX.height, `${ordinal(event.place)}!`, color);
        this.presentation.emit('world', { cue: 'finish', x: event.x, y: event.y, isSelf: event.playerId === selfId });
        if (event.playerId === selfId) this.cameras.main.flash(180, 255, 241, 193);
        break;
      }
      case 'levelComplete': {
        // React shows the results overlay.
        const camera = this.cameras.main;
        this.presentation.emit('world', { cue: 'levelComplete', x: camera.midPoint.x, y: camera.midPoint.y, isSelf: true });
        break;
      }
      case 'teamWipe':
        // React shows the "wiped out" overlay; the level restarts as a new run.
        this.cameras.main.shake(260, 0.008);
        break;
    }
  }

  // --- presentation --------------------------------------------------------------------------

  private readonly onPlayerCue = (event: PlayerCueEvent) => {
    const { cue, x, y, isSelf, characterId } = event;
    const sound = this.sfx;
    const at = { x, y, isSelf, characterId };
    if (cue === 'hurt') {
      // The hit lands when the victim's view enters Hurt, in sync with what is on screen.
      puff(this, x, y - HITBOX.height / 2, 0xffffff, 6);
      sound?.play('hit', at);
      if (isSelf) this.cameras.main.shake(100, 0.003);
    }
    if (cue === 'doubleJump') airPuff(this, x, y);
    sound?.play(cue, at);
  };

  private readonly onWorldCue = (event: WorldCueEvent) => {
    this.sfx?.play(event.cue, { x: event.x, y: event.y, isSelf: event.isSelf });
  };

  /** F3: the area a swing hits, while it can hit. */
  private pushReachBox(
    boxes: DebugBox[],
    body: { x: number; y: number; facing: 1 | -1; alive: boolean; attack: number; giant: number; phase: number },
    color: number,
  ): void {
    if (!isAttackActive(body, this.combat)) return;
    const scale = giantActive(body) ? ABILITIES.giant.reachMultiplier : 1;
    const reach = attackReachBox(body, hitboxOf(body, SIZES), this.combat, scale);
    boxes.push({ ...reach, color, ghost: true });
  }

  // --- level construction --------------------------------------------------------------------

  private readonly onLoadError = (file: Phaser.Loader.File) => {
    this.failedFiles.add(file.key);
  };

  private queueTilesetImages(data: unknown): void {
    const tilesets = (data as Partial<TiledMap> | null)?.tilesets;
    if (!Array.isArray(tilesets)) return;
    for (const def of tilesets) {
      if (!def?.image || def.source) continue;
      const key = tilesetKey(def);
      if (this.textures.exists(key)) continue;
      // Tiled stores image paths relative to the map file.
      this.load.image(key, new URL(def.image, this.mapUrl).href);
    }
  }

  private tilesetTexture(def: TiledTileset): string {
    const key = tilesetKey(def);
    if (def.image && this.textures.exists(key) && !this.failedFiles.has(key)) return key;
    const fallback = `${key}:fallback`;
    if (!this.textures.exists(fallback)) {
      this.textures.addCanvas(fallback, fallbackTilesetCanvas(def));
      this.services.bridge.emit('level:warning', {
        message: `Tileset image "${def.image ?? def.name}" could not be loaded; using generated placeholder tiles.`,
      });
    }
    return fallback;
  }

  private buildTilemap(json: TiledMap): void {
    if (!this.cache.tilemap.exists(this.mapKey)) {
      this.cache.tilemap.add(this.mapKey, { format: Phaser.Tilemaps.Formats.TILED_JSON, data: json });
    }
    const map = this.make.tilemap({ key: this.mapKey });
    const tilesets: Phaser.Tilemaps.Tileset[] = [];
    for (const def of json.tilesets) {
      if (!def.name || def.source) continue;
      const tileset = map.addTilesetImage(
        def.name,
        this.tilesetTexture(def),
        def.tilewidth ?? map.tileWidth,
        def.tileheight ?? map.tileHeight,
        def.margin ?? 0,
        def.spacing ?? 0,
      );
      if (tileset) tilesets.push(tileset);
    }
    map.layers.forEach((layer, index) => {
      const props = propertiesToRecord(layer.properties as TiledProperty[]);
      const baseName = layer.name.split('/').pop()?.toLowerCase();
      // Collision-only layers are data, not art.
      if (!layer.visible || props.collision === true || baseName === 'collision') return;
      const created = map.createLayer(layer.name, tilesets, 0, 0);
      if (!created) return;
      created.setAlpha(layer.alpha);
      created.setDepth(props.foreground === true ? VIEW_CONFIG.depth.foreground : VIEW_CONFIG.depth.tiles + index * 0.01);
    });
  }

  private setupCamera(level: LevelData): void {
    const camera = this.cameras.main;
    camera.setBackgroundColor(level.backgroundColor ?? VIEW_CONFIG.backgroundColor);
    // Maps smaller than the view are centered instead of pinned to the top-left.
    const width = Math.max(level.widthPx, VIEW_CONFIG.width);
    const height = Math.max(level.heightPx, VIEW_CONFIG.height);
    camera.setBounds((level.widthPx - width) / 2, (level.heightPx - height) / 2, width, height);
    camera.setDeadzone(VIEW_CONFIG.camera.deadzoneWidth, VIEW_CONFIG.camera.deadzoneHeight);
    camera.setRoundPixels(true);
  }

  // --- misc ----------------------------------------------------------------------------------

  private slotColor(playerId: string): number {
    const player = this.services.client.room?.players.find((p) => p.id === playerId);
    return slotStyle(player?.slot ?? 0).color;
  }

  private slotCss(playerId: string): string {
    const player = this.services.client.room?.players.find((p) => p.id === playerId);
    return slotStyle(player?.slot ?? 0).css;
  }

  private reportStats(frameMs: number): void {
    this.frameCount += 1;
    this.statsElapsed += frameMs;
    if (this.statsElapsed < VIEW_CONFIG.statsIntervalMs) return;
    this.fps = Math.round((this.frameCount * 1000) / this.statsElapsed);
    this.frameCount = 0;
    this.statsElapsed = 0;
    const { client, bridge } = this.services;
    if (!bridge.debug || !this.predictor) return;
    const newest = this.interpolator.newestTick;
    bridge.emit('net:stats', {
      fps: this.fps,
      rttMs: client.rttMs === null ? null : Math.round(client.rttMs),
      pendingInputs: this.predictor.pendingCount,
      correctionPx: this.predictor.lastCorrection,
      interpAheadMs: newest !== null ? (newest - this.remoteRenderTick) * TICK_MS : 0,
      serverTick: client.latestWorld?.tick ?? 0,
      remotePlayers: Math.max(0, this.views.size - 1),
    });
  }

  private devSnapshot(): Record<string, unknown> {
    const body = this.predictor?.current;
    const selfId = this.services.client.playerId;
    const selfView = selfId ? this.views.get(selfId) : undefined;
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      levelId: this.entry?.id ?? null,
      run: this.info?.run ?? null,
      local: body
        ? {
            x: round(body.x),
            y: round(body.y),
            vx: round(body.vx),
            vy: round(body.vy),
            grounded: body.grounded,
            airJumpsLeft: body.airJumpsLeft,
            alive: body.alive,
            facing: body.facing,
            attack: round(body.attack),
            attackSeq: body.attackSeq,
            hurt: round(body.hurt),
            stepTick: body.stepTick,
            ability: body.ability,
            specialHeld: body.specialHeld,
            serverPhase: this.predictor?.lastServer?.phase ?? null,
            phase: body.phase,
            phaseTime: round(body.phaseTime),
            specialCooldown: round(body.specialCooldown),
            giant: round(body.giant),
            held: body.held,
            flight: round(body.flight),
            drone: { x: round(body.droneX), y: round(body.droneY), cargo: body.cargo },
            grab: this.predictor?.lastServer?.grab ?? '',
            maxHp: this.predictor?.lastServer?.maxHp ?? null,
            hp: this.predictor?.lastServer?.hp ?? null,
            invulnUntil: this.predictor?.lastServer?.invulnUntil ?? null,
            state: selfView?.state ?? null,
            character: selfView?.characterId ?? null,
          }
        : null,
      players: [...this.views].map(([id, view]) => ({ id, self: id === selfId, state: view.state, character: view.characterId })),
      traps: this.traps ? { count: this.traps.traps.length, state: this.traps.toNet() } : null,
      pendingInputs: this.predictor?.pendingCount ?? 0,
      correctionPx: round(this.predictor?.lastCorrection ?? 0),
      views: this.views.size,
      fps: this.fps,
      debug: this.services.bridge.debug,
      menuOpen: this.services.bridge.menuOpen,
    };
  }

  private showLoadingBar(): void {
    const { width, height } = VIEW_CONFIG;
    const bar = this.add.graphics();
    const draw = (progress: number) => {
      bar.clear();
      bar.fillStyle(0x2a3052, 1).fillRect(width / 2 - 120, height / 2 - 4, 240, 8);
      bar.fillStyle(0x7c8cff, 1).fillRect(width / 2 - 120, height / 2 - 4, 240 * progress, 8);
    };
    draw(0);
    this.load.on(Phaser.Loader.Events.PROGRESS, draw);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.load.off(Phaser.Loader.Events.PROGRESS, draw);
      bar.destroy();
    });
  }

  private showError(message: string): void {
    this.services.bridge.emit('scene:error', { message });
    this.add
      .text(VIEW_CONFIG.width / 2, VIEW_CONFIG.height / 2, message, {
        fontFamily: VIEW_CONFIG.label.fontFamily,
        fontSize: '14px',
        color: '#ff5d73',
        align: 'center',
        wordWrap: { width: VIEW_CONFIG.width - 80 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
  }
}
