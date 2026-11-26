import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { LEVELS, NET_CONFIG, TICK_MS } from '@platformer/shared';
import { loadEnv } from './env';
import { createHttpHandler } from './http';
import { MongoRunRecorder } from './leaderboard/MongoRunRecorder';
import { NullRunRecorder, type RunRecorder } from './leaderboard/RunRecorder';
import { LevelRepository, formatLevelReports } from './levels/LevelRepository';
import { createLogger, setLogLevel } from './log';
import { FixedTickLoop } from './loop/FixedTickLoop';
import { SocketGateway } from './net/SocketGateway';
import { RoomManager } from './rooms/RoomManager';

async function main(): Promise<void> {
  const env = loadEnv();
  setLogLevel(env.logLevel);
  const log = createLogger('server');

  // 1. Levels: parse + validate every manifest entry up front; refuse to start on errors.
  const levels = new LevelRepository(env.dataDir, LEVELS, log.child('levels'));
  const reports = await levels.loadAll();
  const failed = reports.filter((r) => !r.ok);
  if (failed.length > 0) {
    log.error(`level validation failed:\n${formatLevelReports(reports)}`);
    process.exit(1);
  }
  for (const report of reports) {
    for (const issue of report.issues) log.warn(`${report.id}: ${issue.message}`);
  }
  log.info(`loaded ${reports.length} level(s) from ${env.dataDir}`);
  const stopWatching = env.watchLevels ? levels.watch() : () => {};

  // 2. Leaderboard: optional. Without MONGODB_URI (or with the database down) the game still runs.
  let recorder: RunRecorder = new NullRunRecorder();
  if (env.mongoUri) {
    const mongo = new MongoRunRecorder({ uri: env.mongoUri, dbName: env.mongoDb, log: log.child('leaderboard') });
    recorder = mongo;
    if (await mongo.init()) log.info(`leaderboard: MongoDB database "${env.mongoDb}"`);
  } else {
    log.info('leaderboard off (set MONGODB_URI in apps/server/.env to enable it)');
  }

  // 3. Rooms + the single fixed-rate loop that ticks all of them.
  const rooms = new RoomManager({
    levels,
    manifest: LEVELS,
    devCommands: env.devCommands,
    maxRooms: env.maxRooms,
    autoCreate: env.autoCreateRooms,
    recorder,
    log: log.child('rooms'),
  });
  const loop = new FixedTickLoop(TICK_MS, () => rooms.tick(), {
    onLag: (ms) => log.warn(`tick loop fell ${Math.round(ms)} ms behind; dropping backlog`),
  });

  // 4. HTTP API + WebSocket endpoint on one port.
  const gateway = new SocketGateway({ rooms, log: log.child('ws'), allowedOrigins: env.allowedOrigins });
  const server = createServer(
    createHttpHandler({
      rooms,
      levels,
      corsOrigin: env.corsOrigin,
      connections: () => gateway.connectionCount,
      leaderboard: recorder,
      log: log.child('http'),
    }),
  );
  server.on('upgrade', gateway.handleUpgrade);
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') log.error(`port ${env.port} is already in use (set PORT in apps/server/.env)`);
    else log.error(`HTTP server error: ${error.message}`);
    process.exit(1);
  });

  server.listen(env.port, env.host, () => {
    loop.start();
    log.info(`listening on http://localhost:${env.port}  (ws path /ws, ${NET_CONFIG.tickRate} Hz tick)`);
    for (const address of lanAddresses()) log.info(`  LAN: http://${address}:${env.port}`);
    log.info(`dev commands ${env.devCommands ? 'enabled' : 'disabled'}; auto-create rooms ${env.autoCreateRooms ? 'on' : 'off'}`);
  });

  // 5. Graceful shutdown: tell clients, close sockets, stop the loop.
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`${signal} received, shutting down`);
    loop.stop();
    stopWatching();
    rooms.shutdown();
    gateway.close();
    void recorder.close().catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((info) => info && info.family === 'IPv4' && !info.internal)
    .map((info) => info!.address);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
