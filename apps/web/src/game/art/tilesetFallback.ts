import { DEBUG_TILESET, paintDebugTileset, propertiesToRecord, type TiledTileset } from '@platformer/shared';

/**
 * Generated stand-in for a tileset image that failed to load. The built-in debug tileset is
 * re-painted pixel-exactly from the shared painter; any other tileset becomes a labelled grid
 * coloured by each tile's collision properties, so levels stay playable and readable.
 */
export function fallbackTilesetCanvas(tileset: TiledTileset): HTMLCanvasElement {
  if (tileset.name === DEBUG_TILESET.name) return debugTilesetCanvas();

  const tileW = tileset.tilewidth ?? 32;
  const tileH = tileset.tileheight ?? 32;
  const margin = tileset.margin ?? 0;
  const spacing = tileset.spacing ?? 0;
  const count = Math.max(1, tileset.tilecount ?? 1);
  const columns = Math.max(1, tileset.columns ?? Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);

  const canvas = document.createElement('canvas');
  canvas.width = tileset.imagewidth ?? margin * 2 + columns * tileW + (columns - 1) * spacing;
  canvas.height = tileset.imageheight ?? margin * 2 + rows * tileH + (rows - 1) * spacing;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const flags = new Map<number, Record<string, unknown>>();
  for (const tile of tileset.tiles ?? []) flags.set(tile.id, propertiesToRecord(tile.properties));

  ctx.font = `${Math.max(8, Math.floor(tileH / 3))}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let id = 0; id < count; id++) {
    const x = margin + (id % columns) * (tileW + spacing);
    const y = margin + Math.floor(id / columns) * (tileH + spacing);
    const props = flags.get(id) ?? {};
    const solid = props.collides === true || props.solid === true;
    ctx.fillStyle = props.hazard === true ? '#8f1d2c' : solid ? '#5b4a3a' : props.oneWay === true ? '#7a5a2e' : '#2b3150';
    ctx.fillRect(x, y, tileW, tileH);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.strokeRect(x + 0.5, y + 0.5, tileW - 1, tileH - 1);
    if (props.oneWay === true) {
      ctx.fillStyle = '#e0b050';
      ctx.fillRect(x, y, tileW, 4);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(String(id), x + tileW / 2, y + tileH / 2);
  }
  return canvas;
}

function debugTilesetCanvas(): HTMLCanvasElement {
  const image = paintDebugTileset();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return canvas;
}
