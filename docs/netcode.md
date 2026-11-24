# Netcode

The game server owns the game. Clients send inputs, and the server runs the simulation and broadcasts the results. Each client predicts **its own** player so the controls respond instantly, and draws **other** players slightly in the past, interpolated between server states.

Client and server use the same rules: movement and actions (`stepPlayerBody`, which wraps `stepPlayerMovement`) and world logic (`GameWorld`) live in `packages/shared/src/sim`. All the numbers below come from `NET_CONFIG` in `packages/shared/src/config/net.ts`.

```
 client (60 Hz fixed steps)                server (60 Hz tick, every room)
 ─────────────────────────                 ───────────────────────────────
 sample buttons ── input{seq, buttons} ──► InputQueue (per player)
 predict own player (shared sim)           drain → GameWorld.stepPlayer → endTick
 keep un-acked inputs                      every 3rd tick:
                 ◄── snapshot | delta ──── keyframe (full) or delta (changed fields)
 reconcile: server state + replay           players carry `ack` = last input seq applied
 remote players: interpolate at now − 100 ms
```

## Server tick

`FixedTickLoop` runs one global 60 Hz loop that ticks every room. Node timers are coarse (about 15.6 ms on Windows), so the loop wakes every 8 ms and runs as many whole ticks as real time calls for. The average rate is exact, and the client's interpolation delay absorbs the jitter. A backlog of more than 10 ticks (for example after a debugger pause) is dropped with a warning instead of fast-forwarding.

One `Room.tick()`:

1. Releases the slots of players whose reconnect grace ran out.
2. Advances the room phase. In the lobby, it starts the campaign if every connected player is ready. In countdown and level-complete, it counts down.
3. While **playing** and not paused, steps every player in slot order:
   - A connected player is stepped with the frames its `InputQueue` hands out (0–3 per tick).
   - A disconnected player is stepped with neutral input, so it falls to the ground instead of hanging in the air.
   - Then `world.endTick()` handles respawn timers and the exit rule.
4. Sends a `room` message if any lobby or room state changed.
5. Every 3rd tick (20 Hz), broadcasts the world.

Every room timer counts ticks, not wall-clock time. Tests drive `room.tick()` by hand and are fully deterministic.

## Inputs

While playing, the client sends one `{ t: 'input', seq, buttons }` per fixed step. `buttons` is a bitmask: LEFT 1, RIGHT 2, JUMP 4, DOWN 8, ATTACK 16. `seq` increases by one per step. One input frame is exactly one simulation step of that player.

`InputQueue` (`apps/server/src/rooms/InputQueue.ts`) decides when frames are applied:

- **Order:** duplicate and out-of-order frames (`seq` ≤ last received) are dropped. The queue holds at most 30 frames.
- **Catch-up:** each tick adds 1 to a budget (capped at 6) and applies up to 3 frames while budget remains. Frames that arrive in a burst after a network hiccup are caught up quickly. Over time a client can never simulate faster than real time, so speeding up the send rate gains nothing.
- **Stalls:** with no frames, the player freezes, which keeps prediction exact. After 15 ticks with nothing (a hidden tab or a network stall), the server steps the player without movement input. Jump and Attack stay as they last were, so a button still held when input resumes is not a fresh press (no phantom double jump or swing after a lag spike).
- **Acks:** every player state carries `ack`, the `seq` of the last frame the server applied. The client uses it to drop confirmed inputs.

Players are not lockstepped. A laggy player's frames are applied whenever they arrive, and never slow down anyone else.

## Snapshots and deltas

