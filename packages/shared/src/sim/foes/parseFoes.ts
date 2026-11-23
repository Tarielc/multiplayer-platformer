import { FOE_KINDS, FOE_TUNING, isFoeKind, type FoeKind, type FoeTuning } from '../../config/foes';
import { LevelFormatError } from '../../level/errors';
import type { PropertyValue } from '../../level/tiled';
import { CellFlag, type LevelData } from '../../level/types';
import { cellAt } from '../collision';
import type { FoeDef, FoeWall } from './types';

/** A foe object from the map, before it is resolved against the level. */
export interface FoeObject {
  id: number;
  kind: FoeKind;
  name: string;
  /** Top-left (rects) or the point itself. */
  x: number;
  y: number;
  width: number;
  height: number;
  point: boolean;
  properties: Record<string, PropertyValue>;
}

/**
 * The foe a Tiled object stands for: class (or name) `mushroom`, `chicken`, `wasp`, `monkey` or
 * `bull`, or class `foe` with a `kind` property. Null for anything else; throws for a `foe`
 * without a valid kind.
 */
export function foeKindOf(objectClass: string, properties: Record<string, PropertyValue>, id = 0): FoeKind | null {
  const kind = objectClass.trim().toLowerCase();
  if (isFoeKind(kind)) return kind;
  if (kind !== 'foe' && kind !== 'enemy') return null;
  const named = typeof properties.kind === 'string' ? properties.kind.trim().toLowerCase() : '';
  if (isFoeKind(named)) return named;
  throw new LevelFormatError(`Foe #${id} needs a "kind" property: one of ${FOE_KINDS.join(', ')} (got "${String(properties.kind ?? '')}")`);
}

/**
 * Resolves foe objects. Where it stands: a point marks the feet (a wasp's: the middle of its
 * body); a rectangle stands on its bottom edge (a wasp hovers in its middle). Properties:
 *  - `facing`: "left" (default) or "right".
 *  - `range`: px it strays from where it starts before turning back (patrols, a wasp's beat, a
 *    monkey's climb); 0 = no limit.
 *  - `wall` (monkey): "left", "right" or "none"; by default it clings to a wall right beside it.
 */
export function parseFoes(objects: readonly FoeObject[], level: LevelData, config: Readonly<FoeTuning> = FOE_TUNING): FoeDef[] {
  const out: FoeDef[] = [];
  for (const obj of objects) {
    const c = config[obj.kind];
    const flying = obj.kind === 'wasp';
    let x = obj.point ? obj.x : obj.x + obj.width / 2;
    let y = obj.point ? obj.y : flying ? obj.y + obj.height / 2 : obj.y + obj.height;
    if (flying) y += c.height / 2;
    const props = obj.properties;
    let facing: 1 | -1 = props.facing === 'right' || props.facing === 1 ? 1 : -1;
    const range = typeof props.range === 'number' ? Math.max(0, props.range) : c.range;
    let wall: FoeWall = 0;
    if (obj.kind === 'monkey') {
      const asked = typeof props.wall === 'string' ? props.wall.trim().toLowerCase() : '';
      if (asked && asked !== 'left' && asked !== 'right' && asked !== 'none') {
        throw new LevelFormatError(`Monkey #${obj.id}: "wall" must be "left", "right" or "none" (got "${asked}")`);
      }
      const found = asked === 'none' ? null : findWall(level, x, y - c.height / 2, c.width, asked === 'left' ? -1 : asked === 'right' ? 1 : 0);
      if (asked && asked !== 'none' && !found) {
        throw new LevelFormatError(`Monkey #${obj.id} has no wall on its ${asked} within a tile`);
      }
      if (found) {
        wall = found.side;
        // Cling: the hitbox's edge on the wall's face, looking away from it.
        x = found.face - wall * (c.width / 2);
        facing = wall === 1 ? -1 : 1;
      }
    }
    out.push({ id: obj.id, kind: obj.kind, x, y, facing, range, wall });
  }
  return out.sort((a, b) => a.id - b.id);
}

/**
 * The nearest wall face beside a body centred on (x, midY), within a tile: `side` -1 (left), 1
 * (right) or 0 (either).
 */
function findWall(level: LevelData, x: number, midY: number, width: number, side: FoeWall): { side: -1 | 1; face: number } | null {
  const ts = level.tileSize;
  const row = Math.floor(midY / ts);
  const solid = (col: number) => (cellAt(level, col, row) & CellFlag.SOLID) !== 0;
  let best = null as { side: -1 | 1; face: number; gap: number } | null;
  if (side !== 1) {
    const edge = x - width / 2;
    for (let col = Math.floor((edge - 1e-6) / ts); col >= Math.floor((edge - ts) / ts); col--) {
      if (!solid(col)) continue;
      const face = (col + 1) * ts;
      const gap = Math.abs(edge - face);
      if (!best || gap < best.gap) best = { side: -1, face, gap };
      break;
    }
  }
  if (side !== -1) {
    const edge = x + width / 2;
    for (let col = Math.floor((edge + 1e-6) / ts); col <= Math.floor((edge + ts) / ts); col++) {
      if (!solid(col)) continue;
      const face = col * ts;
      const gap = Math.abs(face - edge);
      if (!best || gap < best.gap) best = { side: 1, face, gap };
      break;
    }
  }
  return best ? { side: best.side, face: best.face } : null;
}
