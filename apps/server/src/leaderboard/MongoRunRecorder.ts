import {
  LEADERBOARD_RANK_CAP,
  type CharacterId,
  type GameMode,
  type LeaderboardEntry,
  type RunKind,
  type RunRecordInfo,
} from '@platformer/shared';
import { MongoClient, type Collection, type Filter } from 'mongodb';
import type { Logger } from '../log';
import type { BoardQuery, RunInput, RunRecorder } from './RunRecorder';
import { entrantKey } from './runs';

/** A stored run (collection `runs`). */
export interface RunDoc {
  kind: RunKind;
  mode: GameMode;
  levelId: string | null;
  checksum: string;
  timeMs: number;
  entrant: string;
  names: string[];
  characters: CharacterId[];
  playerCount: number;
  solo: boolean;
  deaths: number;
  roomId: string;
  createdAt: Date;
}

export interface MongoRunRecorderOptions {
  uri: string;
  dbName: string;
  log: Logger;
  /** Collection name (tests use a throwaway one). */
  collection?: string;
}

/**
 * Leaderboard on MongoDB. Every finished run is stored as one document; boards group them by
 * entrant and keep each entrant's fastest run. The client connects lazily on the first operation,
 * so an unreachable database only costs a logged warning, never the game.
 */
export class MongoRunRecorder implements RunRecorder {
  readonly enabled = true;
  private readonly client: MongoClient;
  private readonly runs: Collection<RunDoc>;
  private readonly log: Logger;

  constructor(options: MongoRunRecorderOptions) {
    this.client = new MongoClient(options.uri, { appName: 'platformer-server', serverSelectionTimeoutMS: 5000 });
    this.runs = this.client.db(options.dbName).collection<RunDoc>(options.collection ?? 'runs');
    this.log = options.log;
  }

  /** Creates the indexes (idempotent). Resolves false when the database can't be reached. */
  async init(): Promise<boolean> {
    try {
      await this.runs.createIndexes([
        { key: { kind: 1, mode: 1, levelId: 1, checksum: 1, solo: 1, timeMs: 1 }, name: 'board' },
        { key: { kind: 1, mode: 1, levelId: 1, checksum: 1, entrant: 1, timeMs: 1 }, name: 'entrant_best' },
      ]);
      return true;
    } catch (error) {
      this.log.warn(`leaderboard database unavailable: ${describeError(error)}`);
      return false;
    }
  }

  async record(runs: readonly RunInput[]): Promise<RunRecordInfo[]> {
    const out: RunRecordInfo[] = [];
    for (const run of runs) {
      try {
        out.push(await this.recordOne(run));
      } catch (error) {
        this.log.warn(`could not record ${run.kind} run (${run.levelId ?? run.mode}): ${describeError(error)}`);
      }
    }
    return out;
  }

  async board(query: BoardQuery): Promise<LeaderboardEntry[]> {
    const match: Filter<RunDoc> = {
      kind: query.kind,
      mode: query.mode,
      levelId: query.levelId,
      checksum: query.checksum,
      ...(query.solo ? { solo: true } : {}),
    };
    const docs = await this.runs
      .aggregate<RunDoc>([
        { $match: match },
        { $sort: { timeMs: 1, createdAt: 1 } },
        { $group: { _id: '$entrant', best: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$best' } },
        { $sort: { timeMs: 1, createdAt: 1 } },
        { $limit: query.limit },
      ])
      .toArray();
    return docs.map((doc, i) => ({
      rank: i + 1,
      names: doc.names,
      characters: doc.characters,
      timeMs: doc.timeMs,
      playerCount: doc.playerCount,
      deaths: doc.deaths,
      createdAt: doc.createdAt.toISOString(),
    }));
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private async recordOne(run: RunInput): Promise<RunRecordInfo> {
    const entrant = entrantKey(run.names);
    const boardFilter: Filter<RunDoc> = {
      kind: run.kind,
      mode: run.mode,
      levelId: run.levelId,
      checksum: run.checksum,
    };
    const previous = await this.runs.findOne({ ...boardFilter, entrant }, { sort: { timeMs: 1 }, projection: { timeMs: 1 } });
    const personalBest = !previous || run.timeMs < previous.timeMs;

    await this.runs.insertOne({
      kind: run.kind,
      mode: run.mode,
      levelId: run.levelId,
      checksum: run.checksum,
      timeMs: run.timeMs,
      entrant,
      names: run.names,
      characters: run.characters,
      playerCount: run.playerCount,
      solo: run.playerCount === 1,
      deaths: run.deaths,
      roomId: run.roomId,
      createdAt: new Date(),
    });

    // Place this time would take on the all-players board: one more than the entrants with a faster best.
    const [faster] = await this.runs
      .aggregate<{ n: number }>([
        { $match: { ...boardFilter, entrant: { $ne: entrant }, timeMs: { $lt: run.timeMs } } },
        { $group: { _id: '$entrant' } },
        { $count: 'n' },
      ])
      .toArray();
    const rank = (faster?.n ?? 0) + 1;
    // A world record beats (not ties) every other stored time, the entrant's own included.
    const tiedOrBetter = await this.runs.countDocuments({ ...boardFilter, timeMs: { $lte: run.timeMs } }, { limit: 2 });

    return {
      kind: run.kind,
      levelId: run.levelId,
      playerIds: run.playerIds,
      timeMs: run.timeMs,
      rank: rank <= LEADERBOARD_RANK_CAP ? rank : null,
      personalBest,
      worldRecord: tiedOrBetter === 1,
    };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