The world state is small: `{ tick, players[], collected[], traps[] }`. Each player carries the full movement state (position, velocity, timers, flags, and `stepTick`, the tick of its last step) plus `alive`, `respawnIn`, `score`, `deaths`, `atExit`, `checkpointId`, `tp`, `ack`, and `hp`/`invulnUntil` (hearts, and the tick until which traps can't hurt it). `traps` lists only traps that differ from their initial state (see [Traps](#traps)). Every field the simulation needs travels with it, so a client can resume the simulation from any state.

- **Keyframe:** `snapshot` carries the full state. It is sent at the start of each level, then every 60th broadcast (every 3 s). A player who joins or rejoins mid-level receives the last broadcast state, so they share the same delta base as everyone else. A client can also request one with `resync`.
- **Delta:** `delta` holds only what changed since the previous broadcast (`baseTick`):
  - `upserts`: changed fields per player, or the whole object for a new player;
  - `removed`: ids of players who left;
  - `collected`: newly collected item ids;
  - `traps`: the whole trap state, only when it changed (it is a few entries at most).

  When the world is frozen (countdown, results, pause) and nothing changed, the broadcast is skipped.
- **Why deltas are safe:** WebSockets deliver every message, in order. All clients of a room hold the same base, so one encoded delta serves everyone.
- **Gap detection:** the client's `WorldStateStore` applies a delta only if its `baseTick` equals the tick of the state it already holds. Otherwise it sends `resync` and waits for the keyframe.
- **Run counter:** `run` increments with every new `GameWorld` (level start or restart) and is part of the room's level info. Snapshots and deltas from an older run are dropped, so a slow packet can never leak the previous level into the next one.
- **Events:** `collect` (with `recharged`: the seconds the pickup took off the collector's special cooldown), `foeHurt` (with `score`, and `recharged` when the hit beat the foe), `death`, `respawn`, `checkpoint`, `finish` (race), `levelComplete`, `trapHit`, `bounce` and `boxHit` ride along with the next broadcast. The client uses them for effects only. State changes always come from the state itself.

## Prediction and reconciliation (own player)

`LevelScene` runs its own 60 Hz fixed-step accumulator. Each step:

1. Samples the controls.
2. Sends the input; `client.sendInput` returns its `seq`.
3. Applies the input immediately with `LocalPredictor.step(seq, buttons)`, through the same `stepPlayerBody` the server runs.
4. Keeps the input until the server acknowledges it. At most 180 inputs (3 s) are kept.

When a server state for the local player arrives, `reconcile` does three things:

1. Drops inputs with `seq ≤ ack`.
2. Restarts from the server state.
3. Replays the remaining inputs on top of it.

The server applied exactly the same inputs with exactly the same function, so normally the result equals what the client already showed, with zero correction. A test (`apps/web/src/net/prediction.test.ts`) checks this over 900 ticks with 100 ms latency each way.

Corrections still happen:

- **Neutral stall steps:** the server stepped neutral input during a stall.
- **Dropped inputs:** the input queue overflowed.
- **Server-only rules:** deaths, respawns and anything else the client doesn't predict.

How they are handled:

- **Respawn and teleport:** a change of `tp` (the teleport counter, incremented on respawn) or of `alive` snaps to the new state and replays from there.
- **Large errors:** errors above 64 px snap.
- **Small errors:** become a visual offset that fades with a 60 ms half-life. The physics state is corrected at once; only the drawing eases over.

The local player is drawn between the last two predicted steps using the accumulator's remainder, so movement stays smooth at any frame rate.

**Not predicted:** pickups, checkpoints, deaths, trap damage and box hits happen on the server. They show up one round trip (plus up to 50 ms until the next broadcast) after the player touches them. Players don't collide with each other, so another player can never cause a misprediction. If you add player-to-player interactions (pushing, stomping), you'll need to predict them or accept corrections.

## Traps

Traps have to line up exactly between the server and the predicting client, or you would land on a platform the server thinks has moved. So:

- **Motion is a pure function of the tick.** Saws, rock-heads, fans and falling platforms are positioned by functions in `packages/shared/src/sim/traps/motion.ts` from the trap's definition and a tick. Nothing about their position is sent.
- **Only what players change is replicated:** hits taken by each box and the tick each falling platform was stood on (`NetTrapState[]`, in snapshots and in deltas when it changes). A finished falling cycle is forgotten, so the list stays tiny.
- **Each body knows its tick.** A step at tick *t* carries a rider by the platform's movement since the body's previous step (`stepTick`), so the 0–3 inputs the server applies in one tick carry the rider once, and a skipped tick is caught up. The server steps players at `world.tick`; the client predicts each new input at `stepTick + 1` and replays from the server's `stepTick`, which lands each replayed input on the tick the server used.
- **The predictor owns the client's `TrapField`.** Every reconcile copies the server's trap state into it before replaying. Landing on a falling platform starts it locally at once; the server's state then confirms it.
- **Traps are drawn at the local player's predicted tick** (`LocalPredictor.renderTick`), interpolated between steps. What you see is what you collide with. The price: other players, drawn 100 ms in the past, can look slightly out of step with a moving platform they ride.
- **Effects without events:** rock-head impacts are scheduled, so the client derives the squash animation and thud from the same functions (`rockHeadImpacts`).

Damage flow: the server checks hazards after each player step. A hit costs `damage.amount` hearts, stuns the player (Hurt), knocks them away from the trap and sets `invulnUntil`; at 0 hearts the player dies (`death` with cause `trap`) and respawns with full hearts. `trapHit {playerId, trapId, hp, side}` drives the spike-head squash; the Hurt animation and the blink come from the replicated state. Lava, pits and crushes (`death` with cause `crush`) kill outright. Trampoline launches are part of movement, so they are predicted; the client plays your spring animation from the predicted step and other players' from the `bounce` event.

## Interpolation (other players)

`ServerClock` estimates which server tick it is *now*. Each world update gives a sample `arrivalTime − tick × 16.67 ms`. A late packet makes the sample larger, so the estimate follows smaller samples quickly and larger ones slowly. In effect it tracks the fastest packets. It resets after jumps of more than 250 ms (pause, countdown, tab sleep, reconnect).

Remote players are drawn at `estimatedTick − 6` (100 ms in the past), interpolated between the two buffered states around that tick:

- **No extrapolation:** if the buffer runs dry, the newest state is held.
- **No sliding across teleports:** a change of `tp` or `alive` jumps straight to the new state.
- **New players** appear at their newest position.

The F3 overlay and HUD show **interp**: how far the newest buffered state is ahead of the time remote players are drawn at. It normally moves between about 50 and 100 ms as snapshots arrive every 50 ms. If it reaches 0, remote players stall until the next snapshot. Raise `interpolationDelayMs` for bad networks, or lower it for a LAN.

## Determinism

Client and server agree only because both run the same code on the same numbers:

- **The simulation** uses a fixed `dt` and plain arithmetic: `+ − × ÷`, `Math.sqrt`, `min`, `max`, `abs`, `floor`, `sign`. IEEE 754 specifies these exactly, so V8, SpiderMonkey and JavaScriptCore produce bit-identical results.
- **Keep it that way:**
  - No `Math.random()` and no clock reads inside `sim/`. Pass seeds and ticks in.
  - No `Math.sin`, `cos`, `exp` or `pow` with fractional exponents. Engines may approximate them differently.
  - Don't iterate collections whose order can differ between client and server.
- **Movement is integrated exactly** for constant gravity (trapezoidal rule). A held jump peaks at precisely `jumpHeight` after `timeToApex`, and long falls can't tunnel through tiles: a move is split into substeps no longer than half a tile.

## Rooms

```
lobby ──(all connected players ready)──► countdown (3 s) ──► playing ──(exit / race rule)──► levelComplete (4 s)
  ▲          (un-ready / new player cancels)                    │ pause rule                  │
  │                                                             ▼                             ▼
  └──────────── lobby + campaignComplete ◄── last level ── next level? ── countdown (next level)
```

- **Slots:** a new player gets the lowest free slot (P1–P4) and its color. A fifth player gets `ROOM_FULL`.
- **Host:** the first player is host and picks the game mode and the starting level in the lobby. When the host leaves or their grace expires, the next player by slot (connected players first) becomes host.
- **Modes:** `RoomInfo.mode` is `coop` (the default, also used for solo) or `race`, and stays fixed for the campaign. `modeWorldOptions` (`config/modes.ts`) turns it into `GameWorld` options:
  - **Co-op:** team checkpoints, every present player must stand in the exit, and swings still shove teammates, but giant swings and spat projectiles cost no hearts (`playerDamage: false`). Foes scale to the team: `startLevel` counts the room's players and passes `modeFoes('coop', n)` as the world's `foes` tuning (more health, shorter attack cooldowns). `RoomInfo.scaledFor` carries `n` for the running level, so clients rebuild the same tuning for the boss bar and the rhino's rage look (at half its *scaled* health). The count is fixed for the level; drop-ins only affect the next one.
  - **Race:** checkpoints are per player. A player who reaches the exit gets a `place`, a `finish` event and leaves play: their body is `alive: false` with no respawn, so nothing can hit or grab them, and clients hide them instead of playing the Death clip. The first finish starts the finish window (20 s, `RoomInfo.raceEndsInMs`); the level ends when every present player has a place or the window runs out. Results carry `place`, `timeMs` and `placePoints`, and `campaignScore` adds only the placement points (`campaignPoints`): fruit and foes score nothing in a race.
- **Start:** when every connected player is ready (at least `minPlayersToStart`, default 1), a 3 s countdown starts. It is cancelled if someone un-readies or a new, unready player joins. Countdowns between levels can't be cancelled.
- **Level complete:** results show for 4 s, then the next level (`next` in the manifest) counts down. After the last level, the room returns to the lobby with `campaignComplete`, and everyone is un-readied.
- **Pause:** the world is simulated only when the phase is `playing`, at least one player is connected, and **not every** connected player has the menu open. In solo, Esc really pauses. In multiplayer, the game pauses only when everyone has the menu open.
- **Drop-in:** players can join during a level (`allowDropIn`). They appear at the team checkpoint, or at their slot's spawn, and get a keyframe.
- **Reconnect:** each browser tab has a secret `clientId`, kept in `sessionStorage` so it survives reloads but isn't shared between tabs. Browsers copy `sessionStorage` when a tab is duplicated, so a new tab asks the others over a `BroadcastChannel` and picks a new id if its id is taken.
  - A `join` with a known `clientId` re-attaches the same player and slot (`welcome.rejoined = true`).
  - If that player still had an open socket, the old socket gets `REPLACED` (close 4001).
  - While disconnected, a player keeps their slot for 15 s. They don't count toward "everyone at the exit", "everyone finished" (race) or "everyone ready".
  - `playerId` is public, but `clientId` never leaves the client except in `join`.
- **Client reconnect:** after an unexpected close, the client retries with backoff (300 ms × 2ⁿ, capped at 5 s), up to 8 times. It then shows *Connection lost* with a Retry button. A reconnected client re-sends its menu state and drops its pending inputs, because the server reset its input queue.
- **Strict Mode:** `GameClient.connect()` opens its socket on a zero-delay timer that `disconnect()` cancels. React's mount → unmount → mount therefore opens a single socket.
- **Solo:** `?solo=1` makes the client ready up automatically after a fresh join into a lobby. It doesn't do so after a rejoin or after the campaign returns to the lobby.
- **Lifetime:** empty rooms are deleted after 60 s. With `AUTO_CREATE_ROOMS` (the default), joining an unknown code creates that room, so invite links keep working across server restarts.

## Messages

All messages are JSON objects with a `t` field. The types are in `packages/shared/src/protocol/messages.ts`.

### Client → server

| `t` | Fields | When |
|---|---|---|
| `join` | `protocol`, `roomId`, `name`, `clientId`, optional `characterId` | First message, within 10 s of connecting. `characterId` is a preference: if it is taken, the player gets the next free character. On a rejoin it is ignored and the player keeps their character. |
| `selectCharacter` | `characterId` | Lobby only. Refused with `NOT_ALLOWED` if another player has that character. |
| `ready` | `ready` | Lobby (and the lobby countdown). |
| `selectLevel` | `levelId` | Host only, in the lobby. |
| `selectMode` | `mode` (`coop` \| `race`) | Host only, in the lobby. |
| `input` | `seq`, `buttons` | Every fixed step while playing. |
| `menu` | `open` | Pause menu opened or closed. |
| `ping` | `id`, `at` | Every 2 s, for RTT. Answered by `pong`. |
| `resync` | – | After a delta gap. The server replies with a keyframe. |
| `leave` | – | Leave button. Frees the slot immediately. |
| `dev` | `cmd` (`skipLevel` \| `respawn`) | Only when the server has `DEV_COMMANDS` on (default outside production). |

### Server → client

| `t` | Fields | When |
|---|---|---|
| `welcome` | `protocol`, `roomId`, `playerId`, `slot`, `rejoined`, `tickRate`, `snapshotRate` | After a successful join. |
| `room` | `room: RoomInfo` (phase, mode, players, host, level and `run`, paused, countdown, race clock, co-op `scaledFor`, results, campaign flags) | Whenever room state changes. |
| `snapshot` | `run`, `tick`, `state`, `events` | Keyframes (see above). |
| `delta` | `run`, `tick`, `baseTick`, `upserts`, `removed`, `collected`, `events` | Every other broadcast. |
| `pong` | `id`, `at`, `serverTick` | Reply to `ping`. |
| `error` | `code`, `message` | See below. |

**Error codes:**

| Code | Client response |
|---|---|
| `ROOM_NOT_FOUND`, `ROOM_FULL`, `ROOM_IN_PROGRESS`, `PROTOCOL_MISMATCH`, `REPLACED`, `SERVER_FULL` | Fatal: the client stops reconnecting and shows the message. |
| `NOT_ALLOWED`, `BAD_REQUEST` | Shown as a toast. |
| `SERVER_SHUTDOWN` | The client reconnects. |

**Close codes:**

| Code | Meaning |
|---|---|
| 1000 | Normal (leave) |
| 4001 | `REPLACED` (same player joined elsewhere) |
| 4002 | `REJECTED` (join refused) |
| 4003 | `PROTOCOL` (version mismatch, or no `join` within 10 s) |
| 4004 | `ABUSE` (too many invalid messages) |
| 4005 | `SHUTDOWN` |

The client treats 4001–4004 as final.

## Trust and limits

Every client message is untrusted. `SocketGateway` (`apps/server/src/net/SocketGateway.ts`) checks each one before it reaches a room:

- **Origin:** browser upgrades whose `Origin` isn't in `ALLOWED_ORIGINS` are refused with 403 (when the list is set). Bots and other non-browser clients send no `Origin`.
- **Protocol version:** `join.protocol` must equal `PROTOCOL_VERSION`. Bump it whenever you change the wire format incompatibly, and outdated tabs will be told to reload.
- **Shape:** `parseClientMessage` validates every field's type and range and strips unknown fields. Player names are sanitized (control characters, length) and room codes normalized.
- **Size:** 8 KB per message (`ws` `maxPayload`). Binary frames are rejected.
- **Rate limits** are token buckets per connection: 30 control messages per second, and for inputs a capacity of 120 refilled at 90 per second. Each violation or invalid message is a strike, and more than 20 strikes closes the socket with 4004.
- **Liveness:** the server pings every 10 s and terminates sockets that didn't answer the previous ping. A socket that buffers more than 1 MB of unsent data is dropped instead of queuing indefinitely.
- **Game rules:** the input queue makes speed hacks pointless. Position, score and deaths are never accepted from clients.

## Wire format

`MessageCodec` in `packages/shared/src/protocol/codec.ts` is the single place messages are encoded. It is JSON by default, so traffic stays readable in DevTools (Network → WS).

Measured cost with 4 players running and jumping through level-1:

- **Deltas:** average about 385 bytes (95th percentile about 520).
- **Keyframes:** about 1.2 KB.
- **Per client:** roughly 8 KB/s downstream. Upstream, inputs are about 37 bytes, 60 times per second (≈ 2 KB/s).

To go binary (MessagePack, or bit-packing with quantized positions):

1. Implement the codec and return binary data from `encode`.
2. Pass it to `SocketGateway` and `GameClient` (both take a `codec` option).
3. Allow binary frames in `SocketGateway.onMessage`.

## Tuning (`NET_CONFIG`)

| Key | Default | Notes |
|---|---|---|
| `tickRate` | 60 | Simulation rate on server and client. All movement tuning is per second, so changing it keeps the feel. |
| `snapshotRate` | 20 | Must divide `tickRate`. Higher means smoother remote players and more bandwidth. |
| `interpolationDelayMs` | 100 | Must exceed one snapshot interval (50 ms); the rest is jitter tolerance. 100 ms copes with snapshots arriving up to about 50 ms later than the fastest ones. |
| `keyframeEverySnapshots` | 60 | Full state every 3 s. |
| `input.maxQueue` / `burstBudget` / `maxPerTick` / `stallTicks` | 30 / 6 / 3 / 15 | See [Inputs](#inputs). |
| `room.countdownMs` / `levelCompleteMs` | 3000 / 4000 | |
| `room.reconnectGraceMs` / `emptyRoomTtlMs` | 15000 / 60000 | |
| `room.minPlayersToStart` / `allowDropIn` | 1 / true | |
| `client.snapDistance` / `correctionHalfLifeMs` | 64 px / 60 ms | Prediction corrections. |
| `client.pingIntervalMs` / `reconnectAttempts` / `maxPendingInputs` | 2000 / 8 / 180 | |
| `limits.*` | 8 KB, 30 msg/s, 20 strikes, 10 s heartbeat | See [Trust and limits](#trust-and-limits). |

## Extending

- **New player state fields:**
  1. Add the field to `NetPlayerState` (`protocol/state.ts`) and to `PLAYER_FIELDS` in `protocol/delta.ts`. A compile-time check in `delta.ts` fails `typecheck` if a field is missing from `PLAYER_FIELDS`, because it would otherwise only sync in keyframes.
  2. Fill it in `toNetPlayer` (`sim/world.ts`).
  3. If prediction needs it, read it in `bodyFromNetState`.
  4. Bump `PROTOCOL_VERSION`.
- **Actions, worked example (combat):**
  - The swing itself is **predicted**: `stepPlayerBody` (`sim/actions.ts`) runs on both sides and owns the `attack`, `attackCooldown` and `hurt` timers plus `attackSeq`, a counter of swings started. Clients start the Attack animation from an increase in `attackSeq`, so a swing is never replayed after a rollback, and remote players get it from interpolated snapshots.
  - **Hits are decided by the server**, in `GameWorld.resolveAttacks` at the end of each tick: every active reach box (`attackReachBox`) is tested against other players' hitboxes, first-found hits are collected, then applied together, so two simultaneous swings trade. A hit sets the target's stun, cancels their swing and applies knockback. Per-swing hit masks and post-stun immunity are server-only and never sent.
  - The victim's client is not told about the hit separately. It sees the new `hurt` and velocity in the next snapshot and reconciles: replay from the stunned state, smoothed or snapped like any other correction.
  - `COMBAT_TUNING.playerHits = false` keeps the swing and its animation but turns hits off.
- **Moving platforms and other dynamic world objects:** put them in `GameWorld` and the world state. If players stand on them, prediction must know where they are at each tick. Make their motion a pure function of the tick, so the client can compute it without waiting for the server.
- **Enemies and projectiles:** simulate them on the server and interpolate them on clients like remote players. Hits are decided by the server.
- **More than one server process:** rooms live in memory, so a room code must always reach the same process. Use a lookup service or consistent hashing at the proxy, and keep `POST /rooms` on the instance that will host the room.
