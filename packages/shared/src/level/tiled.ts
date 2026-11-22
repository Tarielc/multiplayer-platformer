/**
 * Subset of the Tiled JSON map format (https://doc.mapeditor.org/en/stable/reference/json-map-format/)
 * that the level pipeline understands. Maps must be orthogonal, finite, use CSV/array
 * layer data and embedded tilesets (Phaser cannot load external .tsj/.tsx tilesets).
 */
export type TiledPropertyType = 'string' | 'int' | 'float' | 'bool' | 'color' | 'file' | 'object' | 'class';

export interface TiledProperty {
  name: string;
  type: TiledPropertyType;
  value: unknown;
  propertytype?: string;
}

export interface TiledTileDefinition {
  id: number;
  type?: string;
  class?: string;
  properties?: TiledProperty[];
}

export interface TiledTileset {
  firstgid: number;
  /** Present only for *external* tilesets, which are not supported. */
  source?: string;
  name?: string;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  tilewidth?: number;
  tileheight?: number;
  tilecount?: number;
  columns?: number;
  margin?: number;
  spacing?: number;
  tiles?: TiledTileDefinition[];
  properties?: TiledProperty[];
}

interface TiledLayerBase {
  id: number;
  name: string;
  visible: boolean;
  opacity: number;
  x?: number;
  y?: number;
  offsetx?: number;
  offsety?: number;
  properties?: TiledProperty[];
}

export interface TiledTileLayer extends TiledLayerBase {
  type: 'tilelayer';
  width: number;
  height: number;
  data?: number[] | string;
  encoding?: 'csv' | 'base64';
  compression?: string;
  chunks?: unknown[];
}

export interface TiledObject {
  id: number;
  name: string;
  /** Object class. Tiled 1.9 wrote it as `class`; 1.10+ writes `type` again. */
  type?: string;
  class?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  visible?: boolean;
  point?: boolean;
  ellipse?: boolean;
  /** Tile objects reference a gid and use a bottom-left origin. */
  gid?: number;
  properties?: TiledProperty[];
}

export interface TiledObjectGroup extends TiledLayerBase {
  type: 'objectgroup';
  objects: TiledObject[];
  draworder?: string;
}

export interface TiledGroupLayer extends TiledLayerBase {
  type: 'group';
  layers: TiledLayer[];
}

export interface TiledImageLayer extends TiledLayerBase {
  type: 'imagelayer';
  image?: string;
}

export type TiledLayer = TiledTileLayer | TiledObjectGroup | TiledGroupLayer | TiledImageLayer;

export interface TiledMap {
  type?: 'map';
  version?: string | number;
  tiledversion?: string;
  orientation: string;
  renderorder?: string;
  infinite: boolean;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  backgroundcolor?: string;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
  properties?: TiledProperty[];
  nextlayerid?: number;
  nextobjectid?: number;
  compressionlevel?: number;
}

/** Clears Tiled's flip/rotation flag bits (H, V, diagonal, hex-120) from a gid. */
export const TILED_GID_MASK = 0x0fffffff;

export function tileGid(raw: number): number {
  return raw & TILED_GID_MASK;
}

export type PropertyValue = string | number | boolean;

export function propertiesToRecord(properties: TiledProperty[] | undefined): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {};
  if (!properties) return out;
  for (const prop of properties) {
    const v = prop.value;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[prop.name] = v;
  }
  return out;
}

/** Object class from either `type` (Tiled ≥1.10, <1.9) or `class` (Tiled 1.9). */
export function objectKind(obj: TiledObject): string {
  return (obj.type || obj.class || '').trim().toLowerCase();
}

/** Depth-first flattening of group layers; visibility is inherited from parents. */
export function flattenLayers(
  layers: readonly TiledLayer[],
  parentVisible = true,
  out: Array<{ layer: Exclude<TiledLayer, TiledGroupLayer>; visible: boolean }> = [],
): Array<{ layer: Exclude<TiledLayer, TiledGroupLayer>; visible: boolean }> {
  for (const layer of layers) {
    const visible = parentVisible && layer.visible !== false;
    if (layer.type === 'group') flattenLayers(layer.layers ?? [], visible, out);
    else out.push({ layer, visible });
  }
  return out;
}
