import { CellFlag, type LevelData } from '../level/types';

/**
 * Cell flags at a tile coordinate. Columns outside the map are solid (invisible side walls),
 * rows above/below are empty so players can jump above the top and fall out of the bottom.
 */
export function cellAt(level: LevelData, col: number, row: number): number {
  if (col < 0 || col >= level.widthTiles) return CellFlag.SOLID;
  if (row < 0 || row >= level.heightTiles) return CellFlag.EMPTY;
  return level.cells[row * level.widthTiles + col] ?? CellFlag.EMPTY;
}

export function isSolidCell(level: LevelData, col: number, row: number): boolean {
  return (cellAt(level, col, row) & CellFlag.SOLID) !== 0;
}
