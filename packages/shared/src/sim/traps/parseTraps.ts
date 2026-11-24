import { msToTicks, TICK_DT } from '../../config/net';
import { TRAP_CONFIG, type CompiledTraps } from '../../config/traps';
import { LevelFormatError } from '../../level/errors';
import type { PropertyValue } from '../../level/tiled';
import { CellFlag, type LevelData } from '../../level/types';
import type { Rect } from '../../util/math';
import { cellAt } from '../collision';
import { accelTime } from './motion';
import { BUTTON_ACTIONS, DIR4, SWITCHABLE_KINDS, type ButtonAction, type Dir4, type TrapDef, type TrapKind } from './types';

/** A Tiled object whose class is a trap kind. Position is the top-left (or the point). */
export interface TrapObject {
  id: number;
  kind: TrapKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  point: boolean;
  properties: Record<string, PropertyValue>;
}

const KIND_ALIASES: Record<string, TrapKind> = {
  spikes: 'spikes',
  spike: 'spikes',
  trampoline: 'trampoline',
  saw: 'saw',
  fallingplatform: 'fallingPlatform',
  fan: 'fan',
  rockhead: 'rockHead',
  spikehead: 'spikeHead',
  box: 'box',
  button: 'button',
  pressureplate: 'button',
};

/** Trap kind for a Tiled class name (case, spaces, `-` and `_` ignored), or null. */
export function trapKindOf(objectClass: string): TrapKind | null {
  return KIND_ALIASES[objectClass.toLowerCase().replace(/[\s_-]/g, '')] ?? null;
}

const EPS = 1e-6;

/**
 * Resolves trap objects into simulation definitions: defaults from `config`, per-object
 * properties, positions, and rock-head walls (scanned from the level's solid cells).
 * Throws `LevelFormatError` for objects that can't work.
 */
export function parseTraps(objects: readonly TrapObject[], level: LevelData, config: Readonly<CompiledTraps> = TRAP_CONFIG): TrapDef[] {
  const traps = objects.map((obj) => parseTrap(obj, level, config)).sort((a, b) => a.id - b.id);
  linkButtons(objects, traps);
  return traps;
}

/**
 * Resolves each button's targets: every property named `target…` or `link…` holds a Tiled
 * object reference (an id), or a string of object names or ids separated by commas. A name
 * links every trap with that name.
 */
function linkButtons(objects: readonly TrapObject[], traps: TrapDef[]): void {
  const byId = new Map(traps.map((t) => [t.id, t]));
  for (const obj of objects) {
    if (obj.kind !== 'button') continue;
    const button = byId.get(obj.id);
    if (button?.kind !== 'button') continue;
    const where = `button "${obj.name}" (id ${obj.id}) at (${Math.round(obj.x)}, ${Math.round(obj.y)})`;
    const ids = new Set<number>();
    for (const [key, value] of Object.entries(obj.properties)) {
      const name = key.toLowerCase();
      if (!name.startsWith('target') && !name.startsWith('link')) continue;
      const refs = typeof value === 'number' ? [value] : typeof value === 'string' ? value.split(',').map((r) => r.trim()).filter(Boolean) : [];
      for (const ref of refs) {
        const matches =
          typeof ref === 'number'
            ? traps.filter((t) => t.id === ref)
            : traps.filter((t) => t.name.trim() === ref || (/^\d+$/.test(ref) && t.id === Number(ref)));
        if (matches.length === 0) throw new LevelFormatError(`${where}: "${key}" names no trap ("${ref}")`);
        for (const target of matches) {
          if (!SWITCHABLE_KINDS.includes(target.kind)) {
            throw new LevelFormatError(`${where}: can't switch ${target.kind} "${target.name}" (id ${target.id}); it links to ${SWITCHABLE_KINDS.join(', ')}`);
          }
          ids.add(target.id);
        }
      }
    }
    if (ids.size === 0) throw new LevelFormatError(`${where}: no "target" property linking it to a trap`);
    button.targets = [...ids].sort((a, b) => a - b);
  }
}

