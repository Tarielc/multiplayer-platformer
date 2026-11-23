# 2D Platformer Template

A data-driven starter for online 2D platformers with **1–4 players per room**:

- **Next.js 16 (App Router) + React 19** for the web shell: home screen, lobby, HUD, pause menu and overlays.
- **Phaser 4** for the game itself. It runs only in the browser and is created and destroyed safely under React Strict Mode.
- **Node.js game server** (`http` + `ws`) that runs every room at a fixed 60 Hz tick and holds the authoritative state. It streams snapshots and deltas over WebSockets.
- **Shared TypeScript package** used by both client and server: types, wire protocol, tuning configs, level manifest, Tiled JSON parser and a deterministic movement simulation.

Levels are Tiled JSON maps. Adding one takes a map file and one manifest entry. Three sample levels are included, built from a 16 px terrain tileset by an auto-tiling generator, with traps and interactive entities (spikes, saws, trampolines, falling platforms, fans, rock-heads, spike-heads, breakable boxes). Players have 3 hearts. Missing images fall back to generated placeholder textures, so the game still boots without them.

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
npm run bots -- --room ABCDE --attack      # …and swing at each other now and then
```

### Controls

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Move | ← → / A D | Left stick, D-pad | Walk stick (left) |
| Jump (hold for higher) | Space, ↑, W, Z, K | A / B | Jump button |
| Double jump | Jump again in mid-air | A / B again | Jump again |
| Drop through planks | ↓ + Jump | Down + A | Walk stick down + Jump |
| Attack (shoves other players, breaks boxes) | J, X | X / □ | Attack stick (bottom right): lift to swing, drag left/right first to swing that way |
| Special ability | L, C, right-click (aim: arrow keys / mouse) | Y / RB (aim: right stick) | Special stick (above attack): drag to aim, lift to fire |
| Pause menu | Esc | Start | Menu button (top right) |
| Debug overlay | F3 | – | – |

Touch controls appear on touch-first devices (phones, tablets) and on any device once its screen is touched.

Pausing only stops the game when **every** connected player has the menu open. Solo, Esc really pauses.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Game server (auto-restart) + Next.js dev server + asset sync watcher |
| `npm run build` | Bundles the server (`apps/server/dist`) and runs `next build` |
| `npm start` | Runs the production builds |
| `npm test` | Vitest: simulation, combat, traps, level pipeline, protocol, rooms, client netcode, state machines, synth (~290 tests, a few seconds) |
| `npm run typecheck` | `tsc` for every package (including tests and scripts) |
| `npm run levels:validate` | Parses and validates every level in the manifest |
| `npm run levels:solve [-- --level level-2] [-- --verbose]` | Proves every level can be finished by one player without losing a heart (search over the real simulation, traps included) |
| `npm run bots -- --room CODE [--count 3] [--seconds 30] [--attack]` | Headless test clients |
| `npm run assets:sync` | Copies `packages/shared/data` to `apps/web/public/assets` (runs automatically on `dev`/`build`) |
| `npm run samples:generate` | Regenerates the sample maps from `scripts/generate-samples.ts` (**overwrites** `level-1`…`level-3`), the debug tileset, and a placeholder fan sheet if `fan.png` is missing |

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
- **Clients predict their own player** by running the same `stepPlayerBody` function (movement plus attack and stun timers) as the server, and reconcile when authoritative state arrives. **Other players are interpolated** 100 ms in the past. Details are in [docs/netcode.md](docs/netcode.md).
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
    src/sim/         deterministic movement, traps and GameWorld rules
    src/protocol/    messages, validation, delta encoding, codec
docs/                level authoring, netcode
```

The shared package compiles with no DOM or Node types (`lib: ES2023`, `types: []`). That makes it impossible to accidentally use browser-only or server-only APIs in code that both sides run.

## Making it your game

### Tuning: no magic numbers

Gameplay values live in typed configs in `packages/shared/src/config/`. Client and server use the same values:

