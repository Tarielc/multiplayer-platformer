import {
  ABILITY_NAMES,
  MODE_CONFIG,
  PLAYER_CONFIG,
  abilityForCharacter,
  ordinal,
  slotStyle,
  type CharacterId,
  type GameEvent,
  type NetWorldState,
  type RoomInfo,
} from '@platformer/shared';
import type { ConnectionStatus, FatalError, GameClient, WorldUpdate } from './GameClient';

export interface HudPlayer {
  id: string;
  name: string;
  slot: number;
  label: string;
  color: string;
  characterId: CharacterId;
  isSelf: boolean;
  isHost: boolean;
  connected: boolean;
  menuOpen: boolean;
  score: number;
  deaths: number;
  alive: boolean;
  atExit: boolean;
  /** Race: finishing place (1-based) once at the trophy; 0 while racing (and in co-op). */
  place: number;
  /** Hearts left (traps cost one) out of `maxHp`. */
  hp: number;
  maxHp: number;
  /** Special ability: name, seconds until it can be used again (0 = ready), in use now. */
  ability: { name: string; cooldown: number; active: boolean };
}

export interface Notice {
  id: number;
  kind: 'info' | 'warn' | 'error';
  text: string;
}

export interface RoomView {
  status: ConnectionStatus;
  fatal: FatalError | null;
  room: RoomInfo | null;
  /** performance.now() when `room` arrived (countdowns are relative to it). */
  roomReceivedAt: number;
  selfId: string | null;
  hud: HudPlayer[];
  rttMs: number | null;
  notices: Notice[];
}

const INITIAL_VIEW: RoomView = {
  status: 'idle',
  fatal: null,
  room: null,
  roomReceivedAt: 0,
  selfId: null,
  hud: [],
  rttMs: null,
  notices: [],
};

/**
 * React-facing view model over a GameClient, for `useSyncExternalStore`.
 *
 * World updates arrive at 20 Hz; the store folds them into the HUD digest (scores, alive,
 * at-exit) and only publishes a new snapshot when something visible changed, so React does
 * not re-render on every network packet. Everything real-time stays in Phaser.
 */
export class RoomStore {
  private view: RoomView = INITIAL_VIEW;
  private readonly listeners = new Set<() => void>();
  private hudKey = '';
  private noticeId = 0;
  private readonly unsubscribe: Array<() => void> = [];

  constructor(private readonly client: GameClient) {
    const { events } = client;
    this.unsubscribe.push(
      events.on('status', (status) => this.patch({ status })),
      events.on('fatal', (fatal) => this.patch({ fatal })),
      events.on('welcome', (welcome) => this.patch({ selfId: welcome.playerId })),
      events.on('room', (room) => this.onRoom(room)),
      events.on('world', (update) => this.onWorld(update)),
      events.on('rtt', (rtt) => {
        const rounded = Math.round(rtt);
        if (rounded !== this.view.rttMs) this.patch({ rttMs: rounded });
      }),
      events.on('notice', (notice) => this.notify('warn', notice.message)),
    );
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): RoomView => this.view;

  readonly getServerSnapshot = (): RoomView => INITIAL_VIEW;

  notify(kind: Notice['kind'], text: string): void {
    const notice: Notice = { id: ++this.noticeId, kind, text };
    this.patch({ notices: [...this.view.notices.slice(-4), notice] });
  }

  dismiss(id: number): void {
    if (!this.view.notices.some((n) => n.id === id)) return;
    this.patch({ notices: this.view.notices.filter((n) => n.id !== id) });
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.listeners.clear();
  }

  private onRoom(room: RoomInfo): void {
    const previous = this.view.room;
    if (previous) this.announceChanges(previous, room);
    this.patch({ room, roomReceivedAt: performance.now() });
    this.updateHud(room, room.level ? this.client.latestWorld : null, true);
  }

  private onWorld(update: WorldUpdate): void {
    for (const event of update.events) this.announceEvent(event);
    this.updateHud(this.view.room, update.state);
  }

  /** Toasts for world events everyone should hear about (race finishes). */
  private announceEvent(event: GameEvent): void {
    if (event.type !== 'finish') return;
    if (event.playerId === this.view.selfId) {
      this.notify('info', `You finished ${ordinal(event.place)}!`);
      return;
    }
    const player = this.view.room?.players.find((p) => p.id === event.playerId);
    const who = player ? `${slotStyle(player.slot).label} ${player.name}` : 'Someone';
    this.notify('info', `${who} finished ${ordinal(event.place)}!`);
  }

  private announceChanges(previous: RoomInfo, room: RoomInfo): void {
    if (previous.mode !== room.mode) this.notify('info', `Mode: ${MODE_CONFIG[room.mode].name}`);
    const before = new Map(previous.players.map((p) => [p.id, p]));
    const selfId = this.view.selfId;
    for (const player of room.players) {
      const old = before.get(player.id);
      before.delete(player.id);
      if (player.id === selfId) continue;
      const who = `${slotStyle(player.slot).label} ${player.name}`;
      if (!old) this.notify('info', `${who} joined`);
      else if (old.connected && !player.connected) this.notify('warn', `${who} lost connection`);
      else if (!old.connected && player.connected) this.notify('info', `${who} reconnected`);
    }
    for (const gone of before.values()) {
      if (gone.id !== selfId) this.notify('info', `${slotStyle(gone.slot).label} ${gone.name} left`);
    }
  }

  private updateHud(room: RoomInfo | null, world: NetWorldState | null, force = false): void {
    if (!room) return;
    const states = new Map((world?.players ?? []).map((p) => [p.id, p]));
    const hud: HudPlayer[] = room.players.map((p) => {
      const s = states.get(p.id);
      const style = slotStyle(p.slot);
      return {
        id: p.id,
        name: p.name,
        slot: p.slot,
        label: style.label,
        color: style.css,
        characterId: p.characterId,
        isSelf: p.id === this.view.selfId,
        isHost: p.isHost,
        connected: p.connected,
        menuOpen: p.menuOpen,
        score: s?.score ?? 0,
        deaths: s?.deaths ?? 0,
        alive: s?.alive ?? true,
        atExit: s?.atExit ?? false,
        place: s?.place ?? 0,
        hp: s?.hp ?? PLAYER_CONFIG.maxHp,
        maxHp: s?.maxHp ?? PLAYER_CONFIG.maxHp,
        ability: {
          name: ABILITY_NAMES[abilityForCharacter(p.characterId)],
          // Tenths of a second keep HUD updates rare while a cooldown runs.
          cooldown: Math.ceil((s?.specialCooldown ?? 0) * 10) / 10,
          active: (s?.phase ?? 0) !== 0 || (s?.giant ?? 0) > 0,
        },
      };
    });
    const key = JSON.stringify(hud);
    if (!force && key === this.hudKey) return;
    this.hudKey = key;
    this.patch({ hud });
  }

  private patch(partial: Partial<RoomView>): void {
    this.view = { ...this.view, ...partial };
    for (const listener of this.listeners) listener();
  }
}
