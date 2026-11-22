/**
 * Rules for map entities placed in Tiled object layers (collectibles, hazards,
 * checkpoints, exits) and for hazard tiles.
 */
export interface CollectibleKindConfig {
  /** Score awarded on pickup (a Tiled `value` property overrides it per object). */
  value: number;
  /** Pickup radius in pixels, measured from the object's center. */
  radius: number;
}

export interface EntityConfig {
  collectibles: Record<string, CollectibleKindConfig>;
  /** Kind used when a collectible object has no `kind` property. */
  defaultCollectibleKind: string;
  /** Hazard *tiles* hurt only inside this inset box (spikes fill the lower part of a tile). */
  hazardTileHitbox: { insetX: number; insetTop: number; insetBottom: number };
  /** Players this far below the bottom of the map die (fell out of the world). */
  killPlaneMargin: number;
  /** `team`: touching a checkpoint moves everyone's respawn point. `player`: only yours. */
  checkpointScope: 'team' | 'player';
  /** `all`: every active player must stand in the exit. `any`: first player to arrive wins. */
  exitRule: 'all' | 'any';
  /** Size used when a checkpoint/exit/hazard is placed as a point object. */
  zoneDefaults: { width: number; height: number };
}

export const ENTITY_CONFIG: Readonly<EntityConfig> = {
  collectibles: {
    coin: { value: 10, radius: 11 },
    gem: { value: 50, radius: 12 },
  },
  defaultCollectibleKind: 'coin',
  hazardTileHitbox: { insetX: 4, insetTop: 14, insetBottom: 0 },
  killPlaneMargin: 96,
  checkpointScope: 'team',
  exitRule: 'all',
  zoneDefaults: { width: 32, height: 64 },
};