function parseTrap(obj: TrapObject, level: LevelData, cfg: Readonly<CompiledTraps>): TrapDef {
  const where = `${obj.kind} "${obj.name}" (id ${obj.id}) at (${Math.round(obj.x)}, ${Math.round(obj.y)})`;
  const props = obj.properties;
  const num = (name: string, fallback: number): number => {
    const value = props[name];
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new LevelFormatError(`${where}: property "${name}" must be a number`);
    return value;
  };
  const ticks = (name: string, fallbackTicks: number): number =>
    props[name] === undefined ? fallbackTicks : msToTicks(Math.max(0, num(name, 0)));
  const dir = (fallback: Dir4): Dir4 => {
    const value = props.dir ?? fallback;
    if (typeof value !== 'string' || !DIR4.includes(value as Dir4)) {
      throw new LevelFormatError(`${where}: "dir" must be one of ${DIR4.join(', ')}`);
    }
    return value as Dir4;
  };
  const sized = !obj.point && obj.width > 0 && obj.height > 0;
  /** Fixed-size body: a point marks its bottom-centre, a rectangle its top-left. */
  const body = (width: number, height: number): Rect =>
    sized ? { x: obj.x, y: obj.y, width, height } : { x: obj.x - width / 2, y: obj.y - height, width, height };
  const common = { id: obj.id, name: obj.name };

  switch (obj.kind) {
    case 'spikes': {
      const t = cfg.spikes.tile;
      const rect = sized ? { x: obj.x, y: obj.y, width: obj.width, height: obj.height } : body(t, t);
      return { ...common, kind: 'spikes', ...rect, dir: dir('up') };
    }
    case 'trampoline':
      return {
        ...common,
        kind: 'trampoline',
        ...body(cfg.trampoline.width, cfg.trampoline.height),
        launch: num('launch', cfg.trampoline.launch),
      };
    case 'saw': {
      let a = { x: obj.x, y: obj.y };
      let b = a;
      if (sized) {
        // The track runs along the rectangle's long axis, through its middle.
        if (obj.width >= obj.height) {
          a = { x: obj.x, y: obj.y + obj.height / 2 };
          b = { x: obj.x + obj.width, y: a.y };
        } else {
          a = { x: obj.x + obj.width / 2, y: obj.y };
          b = { x: a.x, y: obj.y + obj.height };
        }
      }
      const speed = num('speed', cfg.saw.speed);
      if (!(speed > 0)) throw new LevelFormatError(`${where}: "speed" must be > 0`);
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const periodTicks = length > 0 ? Math.max(2, Math.round((2 * length) / speed / TICK_DT)) : 0;
      return {
        ...common,
        kind: 'saw',
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        radius: num('radius', cfg.saw.radius),
        periodTicks,
        phaseTicks: ticks('phaseMs', 0),
      };
    }
    case 'fallingPlatform':
      return {
        ...common,
        kind: 'fallingPlatform',
        ...body(cfg.fallingPlatform.width, cfg.fallingPlatform.height),
        delayTicks: ticks('delayMs', cfg.fallingPlatform.delayTicks),
      };
    case 'fan': {
      const d = dir('up');
      const vertical = d === 'up' || d === 'down';
      const rect = vertical ? body(cfg.fan.width, cfg.fan.height) : body(cfg.fan.height, cfg.fan.width);
      const range = num('range', cfg.fan.range);
      const sw = cfg.fan.streamWidth;
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const stream: Rect =
        d === 'up'
          ? { x: cx - sw / 2, y: rect.y - range, width: sw, height: range }
          : d === 'down'
            ? { x: cx - sw / 2, y: rect.y + rect.height, width: sw, height: range }
            : d === 'left'
              ? { x: rect.x - range, y: cy - sw / 2, width: range, height: sw }
              : { x: rect.x + rect.width, y: cy - sw / 2, width: range, height: sw };
      return {
        ...common,
        kind: 'fan',
        ...rect,
        dir: d,
        stream,
        onTicks: ticks('onMs', cfg.fan.onTicks),
        offTicks: ticks('offMs', cfg.fan.offTicks),
        phaseTicks: ticks('phaseMs', 0),
      };
    }
    case 'rockHead': {
      const axisValue = props.axis ?? 'x';
      if (axisValue !== 'x' && axisValue !== 'y') throw new LevelFormatError(`${where}: "axis" must be "x" or "y"`);
      const axis = axisValue;
      const d = dir(axis === 'x' ? 'right' : 'down');
      if ((axis === 'x') !== (d === 'left' || d === 'right')) {
        throw new LevelFormatError(`${where}: "dir" ${d} does not run along axis ${axis}`);
      }
      const size = cfg.rockHead.size;
      const rect = body(size, size);
      const [low, high] = rockHeadLimits(rect, axis, level, where);
      const forward = d === 'right' || d === 'down';
      const from = forward ? low : high;
      const to = forward ? high : low;
      const length = Math.abs(to - from);
      if (length < 1) throw new LevelFormatError(`${where}: no room to move along ${axis} (walls are touching it)`);
      const accel = cfg.rockHead.accel;
      const maxSpeed = cfg.rockHead.maxSpeed;
      const travelTicks = Math.max(1, Math.ceil(accelTime(length, accel, maxSpeed) / TICK_DT - EPS));
      const waitTicks = ticks('waitMs', cfg.rockHead.waitTicks);
      // Start where it was placed: if that's mid-way, begin mid-flight towards `to`.
      const start = axis === 'x' ? rect.x : rect.y;
      const fromStart = Math.abs(start - from);
      const startPhase = fromStart < 0.5 ? 0 : waitTicks + Math.round(accelTime(fromStart, accel, maxSpeed) / TICK_DT);
      return {
        ...common,
        kind: 'rockHead',
        axis,
        x: rect.x,
        y: rect.y,
        width: size,
        height: size,
        from,
        to,
        waitTicks,
        travelTicks,
        accel,
        maxSpeed,
        phaseTicks: startPhase + ticks('phaseMs', 0),
      };
    }
    case 'spikeHead':
      return { ...common, kind: 'spikeHead', ...body(cfg.spikeHead.size, cfg.spikeHead.size) };
    case 'box': {
      const variant = num('variant', 1);
      if (variant !== 1 && variant !== 2 && variant !== 3) throw new LevelFormatError(`${where}: "variant" must be 1, 2 or 3`);
      return {
        ...common,
        kind: 'box',
        ...body(cfg.box.width, cfg.box.height),
        variant,
        maxHits: cfg.box.hits[variant - 1]!,
      };
    }
    case 'button': {
      const action = props.action ?? 'on';
      if (typeof action !== 'string' || !BUTTON_ACTIONS.includes(action as ButtonAction)) {
        throw new LevelFormatError(`${where}: "action" must be one of ${BUTTON_ACTIONS.join(', ')}`);
      }
      // Targets are resolved once every trap is parsed (`linkButtons`).
      return { ...common, kind: 'button', ...body(cfg.button.width, cfg.button.height), targets: [], action: action as ButtonAction };
    }
  }
}

