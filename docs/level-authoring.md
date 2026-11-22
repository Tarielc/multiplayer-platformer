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
| Tile size | Square (32×32 recommended) | The movement tuning is in pixels and assumes 32 px tiles. |
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
- Image layers, layer offsets and parallax factors are ignored. The parallax backdrop is procedural (`apps/web/src/game/views/Backdrop.ts`).
- Background: the map's *Background Color*, else a string map property `backgroundColor`, else the manifest's `backgroundColor`, else the default from `apps/web/src/game/config.ts`.

## Objects

Put objects on any object layer (hidden layers count too). The engine reads each object's **Class** (Tiled 1.9+; older versions call it *Type*). Without a class, it uses the object's **name**. Rotation is ignored.

| Class | Shape | Properties | Behavior |
|---|---|---|---|
| `spawn` | Point (or rect) | `slot` (int 0–3, optional) | Where a player starts. A point marks the player's **feet**, at the bottom-center of the hitbox. Put it on top of the ground, not inside it. Spawns without `slot` fill free slots in authoring order. With fewer than 4 spawns, players share them. |
| `checkpoint` | Rect, or point | – | Touching it moves the respawn point to the zone's bottom-center. A point becomes a 32×64 zone standing on the point. By default one touch moves everyone's respawn point (`checkpointScope`). |
| `exit` | Rect, or point | – | The level is complete when every present player is alive inside an exit (`exitRule: 'all'`; `'any'` means the first player to arrive wins). Disconnected players don't block it. |
| `collectible` | Point, rect or tile object | `kind` (`coin`, `gem`), `value` (int, optional) | Picked up once per level, by the first player to touch it. Its score is `value` if set, else the kind's value (coin 10, gem 50). It sits at the object's center. |
| `hazard` | Rect, or point | `style` (`lava`, optional) | Kills on any overlap with the player's hitbox. `style = "lava"` draws animated lava; anything else draws a generic danger pattern. |

Objects with any other class are kept in `LevelData.extraObjects`, with position, size and properties. The validator warns that they are ignored. That is the hook for your own entities: moving platforms, enemies, signs and so on.

To add a new collectible kind, add it to `ENTITY_CONFIG.collectibles` in `packages/shared/src/config/entities.ts`. Then add a texture whose key is the kind's name; the procedural `coin` and `gem` textures are in `apps/web/src/game/art/textures.ts`. A kind without a texture is drawn as a coin.

Map custom properties are available as `LevelData.properties`. A level's movement can be tuned in the manifest:

```ts
{ id: 'moon', name: 'Moon Base', map: 'maps/moon.json', next: null, tuning: { timeToApex: 0.6, maxRunSpeed: 180 } }
```

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
- a spawn outside the map.

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
- **The checksum check:** the server includes a checksum of its parsed level in the room info. The client parses its own copy and shows a warning if they differ, which usually means stale assets (`npm run assets:sync`). The checksum covers everything that affects gameplay (grid, spawns, zones, collectibles) and ignores decor.

## Debug tileset

`debug-tiles.png` (8×2 tiles of 32 px) is generated from `packages/shared/src/art/debugTileset.ts`. In Tiled, a tile's gid is `firstgid + id`, and the sample maps use `firstgid = 1`.

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

These come from `packages/shared/src/config` at the default tuning. Change the config and they change everywhere.

| Metric | Value |
|---|---|
| Tile | 32 px |
| Player hitbox | 20×28 px. Fits through 1-tile gaps and tunnels. |
| Full jump height | 112 px = **3.5 tiles** (a held jump peaks at exactly this height after 0.4 s). Ledges up to 3 tiles high are comfortable. |
| Short hop | Releasing jump while rising multiplies the remaining upward speed by 0.45, once. |
| Run speed | 220 px/s (≈ 6.9 tiles/s), reached in 0.1 s from standstill |
| Running jump distance | ≈ 5 tiles of horizontal travel, back to the same height. Gaps up to 4 tiles are comfortable; 5 is an expert jump. |
| Coyote time | 100 ms after walking off a ledge |
| Jump buffer | 120 ms before landing |
| Drop-through | One-way tiles are ignored for 220 ms after Down + Jump |
| Hazard tile hitbox | 4 px in from the sides, from 14 px below the tile top down to its bottom |
| Kill plane | 96 px below the bottom of the map |
| Respawn delay | 0.9 s |
| View | 960×540 px (30×17 tiles). Maps smaller than the view are centered. |

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

`npm run samples:generate` rebuilds `level-1.json`, `level-2.json` and `debug-tiles.png` from `scripts/generate-samples.ts`. It **overwrites** those maps, so after editing a sample in Tiled, either stop using the generator or copy the map to a new file first.
