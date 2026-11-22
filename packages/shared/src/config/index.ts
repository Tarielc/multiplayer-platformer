import { ENTITY_CONFIG } from './entities';
import { MOVEMENT_TUNING } from './movement';
import { NET_CONFIG } from './net';
import { PLAYER_CONFIG, PLAYER_SLOTS } from './players';

export * from './entities';
export * from './movement';
export * from './net';
export * from './players';

/** Every tunable in one typed object (handy for debug panels and logging). */
export const GAME_CONFIG = {
  movement: MOVEMENT_TUNING,
  players: PLAYER_CONFIG,
  slots: PLAYER_SLOTS,
  entities: ENTITY_CONFIG,
  net: NET_CONFIG,
} as const;