/** Lowest and highest top-left coordinate on `axis` before the body touches a solid cell. */
function rockHeadLimits(rect: Rect, axis: 'x' | 'y', level: LevelData, where: string): [number, number] {
  const ts = level.tileSize;
  const solid = (col: number, row: number) => (cellAt(level, col, row) & CellFlag.SOLID) !== 0;
  if (axis === 'x') {
    const r0 = Math.floor(rect.y / ts);
    const r1 = Math.floor((rect.y + rect.height - EPS) / ts);
    const blocked = (col: number) => {
      for (let row = r0; row <= r1; row++) if (solid(col, row)) return true;
      return false;
    };
    // Columns outside the map count as solid, so both scans always end.
    let right = Math.ceil((rect.x + rect.width - EPS) / ts);
    while (!blocked(right)) right++;
    let left = Math.floor((rect.x + EPS) / ts) - 1;
    while (!blocked(left)) left--;
    const low = (left + 1) * ts;
    const high = right * ts - rect.width;
    if (rect.x < low - EPS || rect.x > high + EPS) throw new LevelFormatError(`${where}: placed inside a wall`);
    return [low, high];
  }
  const c0 = Math.floor(rect.x / ts);
  const c1 = Math.floor((rect.x + rect.width - EPS) / ts);
  const blocked = (row: number) => {
    for (let col = c0; col <= c1; col++) if (solid(col, row)) return true;
    return false;
  };
  let down = Math.ceil((rect.y + rect.height - EPS) / ts);
  while (down < level.heightTiles && !blocked(down)) down++;
  if (down >= level.heightTiles) throw new LevelFormatError(`${where}: no solid floor below it to slam into`);
  let up = Math.floor((rect.y + EPS) / ts) - 1;
  while (up >= 0 && !blocked(up)) up--;
  if (up < 0) throw new LevelFormatError(`${where}: no solid ceiling above it to slam into`);
  const low = (up + 1) * ts;
  const high = down * ts - rect.height;
  if (rect.y < low - EPS || rect.y > high + EPS) throw new LevelFormatError(`${where}: placed inside a wall`);
  return [low, high];
}
