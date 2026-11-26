import { MODE_CONFIG, type GameMode, type LeaderboardResponse, type LevelManifest } from '@platformer/shared';
import type { LevelSource } from '../levels/LevelRepository';
import type { RunRecorder } from './RunRecorder';
import { campaignChecksum } from './runs';

export interface LeaderboardRequest {
  mode: GameMode;
  solo: boolean;
  limit: number;
}

/** Every board of one mode's campaign: the whole-campaign board plus one per level, in play order. */
export async function buildLeaderboard(
  recorder: RunRecorder,
  manifest: LevelManifest,
  levels: LevelSource,
  request: LeaderboardRequest,
): Promise<LeaderboardResponse> {
  if (!recorder.enabled) return { enabled: false };
  const { mode, solo, limit } = request;
  const entries = manifest.campaign(mode);
  const checksums = entries.map((entry) => levels.get(entry.id)?.checksum ?? null);

  const levelBoards = await Promise.all(
    entries.map(async (entry, i) => {
      const checksum = checksums[i];
      return {
        levelId: entry.id,
        name: entry.name,
        entries: checksum ? await recorder.board({ kind: 'level', mode, levelId: entry.id, checksum, solo, limit }) : [],
      };
    }),
  );
  const loaded = checksums.every((c): c is string => c !== null);
  const campaign = {
    levelId: null,
    name: `${MODE_CONFIG[mode].name} campaign`,
    entries:
      loaded && entries.length > 0
        ? await recorder.board({ kind: 'campaign', mode, levelId: null, checksum: campaignChecksum(checksums), solo, limit })
        : [],
  };
  return { enabled: true, mode, solo, campaign, levels: levelBoards };
}
