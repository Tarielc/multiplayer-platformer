# 2D Platformer Template

A data-driven starter for online 2D platformers with **1–4 players per room**:

- **Next.js 16 (App Router) + React 19** for the web shell: home screen, lobby, HUD, pause menu and overlays.
- **Phaser 4** for the game itself. It runs only in the browser and is created and destroyed safely under React Strict Mode.
- **Node.js game server** (`http` + `ws`) that runs every room at a fixed 60 Hz tick and holds the authoritative state. It streams snapshots and deltas over WebSockets.
- **Shared TypeScript package** used by both client and server: types, wire protocol, tuning configs, level manifest, Tiled JSON parser and a deterministic movement simulation.

Levels are Tiled JSON maps. Adding one takes a map file and one manifest entry. The template boots without any external art: sample levels and a debug tileset are included, and missing images fall back to generated placeholder textures.

## Quick start

Requires **Node.js 22.12+**.

```bash
npm install
npm run dev
```

Open http://localhost:3000 and choose **Play solo**, or **Create room** and share the invite link (up to 4 players).
`npm run dev` starts the game server on `:3001`, Next.js on `:3000` and an asset watcher.

To fill a room without more browsers, open another terminal and run:

```bash
npm run bots -- --room ABCDE --count 3     # headless players that run, jump and ready up
```

### Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Move | ← → / A D | Left stick, D-pad |
| Jump (hold for higher) | Space, ↑, W, Z, K | A / B |
| Drop through planks | ↓ + Jump | Down + A |
| Pause menu | Esc | Start |
| Debug overlay | F3 | – |

Pausing only stops the game when **every** connected player has the menu open. Solo, Esc really pauses.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Game server (auto-restart) + Next.js dev server + asset sync watcher |
| `npm run build` | Bundles the server (`apps/server/dist`) and runs `next build` |
| `npm start` | Runs the production builds |
| `npm test` | Vitest: simulation, level pipeline, protocol, rooms, client netcode (~160 tests, < 1 s) |
| `npm run typecheck` | `tsc` for every package (including tests and scripts) |
| `npm run levels:validate` | Parses and validates every level in the manifest |
| `npm run bots -- --room CODE [--count 3] [--seconds 30]` | Headless test clients |
| `npm run assets:sync` | Copies `packages/shared/data` to `apps/web/public/assets` (runs automatically on `dev`/`build`) |
| `npm run samples:generate` | Regenerates the sample maps and the debug tileset (**overwrites** `level-1`/`level-2`) |

## How it fits together

```
 Browser (apps/web)                                       Game server (apps/server)
 ┌─────────────────────────────────────────┐            ┌──────────────────────────────────────┐
 │ Next.js pages: home, lobby, HUD, menus  │            │ SocketGateway: origin check, message │
 │   RoomStore (useSyncExternalStore)      │  inputs →  │   validation, rate limits            │
 │   GameClient: socket, reconnect, ping   │◄──────────►│ RoomManager → Room (state machine)   │
 │   GameBridge ⇄ Phaser 4 scenes          │ ← snapshot │   InputQueue per player              │
 │     LocalPredictor  (own player)        │   + deltas │   GameWorld stepped at 60 Hz         │
 │     Interpolator    (other players)     │            │ LevelRepository: maps from disk      │
 └─────────────────────────────────────────┘            └──────────────────────────────────────┘
                  ▲                                                      ▲
                  └───── @platformer/shared: protocol, configs, manifest, Tiled parser, sim ─┘
```

- **The server owns the game.** Clients send one small input frame (a button bitmask) per tick. The server simulates every room, then broadcasts 20 snapshots per second, as full keyframes or field-level deltas.
- **Clients predict their own player** by running the same `stepPlayerMovement` function as the server, and reconcile when authoritative state arrives. **Other players are interpolated** 100 ms in the past. Details are in [docs/netcode.md](docs/netcode.md).
- **Room flow:** `lobby → countdown → playing → levelComplete → next level … → lobby (campaign complete)`. The first player is host and picks the level. A refresh or a dropped connection keeps your slot for 15 s.

```
apps/
  server/            Node.js game server
    src/rooms/       Room state machine, InputQueue, RoomManager
    src/net/         WebSocket gateway, connection wrapper, rate limiting
    src/levels/      LevelRepository: load, validate and hot-reload maps
    scripts/         bots.ts, validate-levels.ts
  web/               Next.js App Router + Phaser 4
    src/app/         routes: / and /room/[roomId]
    src/components/  lobby, HUD, overlays, GameCanvas
    src/net/         GameClient, prediction, interpolation (no React or Phaser imports)
    src/game/        Phaser: createGame, scenes, views, input, React bridge
packages/
  shared/            @platformer/shared, imported by both apps
    data/            Tiled maps and tilesets: the source of truth for levels
    src/config/      movement, player, entity and network tuning
    src/levels/      level manifest
    src/level/       Tiled JSON parser, validation, checksum
    src/sim/         deterministic movement and GameWorld rules
    src/protocol/    messages, validation, delta encoding, codec
docs/                level authoring, netcode
```

The shared package compiles with no DOM or Node types (`lib: ES2023`, `types: []`). That makes it impossible to accidentally use browser-only or server-only APIs in code that both sides run.

