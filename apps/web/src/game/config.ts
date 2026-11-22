/**
 * Client-only presentation tuning (camera, rendering, effects). Gameplay numbers live in
 * `@platformer/shared` config so the server and prediction agree on them.
 */
export interface ViewConfig {
  width: number;
  height: number;
  backgroundColor: string;
  camera: { lerp: number; deadzoneWidth: number; deadzoneHeight: number };
  /** Parallax backdrop layers (procedural textures from BootScene). */
  parallax: { texture: string; scrollFactor: number; alpha: number; y: number }[];
  label: { fontFamily: string; fontSize: number; offsetY: number };
  squash: { landX: number; landY: number; jumpX: number; jumpY: number; durationMs: number };
  /** Blinking while invulnerable after a trap hit: on/off period and the dimmed alpha. */
  invulnerable: { blinkPeriodMs: number; blinkAlpha: number };
  /** Player animation state machine thresholds (px/s). */
  animation: { runEnterSpeed: number; runExitSpeed: number };
  collectible: { bobPx: number; bobMs: number };
  lavaScrollPxPerSec: number;
  /** Longest frame fed to the fixed-step accumulator (tab switches, breakpoints). */
  maxFrameMs: number;
  /** Max fixed steps per rendered frame before the backlog is dropped. */
  maxStepsPerFrame: number;
  statsIntervalMs: number;
  depth: {
    backdrop: number;
    tiles: number;
    entities: number;
    players: number;
    foreground: number;
    effects: number;
    debug: number;
  };
}

export const VIEW_CONFIG: Readonly<ViewConfig> = {
  width: 960,
  height: 540,
  backgroundColor: '#10131f',
  camera: { lerp: 0.14, deadzoneWidth: 96, deadzoneHeight: 72 },
  parallax: [
    { texture: 'bg-far', scrollFactor: 0.15, alpha: 0.55, y: 0.38 },
    { texture: 'bg-near', scrollFactor: 0.35, alpha: 0.7, y: 0.52 },
  ],
  label: { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 10, offsetY: 8 },
  squash: { landX: 1.12, landY: 0.88, jumpX: 0.9, jumpY: 1.1, durationMs: 110 },
  invulnerable: { blinkPeriodMs: 70, blinkAlpha: 0.25 },
  animation: { runEnterSpeed: 20, runExitSpeed: 10 },
  collectible: { bobPx: 3, bobMs: 900 },
  lavaScrollPxPerSec: 12,
  maxFrameMs: 250,
  maxStepsPerFrame: 8,
  statsIntervalMs: 250,
  depth: { backdrop: -100, tiles: 0, entities: 10, players: 20, foreground: 30, effects: 40, debug: 100 },
};
