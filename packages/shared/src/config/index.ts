import { CHARACTERS } from './characters';
import { COMBAT_TUNING } from './combat';
import { ENTITY_CONFIG } from './entities';
import { MOVEMENT_TUNING } from './movement';
import { NET_CONFIG } from './net';
import { PLAYER_CONFIG, PLAYER_SLOTS } from './players';

export * from './characters';
export * from './combat';
export * from './entities';
export * from './movement';
export * from './net';
export * from './players';

/** Every tunable in one typed object (handy for debug panels and logging). */
export const GAME_CONFIG = {
  movement: MOVEMENT_TUNING,
  combat: COMBAT_TUNING,
  players: PLAYER_CONFIG,
  slots: PLAYER_SLOTS,
  characters: CHARACTERS,
  entities: ENTITY_CONFIG,
  net: NET_CONFIG,
} as const;
