import { MAX_PLAYERS } from '../config/players';
import { cellAt } from '../sim/collision';
import type { LevelManifestEntry } from '../levels/manifest';
import { LevelFormatError, parseTiledLevel, type ParseLevelOptions } from './parse';
import { CellFlag, type LevelData, type LevelIssue } from './types';

/** Semantic checks on a parsed level. Errors make the level unplayable; warnings are advisory. */
export function validateLevel(level: LevelData): LevelIssue[] {
  const issues: LevelIssue[] = [];
  const error = (message: string) => issues.push({ severity: 'error', message });
  const warn = (message: string) => issues.push({ severity: 'warning', message });

  if (level.spawns.length === 0) error('No spawn points. Add a point object with class "spawn" to an object layer.');
  else if (level.spawns.length < MAX_PLAYERS) {
    warn(`Only ${level.spawns.length} spawn point(s); extra players share spawn points.`);
  }
  if (level.exits.length === 0) warn('No exit zone. The level can only be finished with the dev "skip level" command.');

  const ts = level.tileSize;
  for (const spawn of level.spawns) {
    const col = Math.floor(spawn.x / ts);
    const row = Math.floor((spawn.y - 1) / ts);
    if (spawn.x < 0 || spawn.x > level.widthPx || spawn.y < 0 || spawn.y > level.heightPx) {
      error(`Spawn for slot ${spawn.slot} at (${spawn.x}, ${spawn.y}) is outside the map.`);
    } else if (cellAt(level, col, row) & CellFlag.SOLID) {
      warn(`Spawn for slot ${spawn.slot} at (${spawn.x}, ${spawn.y}) is inside a solid tile.`);
    }
  }

  const outside = (x: number, y: number) => x < 0 || y < 0 || x > level.widthPx || y > level.heightPx;
  for (const zone of [...level.checkpoints, ...level.exits, ...level.hazards]) {
    if (outside(zone.x, zone.y) || outside(zone.x + zone.width, zone.y + zone.height)) {
      warn(`Object #${zone.id} "${zone.name}" extends outside the map.`);
    }
  }
  for (const c of level.collectibles) {
    if (outside(c.x, c.y)) warn(`Collectible #${c.id} is outside the map.`);
  }
  for (const obj of level.extraObjects) {
    warn(`Object #${obj.id} has unknown class "${obj.kind || '(none)'}" and is ignored by the engine.`);
  }
  return issues;
}

export interface LoadedLevel {
  level: LevelData | null;
  issues: LevelIssue[];
}

/** Parse + validate in one step, converting format errors into issues. */
export function parseAndValidateLevel(json: unknown, options: ParseLevelOptions): LoadedLevel {
  try {
    const level = parseTiledLevel(json, options);
    const issues = validateLevel(level);
    return { level: issues.some((i) => i.severity === 'error') ? null : level, issues };
  } catch (err) {
    if (err instanceof LevelFormatError) return { level: null, issues: [{ severity: 'error', message: err.message }] };
    throw err;
  }
}

export function parseManifestLevel(json: unknown, entry: LevelManifestEntry): LoadedLevel {
  const options: ParseLevelOptions = { id: entry.id, name: entry.name };
  if (entry.backgroundColor !== undefined) options.backgroundColor = entry.backgroundColor;
  return parseAndValidateLevel(json, options);
}
