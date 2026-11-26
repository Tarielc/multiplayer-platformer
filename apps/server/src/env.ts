import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { LogLevel } from './log';

export interface ServerEnv {
  port: number;
  host: string;
  /** Value for Access-Control-Allow-Origin on the HTTP API. */
  corsOrigin: string;
  /** If set, WebSocket upgrades from other origins are rejected. */
  allowedOrigins: string[] | null;
  /** Folder holding maps/ and tilesets/ (defaults to the shared package's data folder). */
  dataDir: string;
  /** Enables dev-only client commands (skip level, respawn). */
  devCommands: boolean;
  /** Hot-reload levels when map files change. */
  watchLevels: boolean;
  /** Joining an unknown room code creates it (invite links survive server restarts). */
  autoCreateRooms: boolean;
  maxRooms: number;
  logLevel: LogLevel;
  isProduction: boolean;
  /** MongoDB connection string for the leaderboard; `null` turns the leaderboard off. */
  mongoUri: string | null;
  /** Database holding the leaderboard's `runs` collection. */
  mongoDb: string;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const n = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** `<@platformer/shared>/data`, resolved through node_modules so it works from src and dist. */
export function defaultDataDir(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('@platformer/shared/package.json')), 'data');
}

export function loadEnv(): ServerEnv {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: defaults below apply.
  }
  const env = process.env;
  const isProduction = env.NODE_ENV === 'production';
  const origins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const level = (env.LOG_LEVEL ?? 'info') as LogLevel;
  return {
    port: int(env.PORT, 3001),
    host: env.HOST || '0.0.0.0',
    corsOrigin: env.CORS_ORIGIN || '*',
    allowedOrigins: origins.length ? origins : null,
    dataDir: env.DATA_DIR ? resolve(env.DATA_DIR) : defaultDataDir(),
    devCommands: bool(env.DEV_COMMANDS, !isProduction),
    watchLevels: bool(env.WATCH_LEVELS, !isProduction),
    autoCreateRooms: bool(env.AUTO_CREATE_ROOMS, true),
    maxRooms: int(env.MAX_ROOMS, 500),
    logLevel: ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info',
    isProduction,
    mongoUri: env.MONGODB_URI?.trim() || null,
    mongoDb: env.MONGODB_DB?.trim() || 'platformer',
  };
}