| File | Contents |
|---|---|
| `movement.ts` | `jumpHeight` + `timeToApex` (gravity and jump velocity are derived; a held jump peaks at exactly `jumpHeight`), fall multiplier, run speed, ground/air acceleration and deceleration, turn boost, jump cut (variable jump), air jumps (`airJumps` count and `airJumpHeight`; 0 turns the double jump off), coyote time, jump buffer, drop-through time |
| `players.ts` | max players, slot labels and colors, hitbox, hearts (`maxHp`), respawn delay, name rules |
| `characters.ts` | the playable roster (`CHARACTER_IDS`, display names), slot defaults, how a taken pick falls back |
| `combat.ts` | `playerHits` (`false` makes swings cosmetic), swing duration, cooldown, active window, reach box, facing lock, stun, post-stun immunity, knockback |
| `entities.ts` | collectible values, hazard tile hitbox, kill plane, `checkpointScope` (`team`/`player`), `exitRule` (`all`/`any`) |
| `traps.ts` | trap damage, knockback and invulnerability; per-trap sizes, speeds and timings (see [Traps and health](#traps-and-health)) |
| `net.ts` | tick and snapshot rates, interpolation delay, input queue limits, room timers, reconnect and rate limits |

Levels can override movement values in the manifest (`tuning: { timeToApex: 0.42 }`). The Phaser view settings (camera, effects) are in `apps/web/src/game/config.ts`.

### Levels

1. Draw a map in [Tiled](https://www.mapeditor.org/), following [docs/level-authoring.md](docs/level-authoring.md).
2. Save it to `packages/shared/data/maps/`.
3. Add it to `packages/shared/src/levels/manifest.ts`.

`npm run levels:validate` reports problems with a hint on how to fix each one. In development the server hot-reloads saved maps, and the asset watcher copies them to the client.

### Traps and health

Players have **3 hearts** (`PLAYER_CONFIG.maxHp`), shown in the HUD. Spikes, saws and spike-heads cost one heart, with a stun, a knockback away from the trap and about a second of invulnerability (the player blinks). At 0 hearts the player dies and respawns with full hearts. Lava, pits and being crushed by a rock-head kill outright.

| Trap | Behaviour | Sheet (`packages/shared/data/sprites/traps/`) |
|---|---|---|
| Spikes | Static strip; touching the blades costs a heart. Can point up, down, left or right. | `spikes.png` 16×16 |
| Saw | Spins and slides back and forth along a track (or stays put); costs a heart. | `saw.png` 38×38 × 8 |
| Trampoline | Landing on it launches you high; the spring animation plays. | `trampoline.png` 28×28 × 9 (frame 0 idle) |
| Falling platform | One-way platform that shakes, then falls shortly after you land on it, and comes back. | `falling-platform.png` 32×10 × 4 |
| Fan | Blows players up while it is on (frame 0 = off). | `fan.png` 24×8 × N (placeholder art; drop your own over it) |
| Rock-head | Solid block that slides between two walls on one axis and slams into them. You can ride it; get pinned against a wall and you are crushed. | `rock-head.png` 42×42, rows: blink, side impact, top/bottom impact |
| Spike-head | Solid block with spikes on every side; touching it costs a heart. | `spike-head.png` 54×52, same rows |
| Box | Solid, and you can stand on it; breaks after 1/2/3 hits (box1/2/3) from an attack, then bursts into debris. | `box1..3.png` 28×24, rows: idle, hit, debris |

Traps are Tiled objects; [docs/level-authoring.md](docs/level-authoring.md#traps) lists their classes and properties. Every trap moves as a pure function of the server tick, so the client predicts them exactly (you collide with what you see); only box hits and falling-platform triggers are replicated. Tuning is in `packages/shared/src/config/traps.ts`; the client views are in `apps/web/src/game/traps/`.

### Characters and animation

Each player picks a character: on the home screen (saved in the browser, used for solo play and as the default when joining) or in the lobby. Picks are unique per room. A taken pick falls back to the next free character, and a player keeps their character across reconnects.

The sprites come from one sheet, `packages/shared/data/sprites/all-characters.png`: 64×32 frames, 11 columns, and 7 rows per character in this order: Idle, Run, Attack, Jump, Fall, Hurt, Death. Characters are stacked in roster order. The body is centred in the frame with its feet on the bottom row, facing right.

The player presentation is split into small parts, under `apps/web/src/game/`:

| Part | File | Job |
|---|---|---|
| Signals | `player/playerSignals.ts` | Builds the state-machine input from the predicted body (you) or the interpolated sample (others). |
| State machine | `player/PlayerStateMachine.ts` on `fsm/StateMachine.ts` | `idle`, `run`, `jump`, `fall`, `attack`, `hurt`, `dead`, with any-state interrupts; an air jump restarts `jump`. Emits cues such as `jump`, `doubleJump`, `land`, `attack`, `hurt`, `death`, `respawn`. Phaser-free and unit-tested. |
| Animation controller | `player/PlayerAnimationController.ts` | Maps states to clips for the current character, chains intro → loop (Fall), and fires frame events (footsteps). |
| Clip data | `characters/characterArt.ts` | Sheet layout, rows, frame counts, frame rates, per-character voice pitch. Attack and Hurt clip lengths come from `combat.ts`, so animation and simulation stay in sync. |
| Sound controller | `audio/SoundController.ts` | Plays cues from the presentation event bus, with throttling, voice limits, distance falloff and stereo pan for other players. |

To add a character: append rows to the sheet, add an id and name to `CHARACTER_IDS`/`CHARACTERS` in `characters.ts`, and give it a `block` (its position in the sheet) in `CHARACTER_ART`. Tests check that every clip fits inside the sheet.

If the sheet fails to load, `BootScene` draws a placeholder sheet on the same grid and shows a warning, so the game still runs.

### Audio

Sound effects are synthesized when the game boots (`audio/sfxSynth.ts`, with recipes in `audio/soundCues.ts`), so no audio files are needed. Cues: `jump`, `doubleJump`, `land`, `step`, `attack`, `hit`, `hurt`, `death`, `respawn`, `coin`, `gem`, `checkpoint`, `levelComplete`, and for traps `bounce`, `boxHit`, `boxBreak`, `thud` (rock-head impacts, quieter with distance) and `shake` (falling platforms). To use a recorded sound for a cue, put the file in `packages/shared/data/audio/` and set that cue's `file` (for example `audio/jump.ogg`). If the file fails to load, the synthesized version is used.

The pause menu has a sound on/off toggle and a volume slider, saved per browser. Browsers keep audio locked until the first click or key press; nothing is queued while it is locked.

### Other art

The levels use `packages/shared/data/tilesets/terrain-tileset.png` (16×16 tiles): wall, ground and brick sets with inner corners, block sets, and one-way platforms. Everything is solid except the platforms. See [Terrain tileset](docs/level-authoring.md#terrain-tileset) for the layout and the auto-tiling legend.

The start sign, checkpoint flags and finish trophies are sprite sheets in `packages/shared/data/sprites/markers/` (64×64 frames, one row per animation; layout in `traps/trapArt.ts`). Collectibles are drawn procedurally in `apps/web/src/game/art/textures.ts`. Swap in real images by loading them in `BootScene` and pointing `EntityViews` at the new keys. Tilesets are referenced by the Tiled map, and missing images get a generated fallback.

## React ↔ Phaser integration

- `GameCanvas` loads `createGame` with a dynamic `import()` inside an effect, so Phaser never runs during server rendering. A `disposed` flag makes Strict Mode's mount → unmount → mount create exactly one game.
- `createGame().destroy()` stops the running scenes first, so their cleanup runs while Phaser's plugins still exist, and then calls `game.destroy(true)`. Each game gets its own parent `div`, which is removed when Phaser finishes destroying.
- `GameClient` constructs without side effects and opens its socket on a zero-delay timer that `disconnect()` cancels. Strict Mode therefore opens one socket, and a page refresh re-attaches to the same slot.
- `GameBridge` is a typed event emitter between React and Phaser. React owns UI state (menu, debug) and Phaser reports readiness, warnings and network stats. Scenes subscribe with `listen(scene, emitter, event, handler)`, which unsubscribes automatically when the scene shuts down.
- In development, `window.__PLATFORMER__.snapshot()` returns live counts (sockets, games, canvases), room phase, predicted position, each player's animation state and character, audio status and network stats. `hold(buttons)` and `release()` drive input for automated checks.

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
