import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoClient } from 'mongodb';
import { silentLogger } from '../log';
import { MongoRunRecorder } from './MongoRunRecorder';
import type { RunInput } from './RunRecorder';

/** Runs against a real MongoDB only when MONGODB_URI_TEST is set (uses a throwaway collection). */
const uri = process.env.MONGODB_URI_TEST;

describe.skipIf(!uri)('MongoRunRecorder (live database)', () => {
  const collection = `runs_test_${Date.now()}`;
  const dbName = 'platformer_test';
  let recorder: MongoRunRecorder;

  const run = (names: string[], timeMs: number, playerCount = names.length): RunInput => ({
    kind: 'level',
    mode: 'race',
    levelId: 'race-1',
    checksum: 'abcd1234',
    timeMs,
    playerIds: names.map((n) => `id-${n}`),
    names,
    characters: names.map(() => 'ninja-frog' as const),
    playerCount,
    deaths: 0,
    roomId: 'TEST1',
  });
  const query = { kind: 'level' as const, mode: 'race' as const, levelId: 'race-1', checksum: 'abcd1234', solo: false, limit: 10 };

  beforeAll(async () => {
    recorder = new MongoRunRecorder({ uri: uri!, dbName, collection, log: silentLogger });
    expect(await recorder.init()).toBe(true);
  });

  afterAll(async () => {
    await recorder?.close();
    const client = new MongoClient(uri!);
    await client.db(dbName).collection(collection).drop().catch(() => {});
    await client.close();
  });

  it('ranks runs, flags personal bests and world records, and keeps one row per entrant', async () => {
    expect(await recorder.record([run(['Moss'], 5000, 1)])).toEqual([
      expect.objectContaining({ rank: 1, personalBest: true, worldRecord: true, playerIds: ['id-Moss'] }),
    ]);
    expect(await recorder.record([run(['Fern'], 6000, 2)])).toEqual([
      expect.objectContaining({ rank: 2, personalBest: true, worldRecord: false }),
    ]);
    expect(await recorder.record([run(['moss'], 5500, 1)])).toEqual([
      expect.objectContaining({ rank: 1, personalBest: false, worldRecord: false }),
    ]);
    expect(await recorder.record([run(['Fern'], 4000, 2)])).toEqual([
      expect.objectContaining({ rank: 1, personalBest: true, worldRecord: true }),
    ]);

    const board = await recorder.board(query);
    expect(board.map((e) => [e.rank, e.names[0], e.timeMs])).toEqual([
      [1, 'Fern', 4000],
      [2, 'Moss', 5000],
    ]);
    const solo = await recorder.board({ ...query, solo: true });
    expect(solo.map((e) => e.names[0])).toEqual(['Moss']);
    expect(await recorder.board({ ...query, checksum: 'other' })).toEqual([]);
  });
});
