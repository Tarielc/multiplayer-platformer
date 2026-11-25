# 2D Platformer Template

A data-driven starter for online 2D platformers with **1–4 players per room**:

- **Next.js 16 (App Router) + React 19** for the web shell: home screen, lobby, HUD, pause menu and overlays.
- **Phaser 4** for the game itself. It runs only in the browser and is created and destroyed safely under React Strict Mode.
- **Node.js game server** (`http` + `ws`) that runs every room at a fixed 60 Hz tick and holds the authoritative state. It streams snapshots and deltas over WebSockets.
- **Shared TypeScript package** used by both client and server: types, wire protocol, tuning configs, level manifest, Tiled JSON parser and a deterministic movement simulation.

Levels are Tiled JSON maps. Adding one takes a map file and one manifest entry. Two campaigns are included, one per game mode: four co-op levels (team button puzzles, then a rhino boss) and three race levels (several routes each). They are built from a 16 px terrain tileset by an auto-tiling generator, with traps and interactive entities (spikes, saws, trampolines, falling platforms, fans, rock-heads, spike-heads, breakable boxes). Players have 3 hearts. Missing images fall back to generated placeholder textures, so the game still boots without them.

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
| `npm run levels:solve [-- --level race-2] [-- --verbose]` | Proves every level can be finished by one player without losing a heart (search over the real simulation, traps included). On co-op levels every button counts as held, since the team puzzles need a second player |
| `npm run levels:preview [-- race-1 …]` | Draws each generated level as a small overview PNG in `.level-previews/` (terrain by material, traps, foes, fruit, checkpoints), to judge a whole layout at a glance |
| `npm run bots -- --room CODE [--count 3] [--seconds 30] [--attack]` | Headless test clients |
| `npm run assets:sync` | Copies `packages/shared/data` to `apps/web/public/assets` (runs automatically on `dev`/`build`) |
| `npm run samples:generate [-- --only coop-2] [-- --print]` | Regenerates the levels from `scripts/levels/` (**overwrites** `coop-1`…`coop-4` and `race-1`…`race-3`), the debug tileset, and placeholder fan and button sheets if missing |

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
- **Room flow:** `lobby → countdown → playing → levelComplete → next level … → lobby (campaign complete)`; a co-op team wipe goes `playing → levelFailed → countdown` on the same level. The first player is host and picks the game mode and the level. A refresh or a dropped connection keeps your slot for 15 s.

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
| `players.ts` | max players, slot labels and colors, hitbox, hearts (`maxHp`), respawn delays (`respawnDelaysMs`, `soloMaxRespawnDelayMs`), name rules |
| `characters.ts` | the playable roster (`CHARACTER_IDS`, display names), slot defaults, how a taken pick falls back |
| `combat.ts` | `playerHits` (`false` makes swings cosmetic), swing duration, cooldown, active window, reach box, facing lock, stun, post-stun immunity, knockback |
| `fall.ts` | fall damage for players (`safeDropPx`, `pxPerHeart`, landing stun and invulnerability), foes and boxes (`safeDropPx`, `pxPerHit`), and boxes landing on things (`crush`) |
| `entities.ts` | collectible values, hazard tile hitbox, kill plane, `checkpointScope` (`team`/`player`), `exitRule` (`all`/`any`) |
| `abilities.ts` | special abilities: timings, reach, damage, cooldowns, `fruitRecharge` and `foeRecharge` (see [Special abilities](#special-abilities)) |
| `modes.ts` | game modes (co-op, race): checkpoint scope, shoves, friendly damage, the race finish window and placement points |
| `traps.ts` | trap damage, knockback and invulnerability; per-trap sizes, speeds and timings (see [Traps and health](#traps-and-health)) |
| `net.ts` | tick and snapshot rates, interpolation delay, input queue limits, room timers, reconnect and rate limits |

Levels can override movement values in the manifest (`tuning: { timeToApex: 0.42 }`). The Phaser view settings (camera, effects) are in `apps/web/src/game/config.ts`.

### Levels

1. Draw a map in [Tiled](https://www.mapeditor.org/), following [docs/level-authoring.md](docs/level-authoring.md).
2. Save it to `packages/shared/data/maps/`.
3. Add it to `packages/shared/src/levels/manifest.ts`, in the campaign of its game mode (`mode: 'coop'` or `'race'`).

Each mode has its own campaign, and the lobby only offers the selected mode's levels:

| Co-op (2+ players) | Race (and solo) |
|---|---|
| 1. Meadow Gate | 1. Sunny Sprint |
| 2. Rust Canyon | 2. Ember Gorge |
| 3. Jade Citadel | 3. Candy Spire |
| 4. Rhino Coliseum (boss) | |

The co-op levels are built around three team puzzles (a trampoline powered from two buttons, a long spiked corridor switched off from either end, and a button ledge only an ability reaches). The race levels split into faster, riskier routes and slower, safer ones. See [docs/level-authoring.md](docs/level-authoring.md#campaigns-and-puzzles).

`npm run levels:validate` reports problems with a hint on how to fix each one. In development the server hot-reloads saved maps, and the asset watcher copies them to the client.

### Game modes

The host picks a mode in the lobby; it applies to the whole campaign, and each mode has its own levels. Co-op needs at least two players, so solo play runs the race campaign.

| | Co-op (default) | Race |
|---|---|---|
| Players | 2–4 | 1–4 |
| Goal | Everyone reaches the trophy | First to the trophy |
| Checkpoints | Shared: one touch moves everyone's respawn point | Your own |
| Other players | Swings shove, but nothing costs a teammate hearts | Swings shove; giant swings and spit cost hearts |
| End of level | When every player stands in the trophy | When everyone has finished, or 20 s after the first finish |
| Score | Fruit and foes, with a team total | Placement points only (1st 300, 2nd 200, 3rd 100, 4th 50); fruit and foes don't count |
| Foes | Tougher for every extra player (below) | As tuned |
| Team wipe | If every player is down at once (2+ players), the level restarts after 3 s | Never: each racer just respawns |

In a race, a player who reaches the trophy gets a place and leaves play, and their camera follows a player still racing. The HUD shows places and the time left. The rules are in `packages/shared/src/config/modes.ts`.

In co-op, each player after the first gives foes **+40% health** (bosses **+60%**) and makes them attack **15% more often**. Health is rounded and never drops below the tuned value. Sizes, speeds, reach and damage stay the same, and traps and player hearts never scale. The team is counted when a level starts, so a player who drops in mid-level makes the *next* level harder. The lobby and the level countdown say how much tougher the foes are. Tune it in `MODE_CONFIG.coop.scaling`.

| Players | Mushroom, wasp | Chicken, monkey | Bull | Rhino (boss) | Attack rate |
|---|---|---|---|---|---|
| 1 | 1 | 2 | 3 | 12 | ×1 |
| 2 | 1 | 3 | 4 | 19 | ×1.15 |
| 3 | 2 | 4 | 5 | 26 | ×1.3 |
| 4 | 2 | 4 | 7 | 34 | ×1.45 |

### Special abilities

Each character has one special ability. Its cooldown is ranked by how strong the ability is:

| Character | Ability | Cooldown | After a miss |
|---|---|---|---|
| Mask Dude | Giant Form: 10 s of armour, damaging swings, 2 bonus hearts, and a springy head teammates can jump off about 30 tiles high | 30 s | – |
| Virtual Guy | Claw Drone: 15 s of flight up to 800 px away; the claw carries players, boxes, foes or Virtual Guy himself, and players can ride on top | 22 s | – |
| Ninja Frog | Tongue Spit: grab, hold and spit a damaging projectile | 15 s | 3 s |
| Bunny Man | Healing Hug: heals 2 hearts, plus 1 for the healer | 12 s | 3 s |

**Abilities work in the air.** Every special can be used mid-jump or mid-fall, not just on the ground. While it plays the character can't steer, but keeps its jump: a held jump still rises to its full height and the run speed carries on, so the ability plays out along the arc. On the ground, using one still brings the character to a stop.

**Giant Form is big.** Mask Dude's hitbox grows from 20×28 to 28×38 px around his feet (`giant.hitbox` in `config/abilities.ts`, matching the big-form art) for as long as the form lasts, so he needs more headroom, makes a taller and wider platform for others to stand on, and is easier to hit. He can't grow where the big hitbox wouldn't fit (under a low ceiling or in a narrow shaft); next to a wall he grows away from it.

**Flying with the drone.** Press Special with the claw over Virtual Guy to pick himself up: he hangs from the claw and flies wherever the drone goes, and Special again lets go. Other players can land on the drone's top (a one-way platform, jump up through it) and ride it while it is flown. Down + Jump drops through it.

**Standing on each other.** Every player's head is a one-way platform for the others: land on a teammate (or a rival in a race), jump up through them from below, and Down + Jump to drop off. A head is a ledge, not a lift: if the player underneath walks away, the one on top stays where they are and drops down, and if they fall, the one on top falls on their own. Only a jump pushes the one on top up with it. Stacks can be several players tall, and a jump from a teammate's head reaches a ledge one player-height higher. A dead player, one held by an ability (the claw, a tongue, a hug) or one flying from a spit can't carry anyone.

**Fruit recharges abilities.** Each point of a pickup takes 1% of the ability's full cooldown off: an apple, strawberry or coin (10 pts) 10%, a pineapple 20%, a melon or gem (50 pts) half. **Beating a foe recharges them too**, by twice its score: a mushroom (10 pts) 20%, a chicken or wasp 30%, a monkey 40%, a bull 60%, and the rhino boss refills it. Only the player who lands the final hit gets it (a frog's spit counts for the frog). Both work in both modes, so fruit and foes still matter in a race. The HUD shows your ability as a large badge in the bottom-left corner, and each player's chip shows a smaller one. The ring around the icon fills as it recharges, glows when it is ready, and flashes when fruit or a kill tops it up.

### Traps and health

Players have **3 hearts** (`PLAYER_CONFIG.maxHp`), shown in the HUD. Spikes, saws and spike-heads cost one heart, with a stun, a knockback away from the trap and about a second of invulnerability (the player blinks). At 0 hearts the player dies and respawns with full hearts. Lava, pits and being crushed by a rock-head kill outright.

**Long falls hurt.** A drop of more than 16 tiles (256 px, measured from the top of the airtime to the landing) costs a heart, plus one more for every further 8 tiles, so a fall of 32 tiles or more is fatal. A hard landing stuns briefly in place and gives a moment of invulnerability. A double jump, a trampoline or a stomp on the way down breaks the fall. Something carried (the drone's claw, the pilot hanging from their own drone) falls from where it is let go; spat players and foes don't, since the spit already hurt them.

Foes (not wasps) and boxes take fall damage too, from lower down: past 8 tiles a foe loses a hit point (16 tiles: 2), and past 6 tiles a box takes a hit (12 tiles: 2), so a plain crate breaks. A foe that falls at least 2 tiles onto another foe costs it a hit point on the way down (once per fall; it lands on through, foes don't stand on each other). A foe beaten by a fall, or by one dropped on it, scores for whoever dropped it.

A box falling at least 2 tiles onto a player, a foe or another box costs it a heart, a hit point or a hit, and the box takes a hit too: a plain crate shatters, a sturdier one bounces off a head, and one that breaks the box under it falls on through. This applies in co-op as well: drop crates with care. Tune it all in `FALL_DAMAGE_TUNING` (`config/fall.ts`).

**Respawning takes longer with every death in a level:** 5 s after the first, 10 s after the second, 20 s after the third, then 30 s each time (`PLAYER_CONFIG.respawnDelaysMs`). In co-op with two or more players, a death while every teammate is already waiting to respawn wipes out the team: the level restarts from the start (new run, fruit and foes back, death counts reset), and the scores already earned in the campaign are kept. The count starts over on each new level. Playing alone, the wait never goes past 5 s (`soloMaxRespawnDelayMs`). While you wait, a countdown shows how long is left and what the next death will cost, and the camera follows the lowest-slot teammate still in play.

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
