import { Fnv1a } from '../util/hash';
import type { LevelData, LevelZone } from './types';

/**
 * Content hash of everything that affects simulation. The server sends it with the level
 * info; the client compares it with its own parse to detect stale or mismatched assets.
 */
export function levelChecksum(level: LevelData): string {
  const h = new Fnv1a();
  h.str(level.id).int(level.tileSize).int(level.widthTiles).int(level.heightTiles);
  h.bytes(level.cells);
  for (const s of level.spawns) h.int(s.slot).num(s.x).num(s.y);
  const zones = (list: LevelZone[], tag: string) => {
    h.str(tag);
    for (const z of list) h.int(z.id).num(z.x).num(z.y).num(z.width).num(z.height);
  };
  zones(level.checkpoints, 'cp');
  zones(level.exits, 'ex');
  zones(level.hazards, 'hz');
  h.str('col');
  for (const c of level.collectibles) h.int(c.id).str(c.kind).num(c.x).num(c.y).num(c.value).num(c.radius);
  h.str('trap');
  for (const trap of level.traps) hashValue(h, trap);
  return h.digest();
}

/** Hashes plain data (numbers, strings, nested objects) in a key order that never changes. */
function hashValue(h: Fnv1a, value: unknown): void {
  if (typeof value === 'number') h.num(value);
  else if (typeof value === 'string') h.str(value);
  else if (typeof value === 'boolean') h.int(value ? 1 : 0);
  else if (value && typeof value === 'object') {
    for (const key of Object.keys(value).sort()) {
      h.str(key);
      hashValue(h, (value as Record<string, unknown>)[key]);
    }
  }
}
