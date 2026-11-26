import type { LeaderboardEntry } from '@platformer/shared';
import { describe, expect, it } from 'vitest';
import { parseLeaderboardQuery } from '../http';
import { FakeRunRecorder, TEST_LEVELS, TEST_MANIFEST } from '../test/fakes';
import { buildLeaderboard } from './boards';
import { NullRunRecorder, type BoardQuery } from './RunRecorder';
import { campaignChecksum } from './runs';

class BoardSpy extends FakeRunRecorder {
  readonly queries: BoardQuery[] = [];
  override async board(query: BoardQuery): Promise<LeaderboardEntry[]> {
    this.queries.push(query);
    return [{ rank: 1, names: ['A'], characters: ['ninja-frog'], timeMs: 1000, playerCount: 1, deaths: 0, createdAt: '2026-01-01T00:00:00.000Z' }];
  }
}

describe('leaderboard boards', () => {
  it('parses and clamps the query', () => {
    const parse = (q: string) => parseLeaderboardQuery(new URLSearchParams(q));
    expect(parse('')).toEqual({ mode: 'race', solo: false, limit: 10 });
    expect(parse('mode=coop&solo=1&limit=500')).toEqual({ mode: 'coop', solo: true, limit: 50 });
    expect(parse('limit=0')).toMatchObject({ limit: 1 });
    expect(parse('mode=deathmatch')).toBeNull();
    expect(parse('solo=yes')).toBeNull();
    expect(parse('limit=abc')).toBeNull();
  });

  it('answers disabled without a database', async () => {
    const response = await buildLeaderboard(new NullRunRecorder(), TEST_MANIFEST, TEST_LEVELS, { mode: 'race', solo: false, limit: 10 });
    expect(response).toEqual({ enabled: false });
  });

  it('builds the campaign board and one board per level, keyed by the current checksums', async () => {
    const spy = new BoardSpy();
    const response = await buildLeaderboard(spy, TEST_MANIFEST, TEST_LEVELS, { mode: 'race', solo: true, limit: 5 });
    expect(response).toMatchObject({
      enabled: true,
      mode: 'race',
      solo: true,
      campaign: { levelId: null, entries: [{ rank: 1 }] },
      levels: [{ levelId: 'sprint', name: 'Sprint' }, { levelId: 'dash', name: 'Dash' }],
    });
    const sums = ['sprint', 'dash'].map((id) => TEST_LEVELS.get(id)!.checksum);
    expect(spy.queries).toContainEqual({ kind: 'level', mode: 'race', levelId: 'sprint', checksum: sums[0], solo: true, limit: 5 });
    expect(spy.queries).toContainEqual({ kind: 'campaign', mode: 'race', levelId: null, checksum: campaignChecksum(sums), solo: true, limit: 5 });
  });
});
