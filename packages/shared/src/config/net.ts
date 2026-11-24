/** Bumped whenever the wire protocol changes incompatibly. Checked on join. */
export const PROTOCOL_VERSION = 10;

export interface NetConfig {
  /** Fixed simulation rate shared by server authority and client prediction. */
  tickRate: number;
  /** World snapshot/delta broadcasts per second. Must divide tickRate. */
  snapshotRate: number;
  /** How far behind "now" remote players are rendered (absorbs jitter). */
  interpolationDelayMs: number;
  /** A full snapshot is broadcast every N snapshots; deltas in between. */
  keyframeEverySnapshots: number;
  input: {
    /** Max queued input frames per player before the oldest are dropped. */
    maxQueue: number;
    /** Max inputs a player may "bank" while late (catch-up burst, anti speed-hack). */
    burstBudget: number;
    /** Hard cap on inputs consumed for one player in a single tick. */
    maxPerTick: number;
    /** After this many ticks without input, the server steps the player with neutral input. */
    stallTicks: number;
  };
  room: {
    countdownMs: number;
    levelCompleteMs: number;
    /** Disconnected players keep their slot this long (refresh, flaky network, Strict Mode). */
    reconnectGraceMs: number;
    /** Empty rooms are deleted after this long. */
    emptyRoomTtlMs: number;
    codeLength: number;
    minPlayersToStart: number;
    /** Players may join a room whose level is already running. */
    allowDropIn: boolean;
  };
  client: {
    pingIntervalMs: number;
    /** Unacknowledged inputs kept for reconciliation. */
    maxPendingInputs: number;
    /** Prediction errors larger than this snap instead of smoothing (px). */
    snapDistance: number;
    /** Half-life of the visual error-smoothing offset. */
    correctionHalfLifeMs: number;
    reconnectAttempts: number;
  };
  limits: {
    maxMessageBytes: number;
    /** Non-input messages per second per connection. */
    messagesPerSecond: number;
    maxInvalidMessages: number;
    heartbeatIntervalMs: number;
  };
}

export const NET_CONFIG: Readonly<NetConfig> = {
  tickRate: 60,
  snapshotRate: 20,
  interpolationDelayMs: 100,
  keyframeEverySnapshots: 60,
  input: {
    maxQueue: 30,
    burstBudget: 6,
    maxPerTick: 3,
    stallTicks: 15,
  },
  room: {
    countdownMs: 3000,
    levelCompleteMs: 4000,
    reconnectGraceMs: 15000,
    emptyRoomTtlMs: 60000,
    codeLength: 5,
    minPlayersToStart: 1,
    allowDropIn: true,
  },
  client: {
    pingIntervalMs: 2000,
    maxPendingInputs: 180,
    snapDistance: 64,
    correctionHalfLifeMs: 60,
    reconnectAttempts: 8,
  },
  limits: {
    maxMessageBytes: 8 * 1024,
    messagesPerSecond: 30,
    maxInvalidMessages: 20,
    heartbeatIntervalMs: 10000,
  },
};

export const TICK_MS = 1000 / NET_CONFIG.tickRate;
export const TICK_DT = 1 / NET_CONFIG.tickRate;
export const SNAPSHOT_EVERY_TICKS = Math.max(1, Math.round(NET_CONFIG.tickRate / NET_CONFIG.snapshotRate));

export function msToTicks(ms: number): number {
  return Math.max(0, Math.round(ms / TICK_MS));
}

export function ticksToMs(ticks: number): number {
  return ticks * TICK_MS;
}
