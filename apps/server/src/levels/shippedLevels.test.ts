import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameWorld, LEVELS, MAX_PLAYERS, defineLevels, msToTicks, type GameEvent } from '@platformer/shared';
import { asciiToTiledMap } from '@platformer/shared/dev';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultDataDir } from '../env';
import { silentLogger } from '../log';
import { LevelRepository } from './LevelRepository';

// Loads the real data directory, so every level added to the manifest is covered automatically.
const repository = new LevelRepository(defaultDataDir(), LEVELS, silentLogger);
const reports = await repository.loadAll();

describe('shipped levels', () => {
  it('every manifest level loads without errors', () => {
    expect(reports.map((r) => r.id)).toEqual(LEVELS.entries.map((e) => e.id));
    for (const report of reports) {
      expect(report.issues.filter((i) => i.severity === 'error'), report.file).toEqual([]);
      expect(report.ok, report.file).toBe(true);
    }
  });

  it.each(LEVELS.entries.map((e) => e.id))('%s: every player slot spawns safely and lands', (id) => {
    const level = repository.get(id)!;
    const world = new GameWorld({ level: level.data, movement: level.movement });
    for (let slot = 0; slot < MAX_PLAYERS; slot++) world.addPlayer(`p${slot}`, slot);

    const events: GameEvent[] = [];
    for (let tick = 0; tick < msToTicks(3000); tick++) {
      for (const player of world.listPlayers()) world.stepPlayer(player.id, 0);
      world.endTick();
      events.push(...world.drainEvents());
    }
    expect(events.filter((e) => e.type === 'death')).toEqual([]);
    for (const player of world.listPlayers()) expect(player.body, `slot ${player.slot}`).toMatchObject({ alive: true, grounded: true });
  });
});

describe('LevelRepository', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function dataDir(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'platformer-levels-'));
    dirs.push(dir);
    await mkdir(join(dir, 'maps'));
    await Promise.all(Object.entries(files).map(([name, content]) => writeFile(join(dir, 'maps', name), content)));
    return dir;
  }

  const manifest = defineLevels([
    { id: 'good', name: 'Good', map: 'maps/good.json', next: null },
    { id: 'broken', name: 'Broken', map: 'maps/broken.json', next: null },
    { id: 'missing', name: 'Missing', map: 'maps/missing.json', next: null },
  ]);

  it('reports unreadable or invalid maps without failing the valid ones', async () => {
    const dir = await dataDir({
      'good.json': JSON.stringify(asciiToTiledMap({ rows: [' 1  E', '#####'] })),
      'broken.json': '{ "layers": [',
    });
    const repo = new LevelRepository(dir, manifest, silentLogger);
    const result = await repo.loadAll();
    expect(result.map((r) => [r.id, r.ok])).toEqual([
      ['good', true],
      ['broken', false],
      ['missing', false],
    ]);
    expect(result[1]!.issues[0]!.message).toMatch(/Invalid JSON/);
    expect(result[2]!.issues[0]!.message).toMatch(/Cannot read/);
    expect(repo.get('good')?.checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(repo.get('broken')).toBeUndefined();
  });
});
