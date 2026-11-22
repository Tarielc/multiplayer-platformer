import type { GameClient } from '@/net/GameClient';
import type { GameBridge } from './bridge';

/**
 * Everything scenes need from the outside world, injected at construction. Owned by React:
 * these outlive any single Phaser.Game (e.g. the socket survives a game being re-created).
 */
export interface GameServices {
  client: GameClient;
  bridge: GameBridge;
  /** Base URL of the synced data folder (maps/, tilesets/). */
  assetBase: string;
}

export const DEFAULT_ASSET_BASE = '/assets';
