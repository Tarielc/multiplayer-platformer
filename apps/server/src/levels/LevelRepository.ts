import { watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  levelChecksum,
  parseManifestLevel,
  resolveMovement,
  MOVEMENT_TUNING,
  type CompiledMovement,
  type LevelData,
  type LevelIssue,
  type LevelManifest,
  type LevelManifestEntry,
} from '@platformer/shared';
import type { Logger } from '../log';

export interface ServerLevel {
  entry: LevelManifestEntry;
  data: LevelData;
  checksum: string;
  movement: CompiledMovement;
  issues: LevelIssue[];
}

export interface LevelLoadReport {
  id: string;
  file: string;
  issues: LevelIssue[];
  ok: boolean;
}

/** Read-only view the rooms depend on (easy to fake in tests). */
export interface LevelSource {
  get(id: string): ServerLevel | undefined;
}

/**
 * Loads every level in the manifest from the data directory, parses + validates it with
 * the shared pipeline, and caches the result. In development it hot-reloads maps on save;
 * new level runs pick up the change while running worlds keep their copy.
 */
export class LevelRepository implements LevelSource {
  private readonly levels = new Map<string, ServerLevel>();
  private watcher: FSWatcher | null = null;

  constructor(
    readonly dataDir: string,
    private readonly manifest: LevelManifest,
    private readonly log: Logger,
  ) {}

  get(id: string): ServerLevel | undefined {
    return this.levels.get(id);
  }

  list(): ServerLevel[] {
    return [...this.levels.values()];
  }

  async loadAll(): Promise<LevelLoadReport[]> {
    const reports: LevelLoadReport[] = [];
    for (const entry of this.manifest.entries) {
      const { level, report } = await this.loadOne(entry);
      reports.push(report);
      if (level) this.levels.set(entry.id, level);
    }
    return reports;
  }

  private async loadOne(entry: LevelManifestEntry): Promise<{ level: ServerLevel | null; report: LevelLoadReport }> {
    const file = join(this.dataDir, entry.map);
    let json: unknown;
    try {
      json = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      const message = error instanceof SyntaxError ? `Invalid JSON: ${error.message}` : `Cannot read ${file}: ${String(error)}`;
      return { level: null, report: { id: entry.id, file, ok: false, issues: [{ severity: 'error', message }] } };
    }
    const { level, issues } = parseManifestLevel(json, entry);
    const report: LevelLoadReport = { id: entry.id, file, ok: level !== null, issues };
    if (!level) return { level: null, report };
    return {
      level: {
        entry,
        data: level,
        checksum: levelChecksum(level),
        movement: resolveMovement(MOVEMENT_TUNING, entry.tuning),
        issues,
      },
      report,
    };
  }

  /** Dev hot reload: re-parses levels when files under the data dir change. */
  watch(): () => void {
    if (this.watcher) return () => this.unwatch();
    let timer: NodeJS.Timeout | undefined;
    this.watcher = watch(this.dataDir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void this.reload(), 200);
    });
    this.log.info(`watching ${this.dataDir} for level changes`);
    return () => this.unwatch();
  }

  private unwatch(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  private async reload(): Promise<void> {
    for (const entry of this.manifest.entries) {
      const previous = this.levels.get(entry.id);
      const { level, report } = await this.loadOne(entry);
      if (!level) {
        this.log.error(`reload of "${entry.id}" failed; keeping previous version`);
        for (const issue of report.issues) this.log.error(`  [${issue.severity}] ${issue.message}`);
        continue;
      }
      if (previous?.checksum !== level.checksum) {
        this.levels.set(entry.id, level);
        this.log.info(`reloaded "${entry.id}" (checksum ${level.checksum})`);
      }
    }
  }
}

export function formatLevelReports(reports: LevelLoadReport[]): string {
  return reports
    .map((r) => {
      const head = `${r.ok ? 'OK  ' : 'FAIL'} ${r.id}  (${r.file})`;
      const lines = r.issues.map((i) => `       [${i.severity}] ${i.message}`);
      return [head, ...lines].join('\n');
    })
    .join('\n');
}
