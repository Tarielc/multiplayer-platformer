/** Hard cap on players per room (slots P1..P4). */
export const MAX_PLAYERS = 4;

export interface PlayerSlotStyle {
  slot: number;
  label: string;
  /** Phaser color (0xRRGGBB). */
  color: number;
  /** CSS color for the React HUD / lobby. */
  css: string;
  /** Darker shade for outlines and shadows. */
  shade: number;
  shadeCss: string;
}

export const PLAYER_SLOTS: readonly PlayerSlotStyle[] = [
  { slot: 0, label: 'P1', color: 0xff5d73, css: '#ff5d73', shade: 0x9e2238, shadeCss: '#9e2238' },
  { slot: 1, label: 'P2', color: 0x4fc3ff, css: '#4fc3ff', shade: 0x1d5f8f, shadeCss: '#1d5f8f' },
  { slot: 2, label: 'P3', color: 0x7ee081, css: '#7ee081', shade: 0x2f7d33, shadeCss: '#2f7d33' },
  { slot: 3, label: 'P4', color: 0xffc94d, css: '#ffc94d', shade: 0x9a6a00, shadeCss: '#9a6a00' },
];

export function slotStyle(slot: number): PlayerSlotStyle {
  return PLAYER_SLOTS[slot] ?? PLAYER_SLOTS[0]!;
}

export interface PlayerConfig {
  /** Collision box in pixels. Position in the simulation is the box's top-left corner. */
  hitbox: { width: number; height: number };
  /** Delay between death and respawn. */
  respawnDelayMs: number;
  /** Hearts. Traps cost one each (see `traps.ts`); at 0 the player dies and respawns full. */
  maxHp: number;
  nameMaxLength: number;
  defaultName: string;
}

export const PLAYER_CONFIG: Readonly<PlayerConfig> = {
  hitbox: { width: 20, height: 28 },
  respawnDelayMs: 900,
  maxHp: 3,
  nameMaxLength: 16,
  defaultName: 'Player',
};
