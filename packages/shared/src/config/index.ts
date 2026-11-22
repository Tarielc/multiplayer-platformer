import { ABILITY_TUNING } from './abilities';
import { CHARACTERS } from './characters';
import { COMBAT_TUNING } from './combat';
import { ENTITY_CONFIG } from './entities';
import { MOVEMENT_TUNING } from './movement';
import { NET_CONFIG } from './net';
import { PLAYER_CONFIG, PLAYER_SLOTS } from './players';
import { TRAP_TUNING } from './traps';

export * from './abilities';
export * from './characters';
export * from './combat';
export * from './entities';
export * from './movement';
export * from './net';
export * from './players';
export * from './traps';

/** Every tunable in one typed object (handy for debug panels and logging). */
export const GAME_CONFIG = {
  movement: MOVEMENT_TUNING,
  combat: COMBAT_TUNING,
  abilities: ABILITY_TUNING,
  players: PLAYER_CONFIG,
  slots: PLAYER_SLOTS,
  characters: CHARACTERS,
  entities: ENTITY_CONFIG,
  traps: TRAP_TUNING,
  net: NET_CONFIG,
} as const;
