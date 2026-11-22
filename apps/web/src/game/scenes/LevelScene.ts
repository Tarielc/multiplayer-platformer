import {
  LEVELS,
  MOVEMENT_TUNING,
  NET_CONFIG,
  NEUTRAL_INPUT,
  PLAYER_CONFIG,
  TICK_DT,
  TICK_MS,
  TrapField,
  TypedEmitter,
  attackReachBox,
  defaultCharacterForSlot,
  isAttackActive,
  levelChecksum,
  parseTiledLevel,
  propertiesToRecord,
  resolveCombat,
  resolveMovement,
  slotStyle,
  type CompiledCombat,
  type GameEvent,
  type LevelData,
  type LevelManifestEntry,
  type MovementContext,
  type NetWorldState,
  type RoomInfo,
  type RoomLevelInfo,
  type TiledMap,
  type TiledProperty,
  type TiledTileset,
} from '@platformer/shared';
import * as Phaser from 'phaser';
import { devVirtualButtons, registerDevProvider } from '@/devtools/devHook';
import type { WorldUpdate } from '@/net/GameClient';
import { Interpolator } from '@/net/Interpolator';
import { LocalPredictor } from '@/net/LocalPredictor';
import { fallbackTilesetCanvas } from '../art/tilesetFallback';
import { SoundController } from '../audio/SoundController';
import { VIEW_CONFIG } from '../config';
import { DebugDraw, type DebugBox } from '../debug/DebugDraw';
import { InputController } from '../input/InputController';
import { signalsFromBody, signalsFromSample } from '../player/playerSignals';
import type { PlayerCueEvent, PresentationEvents, WorldCueEvent } from '../presentation';
import type { GameServices } from '../services';
import { listen, onSceneEnd } from '../util/listen';
import { Backdrop } from '../views/Backdrop';
import { EntityViews } from '../views/EntityViews';
import { floatText, puff } from '../views/effects';
import { PlayerView } from '../views/PlayerView';
import { TrapViews } from '../traps/TrapViews';
import { SCENE_KEYS } from './keys';

const INTERPOLATION_DELAY_TICKS = NET_CONFIG.interpolationDelayMs / TICK_MS;
const HITBOX = PLAYER_CONFIG.hitbox;

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
  private trapViews: TrapViews | null = null;
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
    };
    this.predictor = new LocalPredictor(ctx);
    const sound = new SoundController(this, bridge.audio);
    this.sfx = sound;
    this.presentation.on('player', this.onPlayerCue);
    this.presentation.on('world', this.onWorldCue);

    this.setupCamera(level);
    this.backdrop = new Backdrop(this);
    this.buildTilemap(json as TiledMap);
    this.entityViews = new EntityViews(this, level);
    this.trapViews = new TrapViews(this, traps, (event) => this.presentation.emit('world', event));
    this.debugDraw = new DebugDraw(this, level, HITBOX);
    this.debugDraw.setVisible(bridge.debug);
    this.controls = new InputController(this, () => bridge.emit('input:menu'));
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
    const { predictor, controls, entityViews, trapViews } = this;
    if (!predictor || !controls || !entityViews || !trapViews) return;
    const { client, bridge } = this.services;
    const now = performance.now();
    const frameMs = Math.min(now - this.lastFrame, VIEW_CONFIG.maxFrameMs);
    this.lastFrame = now;
    controls.pollMenu();

    // Fixed-step prediction at the server's tick rate.
    const room = client.room;
    const simulate = room?.phase === 'playing' && !room.paused && client.isOpen && predictor.ready;
    if (simulate) {
      this.accumulator += frameMs;
      let steps = 0;
      while (this.accumulator >= TICK_MS) {
        if (steps === VIEW_CONFIG.maxStepsPerFrame) {
          this.accumulator = 0;
          break;
        }
        const buttons = bridge.menuOpen ? NEUTRAL_INPUT : controls.sample() | devVirtualButtons();
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
    if (local && position && body) {
      const signals = signalsFromBody(body, predictor.teleports);
      const server = predictor.lastServer;
      local.setInvulnerable(server !== null && server.invulnUntil > server.stepTick);
      local.render(position.x + HITBOX.width / 2, position.y + HITBOX.height, body.facing, signals, frameMs);
      if (!this.cameraSnapped) {
        this.cameras.main.centerOn(local.container.x, local.container.y);
        this.cameraSnapped = true;
      }
      if (debug) {
        const color = slotStyle(client.slot ?? 0).color;
        boxes.push({ x: position.x, y: position.y, color });
        this.pushReachBox(boxes, { ...body, x: position.x, y: position.y }, color);
        const ghost = predictor.lastServer;
        if (ghost) boxes.push({ x: ghost.x, y: ghost.y, color: 0xffffff, ghost: true });
      }
    }

    const renderTick = client.clock.tickAt(now) - INTERPOLATION_DELAY_TICKS;
    this.remoteRenderTick = renderTick;
    const samples = this.interpolator.sample(renderTick);
    for (const [id, view] of this.views) {
      if (id === selfId) continue;
      const s = samples.get(id);
      if (!s) continue;
      view.setInvulnerable(s.invulnUntil > renderTick);
      view.render(s.x + HITBOX.width / 2, s.y + HITBOX.height, s.facing, signalsFromSample(s), frameMs);
      if (debug) {
        boxes.push({ x: s.x, y: s.y, color: this.slotColor(id) });
        this.pushReachBox(boxes, s, this.slotColor(id));
      }
    }

    // Traps are drawn at the local player's predicted tick: where they are when you meet them.
    trapViews.update(predictor.renderTick(alpha) ?? renderTick, frameMs);
    if (debug) trapViews.debugBoxes(boxes);
    entityViews.update(frameMs);
    this.backdrop?.update(this.cameras.main);
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
    if (me) predictor.reconcile(me, state.traps);
    else this.traps?.applyNet(state.traps);

    for (const event of events) this.playEvent(event, state);
    entityViews.sync(state);
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
    if (isSelf) {
      const { lerp } = VIEW_CONFIG.camera;
      this.cameras.main.startFollow(view.container, true, lerp, lerp);
    }
    return view;
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
            cue: event.kind === 'gem' ? 'gem' : 'coin',
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
      case 'bounce':
        if (event.playerId !== selfId) this.trapViews?.bounce(event.trapId, false);
        break;
      case 'boxHit':
        this.trapViews?.boxHit(event.boxId, event.broken, event.playerId === selfId);
        break;
      case 'levelComplete': {
        // React shows the results overlay.
        const camera = this.cameras.main;
        this.presentation.emit('world', { cue: 'levelComplete', x: camera.midPoint.x, y: camera.midPoint.y, isSelf: true });
        break;
      }
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
    sound?.play(cue, at);
  };

  private readonly onWorldCue = (event: WorldCueEvent) => {
    this.sfx?.play(event.cue, { x: event.x, y: event.y, isSelf: event.isSelf });
  };

  /** F3: the area a swing hits, while it can hit. */
  private pushReachBox(
    boxes: DebugBox[],
    body: { x: number; y: number; facing: 1 | -1; alive: boolean; attack: number },
    color: number,
  ): void {
    if (!isAttackActive(body, this.combat)) return;
    const reach = attackReachBox(body, HITBOX, this.combat);
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
            alive: body.alive,
            facing: body.facing,
            attack: round(body.attack),
            attackSeq: body.attackSeq,
            hurt: round(body.hurt),
            stepTick: body.stepTick,
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
