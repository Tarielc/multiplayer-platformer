/**
 * Headless test clients: `npm run bots -- --room ABCDE --count 3`
 *
 * Each bot joins the room, readies up and sends one scripted input per simulation tick
 * (run right, jump when stuck), exactly like a browser would. Useful for 4-player testing on
 * one machine and for rough load tests. Without --room a new room is created and printed.
 *
 * Options: --url ws://localhost:3001/ws  --room CODE  --count 3  --name Bot  --no-ready
 *          --seconds N (leave and exit after N seconds; default: run until Ctrl+C)
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  Button,
  PROTOCOL_VERSION,
  TICK_MS,
  applyWorldDelta,
  jsonCodec,
  slotStyle,
  type ClientMessage,
  type NetWorldState,
  type RoomInfo,
  type ServerMessage,
} from '@platformer/shared';
import { WebSocket } from 'ws';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'ws://localhost:3001/ws' },
    room: { type: 'string', short: 'r' },
    count: { type: 'string', short: 'n', default: '3' },
    name: { type: 'string', default: 'Bot' },
    'no-ready': { type: 'boolean', default: false },
    seconds: { type: 'string', short: 's' },
  },
});

const wsUrl = values.url;
const count = Math.max(1, Math.min(8, Number.parseInt(values.count, 10) || 1));

class Bot {
  private socket: WebSocket | null = null;
  private room: RoomInfo | null = null;
  private state: NetWorldState | null = null;
  private playerId: string | null = null;
  private seq = 0;
  private timer: NodeJS.Timeout | null = null;
  private dir = Button.RIGHT;
  private bestX = -Infinity;
  private stuck = 0;
  private jumpHold = 0;
  private sentReady = false;
  done = false;

  constructor(
    readonly index: number,
    private readonly roomId: string,
    private readonly onDone: () => void,
  ) {}

  private get tag(): string {
    return `[${values.name}${this.index + 1}]`;
  }

  start(): void {
    const socket = new WebSocket(wsUrl);
    this.socket = socket;
    socket.on('open', () =>
      this.send({
        t: 'join',
        protocol: PROTOCOL_VERSION,
        roomId: this.roomId,
        name: `${values.name}${this.index + 1}`,
        clientId: `bot-${randomBytes(8).toString('hex')}`,
      }),
    );
    socket.on('message', (data) => {
      const message = jsonCodec.decode(String(data)) as ServerMessage | undefined;
      if (message) this.onMessage(message);
    });
    socket.on('close', (code, reason) => {
      console.log(`${this.tag} disconnected (${code}${reason.length ? ` ${reason.toString()}` : ''})`);
      this.stop();
    });
    socket.on('error', (error) => console.log(`${this.tag} socket error: ${error.message}`));
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.done) return;
    this.done = true;
    if (this.timer) clearInterval(this.timer);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.send({ t: 'leave' });
      this.socket.close();
    }
    this.onDone();
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(jsonCodec.encode(message));
  }

  private onMessage(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        this.playerId = message.playerId;
        console.log(`${this.tag} joined ${message.roomId} as ${slotStyle(message.slot).label}`);
        break;
      case 'room': {
        const previous = this.room;
        this.room = message.room;
        const me = message.room.players.find((p) => p.id === this.playerId);
        if (message.room.phase !== 'lobby') {
          this.sentReady = false; // re-ready when the room returns to the lobby
        } else if (me && !me.ready && !this.sentReady && !values['no-ready']) {
          this.sentReady = true;
          this.send({ t: 'ready', ready: true });
        }
        if (previous?.phase !== message.room.phase) console.log(`${this.tag} phase: ${message.room.phase}`);
        if (message.room.level?.run !== previous?.level?.run) this.resetRun();
        break;
      }
      case 'snapshot':
        if (message.run === this.room?.level?.run) this.state = message.state;
        break;
      case 'delta':
        if (message.run !== this.room?.level?.run) break;
        if (this.state && this.state.tick === message.baseTick) {
          this.state = applyWorldDelta(this.state, message.tick, message);
        } else {
          this.state = null;
          this.send({ t: 'resync' });
        }
        break;
      case 'error':
        console.log(`${this.tag} server error ${message.code}: ${message.message}`);
        break;
      case 'pong':
        break;
    }
  }

  private resetRun(): void {
    this.state = null;
    this.bestX = -Infinity;
    this.stuck = 0;
    this.jumpHold = 0;
    this.dir = Button.RIGHT;
  }

  /** Scripted "AI": run, jump when progress stalls, occasionally turn around. */
  private tick(): void {
    if (this.room?.phase !== 'playing' || this.room.paused) return;
    const me = this.state?.players.find((p) => p.id === this.playerId);
    if (me) {
      const progress = this.dir === Button.RIGHT ? me.x : -me.x;
      if (progress > this.bestX + 2) {
        this.bestX = progress;
        this.stuck = 0;
      } else {
        this.stuck += 1;
      }
      if (this.stuck > 240) {
        this.dir = this.dir === Button.RIGHT ? Button.LEFT : Button.RIGHT;
        this.bestX = -Infinity;
        this.stuck = 0;
      }
    }
    let buttons = this.dir;
    if (this.jumpHold > 0) {
      buttons |= Button.JUMP;
      this.jumpHold -= 1;
    } else if (this.stuck > 12 || Math.random() < 0.015) {
      this.jumpHold = 8 + Math.floor(Math.random() * 16);
    }
    this.seq += 1;
    this.send({ t: 'input', seq: this.seq, buttons });
  }
}

async function createRoom(): Promise<string> {
  const httpUrl = wsUrl.replace(/^ws/, 'http').replace(/\/ws\/?$/, '');
  const response = await fetch(`${httpUrl}/rooms`, { method: 'POST' });
  if (!response.ok) throw new Error(`POST /rooms failed: ${response.status}`);
  const body = (await response.json()) as { roomId: string };
  return body.roomId;
}

const roomId = values.room ? values.room.toUpperCase() : await createRoom();
console.log(`Room ${roomId}: starting ${count} bot(s) against ${wsUrl}`);
if (!values.room) console.log(`Open http://localhost:3000/room/${roomId} to join them.`);

let running = count;
const bots: Bot[] = [];
const onDone = () => {
  running -= 1;
  if (running <= 0) process.exit(0);
};
for (let i = 0; i < count; i++) {
  const bot = new Bot(i, roomId, onDone);
  bots.push(bot);
  // Stagger joins so slots are assigned in order.
  setTimeout(() => bot.start(), i * 150);
}

function stopAll(): void {
  for (const bot of bots) bot.stop();
  setTimeout(() => process.exit(0), 200);
}

process.on('SIGINT', stopAll);
const seconds = Number.parseFloat(values.seconds ?? '');
if (Number.isFinite(seconds) && seconds > 0) {
  setTimeout(() => {
    console.log(`${seconds}s elapsed, leaving.`);
    stopAll();
  }, seconds * 1000);
}
