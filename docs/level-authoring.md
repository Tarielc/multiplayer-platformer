# Level authoring

Levels are [Tiled](https://www.mapeditor.org/) JSON maps. The server and the browser both parse them with the same code (`packages/shared/src/level/parse.ts`). What you draw in Tiled is therefore exactly what the server simulates.

**To add a level:**

1. Save the map as `packages/shared/data/maps/<name>.json`.
2. Add an entry to `packages/shared/src/levels/manifest.ts`, and point the previous level's `next` at it.
3. Run `npm run levels:validate`.

## Map setup

| Setting (Tiled) | Required value | Why |
|---|---|---|
| Orientation | Orthogonal | Collision is a square grid. |
| Infinite | Off | The collision grid needs a fixed size. |
| Tile Layer Format | CSV | Base64 and compressed layers are rejected. |
| Tile size | Square (the samples use 16×16) | Movement tuning is in pixels, so the tile size changes how many tiles a jump covers, not how the game feels. See [Design metrics](#design-metrics). |
| Tilesets | Embedded in the map | Phaser cannot load external `.tsx`/`.tsj` tilesets. Use *Map → Embed Tilesets*, or tick *Embed in map* when creating one. |
| File | JSON with a `.json` extension | Tiled's default JSON extension is `.tmj`, but the manifest expects `.json`. |

Tiled stores tileset image paths relative to the map file. Keep images in `packages/shared/data/tilesets/` and maps in `packages/shared/data/maps/`, so the path is `../tilesets/<image>.png`. `npm run assets:sync` (part of `dev` and `build`) copies the whole data folder to `apps/web/public/assets/`, which the browser loads from.

If a tileset image is missing, the level still loads. The client generates a placeholder: the built-in debug tileset is repainted exactly, and any other tileset becomes a numbered grid colored by each tile's collision flags. A warning toast says which image failed.

## Collision: tile properties

Collision comes from **custom properties on tileset tiles**. Open the tileset, select tiles, and add `bool` properties:

| Property | Effect |
|---|---|
| `collides` (or `solid`) | Solid from every side. |
| `oneWay` | Solid only when landing on it from above. Players jump up through it, and **Down + Jump** drops through. |
| `hazard` | Kills on touch, but only inside an inset box (see [Design metrics](#design-metrics)), so spikes in the lower half of a tile don't kill from the side. |

Rules:

- **Every tile layer counts**, visible or hidden. A cell's flags combine all layers. Decor tiles must not carry collision properties; use separate tiles for decor.
- **Hidden layers** are not drawn but still collide.
- **A collision layer** paints solid cells with any tile you like. Name it `collision` or give it the bool property `collision = true`. Every painted cell becomes solid, unless its tile is `oneWay` or `hazard`, which keep their own behavior. Collision layers are never drawn. This lets you draw art freely on other layers and keep the collision shape separate.
- **Tile flip and rotation** flags are allowed. They change the art, not the collision.
- **The map's left and right edges are solid walls**. Above the map is open, so players can jump above the top row. Below the map is a pit: falling 96 px past the bottom kills.

## Drawing order

- Tile layers draw in Tiled's order, behind the players.
- A tile layer with the bool property `foreground = true` draws **in front of** the players. Use it for grass tufts, pillars or arches the players walk behind.
- Layer opacity is respected. Group layers are flattened, and a hidden group hides its children.
- Image layers, layer offsets and parallax factors are ignored. The world background is a seamless 64×64 tile that drifts down in an endless loop (`apps/web/src/game/views/Backdrop.ts`). Pick it per level with `background` in the manifest (`blue`, `peach`, `gray`, `green`, `pink`, `lavender` or `yellow`; images in `packages/shared/data/backgrounds/`). Add a tile by adding the PNG and its name to `BACKGROUND_TILES`.
- Background: the map's *Background Color*, else a string map property `backgroundColor`, else the manifest's `backgroundColor`, else the default from `apps/web/src/game/config.ts`.

## Objects

Put objects on any object layer (hidden layers count too). The engine reads each object's **Class** (Tiled 1.9+; older versions call it *Type*). Without a class, it uses the object's **name**. Rotation is ignored.

| Class | Shape | Properties | Behavior |
|---|---|---|---|
| `spawn` | Point (or rect) | `slot` (int 0–3, optional) | Where a player starts. A point marks the player's **feet**, at the bottom-center of the hitbox. Put it on top of the ground, not inside it. Spawns without `slot` fill free slots in authoring order. With fewer than 4 spawns, players share them. The start sign stands at the leftmost spawn, with its checkered line under the player's feet. |
| `checkpoint` | Rect, or point | – | Touching it moves the respawn point to the zone's bottom-center. A point becomes a 32×64 zone standing on the point. In co-op one touch moves everyone's respawn point; in a race only the toucher's (`checkpointScope`, set by the game mode). Drawn as a pole that raises and waves its flag once activated. |
| `exit` | Rect, or point | – | Co-op: the level is complete when every present player is alive inside an exit (`exitRule: 'all'`; `'any'` means the first player to arrive wins). Race: each arrival gets a place and leaves play, and the level ends when everyone has finished or 20 s after the first finish. Disconnected players don't block it. Drawn as a trophy that bounces whenever a player arrives. |
| `collectible` | Point, rect or tile object | `kind` (`coin`, `gem`), `value` (int, optional) | Picked up once per level, by the first player to touch it. Its score is `value` if set, else the kind's value (coin 10, gem 50). It sits at the object's center. |
| `hazard` | Rect, or point | `style` (`lava`, optional) | Kills on any overlap with the player's hitbox. `style = "lava"` draws animated lava; anything else draws a generic danger pattern. |

Trap classes (`spikes`, `saw`, `trampoline`, …) are listed under [Traps](#traps), and foes (`mushroom`, `chicken`, …) under [Foes](#foes). Objects with any other class are kept in `LevelData.extraObjects`, with position, size and properties. The validator warns that they are ignored. That is the hook for your own entities: signs, NPCs and so on.

To add a new collectible kind, add it to `ENTITY_CONFIG.collectibles` in `packages/shared/src/config/entities.ts`. Then add a texture whose key is the kind's name; the procedural `coin` and `gem` textures are in `apps/web/src/game/art/textures.ts`. A kind without a texture is drawn as a coin.

Map custom properties are available as `LevelData.properties`. A level's movement can be tuned in the manifest:

```ts
{ id: 'moon', name: 'Moon Base', map: 'maps/moon.json', next: null, tuning: { timeToApex: 0.6, maxRunSpeed: 180 } }
```

## Traps

Traps are objects too, on any object layer. Class names ignore case, spaces, `-` and `_` (`falling platform`, `rock-head` and `rockHead` all work). Each trap has a fixed body size from `packages/shared/src/config/traps.ts`, so the object only says **where** it is:

- a **point** marks the bottom-centre of the body (put it on the floor);
- a **rect** marks its top-left (its size is ignored), except for spikes, saws and fans, where the rect means something (below).

Times are in milliseconds, distances in pixels. Every property is optional.

| Class | Body | Shape | Properties | Behaviour |
|---|---|---|---|---|
| `spikes` | the strip | Rect covering whole 16 px tiles (or a point: one tile on the floor) | `dir` (`up` default, `down`, `left`, `right`: where the blades point) | Touching the blades (the 6 px band along the base, where they are drawn) costs a heart. Put solid ground behind the base. |
| `trampoline` | 24×11 (the spring's top) | Point on the floor | `launch` (px/s, default 800 ≈ 14 tiles up) | Landing on top launches you; walking into it from the side does nothing (it is one-way). |
| `saw` | circle, radius 16 | Rect = track, along its long axis through the middle; a point = a saw spinning in place (the point is its centre) | `speed` (px/s, default 90), `radius`, `phaseMs` | Ping-pongs along the track, easing at the ends. Costs a heart. It passes through terrain. |
| `fallingPlatform` | 32×10 | Point or rect | `delayMs` (default 500) | One-way. Shakes when someone lands on it, falls after `delayMs` (riders go with it), and is back 2.5 s after it disappears. |
| `fan` | 24×8 (8×24 sideways) | Point on the floor, or rect | `dir` (`up` default), `range` (px, default 112), `onMs` (2000), `offMs` (1500, `0` = always on), `phaseMs` | Blows players along `dir` in a 32 px wide stream `range` long while on. Going up, it lifts you to about the top of the stream. |
| `rockHead` | 32×32 | Point or rect | `axis` (`x` default, `y`), `dir` (first move: `right`/`down` default, or `left`/`up`), `waitMs` (900), `phaseMs` | Solid. Scans the tiles for the walls it hits on its axis, then waits, accelerates, slams into a wall, waits, and goes back. You can ride it. Pinned between it and a wall: crushed (instant death). Needs walls on its axis: map edges count horizontally, but a vertical one needs a real floor and ceiling. |
| `spikeHead` | 42×42 | Point or rect | – | Solid and static; touching any side costs a heart. |
| `box` | 20×20 | Point on the floor, or rect | `variant` (1–3: hits to break, and the art) | Solid; players can stand on it. An attack hits it (one hit per swing, 200 ms apart). On the last hit it bursts. Broken boxes stay broken for the rest of the run. |
| `button` (or `pressurePlate`) | 14×3 (the cap) | Point on the floor | `target` (required; see below), `action` (`on` default, `off`) | A pressure plate. Its cap is solid but low: players walk up onto it and off it (no jump, no fall) and stand 3 px up. Pressed while a player stands on it or a box rests on it. Pressing it switches the traps it links to on (`action = "on"`) or off (`action = "off"`). |

### Buttons

A button switches the traps it links to. Its `action` property says how:

- `on` (the default): they only work while it is pressed, and start switched off.
- `off`: they work until it is pressed, and switch off while it is held down.

A switched-off trap is greyed out and harmless. Link the traps with a property named `target` (or anything starting with `target` or `link`, for several: `target2`, `links`…):

- an **object** property (Tiled's object reference: pick the trap in the map), or
- a **string** of trap names or ids separated by commas: `trampoline1`, `trampoline1, saw2`. A name links every trap with that name.

A trap linked to several buttons works while any of its `on` buttons is pressed (or it has none) and none of its `off` buttons is. A button can link to spikes, trampolines, saws, falling platforms, fans, rock-heads and spike-heads (not boxes or other buttons). Switched off:

| Trap | Does |
|---|---|
| `trampoline` | Nothing: a one-way ledge, no launch. |
| `spikes`, `spikeHead` | No damage (a spike-head stays solid). |
| `saw`, `rockHead`, `fan` | Stops where it is, harmless (a rock-head stays solid). Pressed again, it carries on from there: these run on their own clock, which only counts while they are on. |
| `fallingPlatform` | Doesn't fall when stood on. |

When the level starts nothing is pressed, so a trap with any `on` button starts switched off and one with only `off` buttons starts on. A button that links to nothing, or names a trap that doesn't exist or can't be switched, fails the level. Players press a button by standing on it (jumping past doesn't count); a box resting on it (or placed over it) keeps it down. To start a level with a box on a button, put the box's point 3 px above the floor, on the cap. Foes don't press buttons.

Damage, knockback, invulnerability, speeds and the falling and fan timings are in `TRAP_TUNING` (`config/traps.ts`). An object that can't work fails the level with a message naming it: a rock-head with no wall on its axis or placed inside one, an unknown `dir`, `axis` or `variant`, a saw with `speed` 0, a non-number property.

Traps move as a function of the level clock, so a level is the same every time it runs. Use `phaseMs` to offset saws, fans and rock-heads that would otherwise move in step.

## Foes

Foes are objects too: class `mushroom`, `chicken`, `wasp`, `monkey`, `bull` or `rhino` (or class `foe` with a `kind` property naming one). Where it stands:

- a **point** marks the foe's feet (a wasp's: the middle of its body), so put it on the floor;
- a **rect** stands the foe on its bottom edge, centred (a wasp hovers in its middle).

| Class | Body | HP | Behaviour |
|---|---|---|---|
| `mushroom` | 18×18 | 1 | Patrols, turning at walls, drops and hazards. Touching it costs a heart. |
| `chicken` | 16×20 | 2 | Wanders; on seeing a player at about its height it squawks, chases and pecks. Harmless to touch, only the beak hurts. |
| `wasp` | 16×14 | 1 | Flies its beat, keeps its distance from a player it sees and fires stingers at them. Touching it costs a heart; it can't be stomped. |
| `monkey` | 16×22 | 2 | Clings to a wall, climbs it and throws bananas in an arc; swipes at players who come close. Off a wall, it walks, throws and punches. It can't be stomped. |
| `bull` | 34×22 | 3 | Paws the ground when it sees a player at its height, then charges; the horns hurt and knock you far. It crashes into walls and stands dazed: that's the time to hit it. Hits don't stop a charge. |
| `rhino` | 60×46 | 12 | **The boss** (see below). |

| Property | Applies to | Meaning |
|---|---|---|
| `facing` | all | `left` (default) or `right`. |
| `range` | all | Pixels it strays from where it starts before turning back (patrol, wasp beat, monkey climb). `0` = no limit. Defaults: mushroom 48, chicken 40, wasp 40, monkey 32, bull 64. |
| `wall` | monkey | `left`, `right` or `none`. By default it clings to a solid wall within a tile of it; a monkey with `wall` set but no wall there fails the level. |

Players beat foes with attacks (one hit per swing) or, for mushrooms, chickens and bulls, by landing on them (stomp: one damage and a bounce). An attack also knocks a stinger or banana out of the air. Ninja Frog's tongue catches any foe; spat out, it flies until it hits something, and both it and whatever it hits take a hit (a spat player or box hurts the foes it hits too). The drone's claw picks foes up and drops them, into lava for instance. A caught foe can't act or hurt anyone. Beating a foe scores 10–30 (the rhino: 200). Foes sleep until a player is within 600×400 px (a woken boss never does), collide with the tiles only (they pass through traps and players), and avoid hazards, spikes and spike-heads; they die in them if pushed in.

### The rhino boss

The rhino sleeps until a player comes within 320 px of it in plain sight (or hits it), roars, and from then on fights anywhere in the level. It walks at the nearest player and swipes its horn at anyone right in front of it. Every second or two it either charges, if its target is about level with it and at least 6 tiles away, or stomps.

- **Charge:** it charges until it hits a wall. The crash shakes rocks loose from the ceiling (a short warning first), one over each player and a few more around the floor. Then it stands dazed for about 3 seconds.
- **Stomp:** a shockwave runs along the floor both ways until it meets a wall or a ledge; jump it. Anyone up on a ledge gets a rock over their head instead.

It is armoured: swings, stomps and spat things only hurt it while it is dazed. Otherwise they glance off, though you still bounce off its back. At half health it flies into a rage: it walks and charges faster, drops more rocks, and stays dazed for less time. Tongues and claws can't catch it.

While a boss is alive, **the level's exit stays shut** (players in it don't count). Give it a closed hall: walls either side for it to crash into, a solid ceiling for the rocks, and one-way ledges low enough to jump onto, to dodge its charges. Level 8, *Rhino's Den*, is the example. The level solver (`npm run levels:solve`) leaves the foes out of levels with a boss, so it only checks the layout.

Sizes, speeds, sight, timings and damage are in `FOE_TUNING` (`packages/shared/src/config/foes.ts`). Foes run on the server only; clients draw them from snapshots, like the other players. The sprites are in `packages/shared/data/sprites/foes/`.

## Validation

`npm run levels:validate` parses every level in the manifest and prints each problem, with a hint on how to fix it. The server runs the same checks at startup and refuses to start on errors.

**Errors** (the level can't load):

- infinite map;
- non-orthogonal map;
- non-square tiles;
- Base64 or compressed layer data;
- external tileset;
- wrong layer size;
- no spawn point;
- a spawn outside the map;
- a trap that can't work (see [Traps](#traps)).

**Warnings** (the level loads):

- fewer than 4 spawns;
- no exit (only dev *Skip level* can finish the level);
- a spawn inside a solid tile;
- objects that extend outside the map;
- objects with unknown classes.

## Editing workflow

While `npm run dev` is running:

- **Saving a map** reloads it on the server, which watches `DATA_DIR`. The next level start uses the new version; a level already in progress keeps its copy. The asset watcher copies the file to the web app. The client loads maps with the server's checksum in the URL, so browsers never use a stale cached copy.
- **To restart a level after a map change**, use *Skip level* in the pause menu, or ready up again from the lobby.
- **Editing `manifest.ts`** or any shared TypeScript restarts the game server. Rooms live in memory, so clients reconnect automatically and the room is recreated under the same code.
- **The checksum check:** the server includes a checksum of its parsed level in the room info. The client parses its own copy and shows a warning if they differ, which usually means stale assets (`npm run assets:sync`). The checksum covers everything that affects gameplay (grid, spawns, zones, collectibles, traps) and ignores decor.

## Terrain tileset

The sample levels use `terrain-tileset.png`: 16×16 tiles on a 22×11 grid, with empty tiles between the sets. Its Tiled definition (collision properties included) comes from `terrainTilesetDefinition()` in `packages/shared/src/dev/terrainTileset.ts`. Every tile is `collides` except the one-way platforms, which are `oneWay`.

| Kind | Sets | Layout |
|---|---|---|
| Walls (hollow frames) | stone, wood, jade (cols 0–4) | 3×3 corners, edges and dark center, plus a 2×2 of inner corners to the right |
| Ground | grass, autumn, candy (cols 6–10) | 3×3 with the grass/top edge, plus 2×2 inner "overhang" corners |
| Brick | brick (cols 17–21, rows 4–6) | 3×3 plus 2×2 inner corners |
| Blocks | bronze, steel, copper (cols 12–15), gold (cols 17–20, rows 8–10) | 3×1 beam, 1×3 pillar, 1×1 block, 2×2 block |
| One-way platforms | gold, wood, metal (cols 17–19, rows 0–2) | left end, middle, right end; the plank is the top 5 px of the tile |

The rows are 0–2, 4–6 and 8–10 for the three sets of each column group. The tile `type` (Tiled's class) is the set name, for example `grass` or `steelBlock`.

**Auto-tiling.** In Tiled, paint these tiles by hand or with your own terrain set. The sample generator picks them automatically from neighbors:

- **Walls, ground, brick:** an exposed side picks the matching edge or corner of the 3×3. A fully enclosed cell next to an empty diagonal picks the inner corner pointing at it. Different materials count as different regions, and cells beyond the map edge count as the same material, so regions run cleanly off the map. Keep regions at least 2 tiles thick: 1-tile strips have no proper tile, and the generator rejects them.
- **Blocks:** 1×1 is the small block, a 1-tall run is a beam (end caps and a repeated middle), a 1-wide run is a pillar, and larger even-sized rectangles repeat the 2×2 block. Blocks of the same material must not touch, or they merge into one shape.
- **Platforms:** end caps and a repeated middle, at least 2 tiles long.

## Debug tileset

`debug-tiles.png` (8×2 tiles of 32 px) is generated from `packages/shared/src/art/debugTileset.ts`. It is the default for `asciiToTiledMap` (unit tests and quick sketches). In Tiled, a tile's gid is `firstgid + id`, and maps made with it use `firstgid = 1`.

| id | tile | properties | id | tile | properties |
|---|---|---|---|---|---|
| 0 | grass (top) | collides | 8 | lava | hazard |
| 1 | dirt | collides | 9 | crate | collides |
| 2 | brick | collides | 10 | ice | collides |
| 3 | plank | oneWay | 11 | stone | collides |
| 4 | spikes | hazard | 12 | water | decor |
| 5 | grass tuft | decor | 13 | cloud | decor |
| 6 | flower | decor | 14 | sign | decor |
| 7 | background brick | decor | 15 | missing (checker) | decor |

Ice and water look different but have no special physics. Adding behavior means a new tile flag plus a rule in `packages/shared/src/sim`.

## Design metrics

These come from `packages/shared/src/config` at the default tuning. Change the config and they change everywhere. Tile counts are given for 16 px tiles (the terrain tileset), with 32 px tiles in parentheses.

| Metric | Value |
|---|---|
| Player hitbox | 20×28 px. Needs 2×2 tiles of clearance (1×1 at 32 px). |
| Full jump height | 112 px = **7 tiles** (3.5) (a held jump peaks at exactly this height after 0.4 s). Ledges up to 96 px (6 tiles) high are comfortable. |
| Short hop | Releasing jump while rising multiplies the remaining upward speed by 0.45, once. |
| Double jump | One extra jump in mid-air (`airJumps`) that rises 80 px = **5 tiles** (2.5) from wherever it starts. Jumping again at the apex reaches 192 px = **12 tiles** (6). Landing (boxes included) and trampolines give it back. |
| Run speed | 220 px/s (≈ 13.8 tiles/s, or 6.9), reached in 0.1 s from standstill |
| Running jump distance | ≈ 160 px = 10 tiles (5) of horizontal travel, back to the same height. Gaps up to 128 px (8 tiles) are comfortable; 160 px is an expert jump. With the double jump: ≈ 260 px = 16 tiles (8). |
| Coyote time | 100 ms after walking off a ledge (after that, a press spends the air jump) |
| Jump buffer | 120 ms before landing, once the air jump is spent |
| Drop-through | One-way tiles are ignored for 220 ms after Down + Jump |
| Hazard tile hitbox | 4 px in from the sides, from 14 px below the tile top down to its bottom (`hazardTileHitbox`, tuned for 32 px spike tiles; the terrain tileset has no hazard tiles, so the samples use lava zones) |
| Kill plane | 96 px below the bottom of the map |
| Fall damage | Drops of more than 256 px = 16 tiles (8) cost a heart, plus one for every further 128 px = 8 tiles (4); 32 tiles (16) or more is fatal. Measured from the top of the airtime, and a double jump, trampoline or stomp on the way down resets it. Keep required drops within 16 tiles, or give players a trampoline or a ledge to break the fall. Foes are hurt past 8 tiles and boxes past 6, a box falling 2 tiles or more onto a player, foe or box hurts it, and so does a foe falling that far onto another foe (`FALL_DAMAGE_TUNING`). |
| Respawn delay | 5 s, 10 s, 20 s, then 30 s for each further death in the level; always 5 s when playing alone |
| View | 960×540 px = 60×34 tiles (30×17). Maps smaller than the view are centered. |

A spot meant to be reachable only with a trampoline or a fan has to be out of double-jump reach (more than 12 tiles up, or 16 across). Otherwise, set `tuning: { airJumps: 0 }` on the level in the manifest to turn the double jump off there.

## Prototyping with ASCII

`@platformer/shared/dev` turns ASCII sketches into valid Tiled maps. The samples and the unit tests use it, and you can use it to block out a layout before opening Tiled:

```ts
import { asciiToTiledMap } from '@platformer/shared/dev';

const map = asciiToTiledMap({
  rows: [
    '                    ',
    '   o o     ---      ',
    ' 1 2 3 4         E  ',
    '########^^#####LL###',
  ],
});
// JSON.stringify(map) and save it to packages/shared/data/maps/, then open it in Tiled.
```

| Char | Meaning | Char | Meaning |
|---|---|---|---|
| `#` | ground (grass on top, dirt below) | `1`–`4` | spawn for slot 0–3 (feet at the cell bottom) |
| `=` `B` `S` `X` `I` | dirt, brick, stone, crate, ice | `o` `g` | coin, gem |
| `-` | one-way plank | `C` | checkpoint (1×2 tiles, standing on the cell bottom) |
| `^` | spikes (hazard tile) | `E` | exit (1×2 tiles) |
| `,` `*` `>` `w` `c` | decor: tuft, flower, sign, background brick, cloud | `L` | lava hazard zone (a horizontal run becomes one zone) |
| space or `.` | empty | | |

You can extend or override the legend with `legend: { … }`. `asciiToLevel()` returns parsed `LevelData` directly, which is handy in tests.

For the terrain tileset, pass its legend, tileset and tile size. Every material is auto-tiled (see [Terrain tileset](#terrain-tileset)):

```ts
import { TERRAIN_ASCII_LEGEND, asciiToTiledMap, terrainTilesetDefinition } from '@platformer/shared/dev';

const map = asciiToTiledMap({
  rows: [
    '                        ',
    '                        ',
    '             ~~~~       ',
    '  o o                   ',
    ' 1 2 3 4   mm        E  ',
    '###########mm####LL#####',
    '########################',
  ],
  baseLegend: TERRAIN_ASCII_LEGEND,
  tileset: terrainTilesetDefinition(1),
  tileSize: 16,
});
```

| Char | Set | Char | Set |
|---|---|---|---|
| `#` `%` `&` | grass, autumn, candy ground | `x` `m` `k` `Y` | bronze, steel, copper, gold blocks |
| `S` `W` `J` | stone, wood, jade walls | `-` `=` `~` | wood, metal, gold one-way platforms |
| `B` | brick | `^` | spikes pointing up (a horizontal run becomes one strip) |

Objects use the same characters as the default legend. Checkpoints and exits are 2×4 tiles (32×64 px) and lava (`L`) zones are 2 tiles tall, rising from the bottom of the cell, so their pixel sizes match the 32 px legend.

Other traps can be passed to `asciiToTiledMap` as `objects: [{ name, type: 'saw', x, y, width, height, properties }]` (in pixels).

`npm run samples:generate` rebuilds `level-1.json` … `level-3.json` (and `debug-tiles.png`) from `scripts/generate-samples.ts`. There, layouts are written with a small `Sketch` API (`ground`, `solid`, `block`, `platform`, `text`) that throws on shapes the tileset can't draw. Traps are placed in tile coordinates and checked against the layout (no overlaps, a floor under boxes, trampolines and fans, solid ground behind spikes):

```ts
s.spikes(30, 23, 3);                      // 3 tiles of spikes on the floor, from column 30
s.saw(36, 18, 41, 18, { speed: 60 });     // a saw between the centres of two tiles
s.trampoline(53, 23).fan(82, 23, { range: 9 });   // on the floor under cells (x, y) and (x+1, y); range in tiles
s.fallingPlatform(50, 23).box(128, 17, 3);
s.rockHead(141, 16, 'x').spikeHead(91, 15);       // 2×2 cells / centred in 3×3 cells
```

It **overwrites** those maps, so after editing a sample in Tiled, either stop using the generator or copy the map to a new file first.

### Is it finishable?

`npm run levels:solve` checks that one player can reach the exit of every level without losing a heart. It searches over moves (runs, jumps of different heights and steering, double jumps, waits, attacks) in the real simulation, traps and timing included, and prints the route with `--verbose`:

```
level-3 "Sunset Ruins" (14 traps)
  ✓ finished in 16 moves, 17.0 s of play, 0 hearts lost (21 nodes, 324 states, 0.3s)
```

When it fails it reports how close it got and what ended the branches (`trap hit`, `death (hazard)`, `death (crush)`…). Optional areas (bonus coins up a trampoline, a box-blocked nook) are not checked. Use `--level <id>` for one level.
