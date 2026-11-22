import { TypedEmitter } from '@platformer/shared';

/** Network/perf numbers the scene reports for the debug HUD. */
export interface NetStats {
  fps: number;
  rttMs: number | null;
  /** Local inputs not yet acknowledged by the server. */
  pendingInputs: number;
  /** Size of the last prediction correction in px. */
  correctionPx: number;
  /**
   * How far the newest server state is ahead of the time remote players are drawn at.
   * Healthy is roughly 0..interpolationDelayMs; at or below 0 remote players freeze.
   */
  interpAheadMs: number;
  serverTick: number;
  remotePlayers: number;
}

/**
 * Typed React <-> Phaser channel. React owns UI state (menu, debug toggle) and pushes it in;
 * scenes report readiness, warnings and stats out. Neither side imports the other.
 */
export type BridgeEvents = {
  // Phaser -> React
  'scene:ready': { levelId: string; run: number };
  'scene:error': { message: string };
  'level:warning': { message: string };
  'net:stats': NetStats;
  /** Gamepad Start pressed (keyboard Esc is handled by React directly). */
  'input:menu': void;
  // React -> Phaser
  'ui:menu': boolean;
  'ui:debug': boolean;
};

export class GameBridge extends TypedEmitter<BridgeEvents> {
  /** Latest UI state, so scenes that start later can read it instead of waiting for an event. */
  menuOpen = false;
  debug = false;

  setMenuOpen(open: boolean): void {
    if (this.menuOpen === open) return;
    this.menuOpen = open;
    this.emit('ui:menu', open);
  }

  setDebug(enabled: boolean): void {
    if (this.debug === enabled) return;
    this.debug = enabled;
    this.emit('ui:debug', enabled);
  }
}