## Making it your game

### Tuning: no magic numbers

Gameplay values live in typed configs in `packages/shared/src/config/`. Client and server use the same values:

| File | Contents |
|---|---|
| `movement.ts` | `jumpHeight` + `timeToApex` (gravity and jump velocity are derived; a held jump peaks at exactly `jumpHeight`), fall multiplier, run speed, ground/air acceleration and deceleration, turn boost, jump cut (variable jump), coyote time, jump buffer, drop-through time |
| `players.ts` | max players, slot labels and colors, hitbox, respawn delay, name rules |
| `entities.ts` | collectible values, hazard tile hitbox, kill plane, `checkpointScope` (`team`/`player`), `exitRule` (`all`/`any`) |
| `net.ts` | tick and snapshot rates, interpolation delay, input queue limits, room timers, reconnect and rate limits |

Levels can override movement values in the manifest (`tuning: { timeToApex: 0.42 }`). The Phaser view settings (camera, parallax, effects) are in `apps/web/src/game/config.ts`.

### Levels

1. Draw a map in [Tiled](https://www.mapeditor.org/), following [docs/level-authoring.md](docs/level-authoring.md).
2. Save it to `packages/shared/data/maps/`.
3. Add it to `packages/shared/src/levels/manifest.ts`.

`npm run levels:validate` reports problems with a hint on how to fix each one. In development the server hot-reloads saved maps, and the asset watcher copies them to the client.

### Art

Players, collectibles, flags and backgrounds are drawn procedurally in `apps/web/src/game/art/textures.ts`, one tinted texture per player slot. Swap in real sprite sheets by loading them in `BootScene`/`LevelScene` and pointing `PlayerView`/`EntityViews` at the new keys. Tilesets are referenced by the Tiled map, and missing images get a generated fallback.

## React ↔ Phaser integration

- `GameCanvas` loads `createGame` with a dynamic `import()` inside an effect, so Phaser never runs during server rendering. A `disposed` flag makes Strict Mode's mount → unmount → mount create exactly one game.
- `createGame().destroy()` stops the running scenes first, so their cleanup runs while Phaser's plugins still exist, and then calls `game.destroy(true)`. Each game gets its own parent `div`, which is removed when Phaser finishes destroying.
- `GameClient` constructs without side effects and opens its socket on a zero-delay timer that `disconnect()` cancels. Strict Mode therefore opens one socket, and a page refresh re-attaches to the same slot.
- `GameBridge` is a typed event emitter between React and Phaser. React owns UI state (menu, debug) and Phaser reports readiness, warnings and network stats. Scenes subscribe with `listen(scene, emitter, event, handler)`, which unsubscribes automatically when the scene shuts down.
- In development, `window.__PLATFORMER__.snapshot()` returns live counts (sockets, games, canvases), room phase, predicted position and network stats. `hold(buttons)` and `release()` drive input for automated checks.

## Configuration

Server (`apps/server/.env`, see `.env.example`): `PORT`, `HOST`, `CORS_ORIGIN`, `ALLOWED_ORIGINS` (WebSocket origin allow-list), `DATA_DIR`, `DEV_COMMANDS`, `WATCH_LEVELS`, `AUTO_CREATE_ROOMS`, `MAX_ROOMS`, `LOG_LEVEL`.

Web (`apps/web/.env.local`): `NEXT_PUBLIC_GAME_SERVER_URL`. It defaults to the page's own hostname on port 3001, which also makes **LAN play** work: open `http://<your-ip>:3000` on another device. If Next.js blocks the dev origin, add it to `allowedDevOrigins` in `apps/web/next.config.ts`.

Server endpoints: `GET /health`, `POST /rooms` → `{ roomId }`, `GET /rooms/:code`, and WebSocket `/ws`.

## Deploying

- **Web:** any Next.js host (for example Vercel). Set `NEXT_PUBLIC_GAME_SERVER_URL=https://game.example.com`; the client switches to `wss://` automatically.
- **Game server:** needs a long-running Node process with WebSockets (a VPS, Fly.io, Railway, a container…). It does not fit serverless functions, because rooms live in memory and the tick loop never stops. `npm run build -w @platformer/server` produces a single `dist/index.js` (only `ws` stays external) that reads maps from `DATA_DIR`. Set `NODE_ENV=production` (dev commands off), `ALLOWED_ORIGINS` and `CORS_ORIGIN`.
- **Scaling:** one process handles many rooms (each costs about 60 simulation steps per second per player). To go beyond one process, route each room code to a fixed instance, for example with a small lookup service or consistent hashing at the proxy.

## Troubleshooting

- **"Game server offline" on the home page:** the server isn't running or the URL is wrong. Check `npm run dev` output or `NEXT_PUBLIC_GAME_SERVER_URL`.
- **"Your copy of … differs from the server's":** the browser has stale map assets. Run `npm run assets:sync` and reload.
- **Port already in use:** another dev server is running. Stop it or set `PORT`.
- **Choppy remote players:** press F3. `interp` should stay positive. If it reaches 0 ms, snapshots arrive later than the interpolation delay (`NET_CONFIG.interpolationDelayMs`).
