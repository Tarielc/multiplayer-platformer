import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TRAP_KINDS, TRAP_TUNING } from '@platformer/shared';
import { describe, expect, it } from 'vitest';
import { BOX_DEBRIS, FINISH_ART_HEIGHT, MARKER_ORIGIN, TRAP_CLIPS, TRAP_SHEET_NAMES, TRAP_SHEETS, fanFrameCount, sheetForTrap, trapFrame, type TrapClipName } from './trapArt';

const sheetFile = (path: string) => fileURLToPath(new URL(`../../../../../packages/shared/data/${path}`, import.meta.url));

/** Width and height from the PNG's IHDR header. */
function pngSize(path: string): { width: number; height: number } {
  const png = readFileSync(sheetFile(path));
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe('trap art', () => {
  it.each(TRAP_SHEET_NAMES)('%s matches its PNG on disk', (name) => {
    const sheet = TRAP_SHEETS[name];
    const { width, height } = pngSize(sheet.path);
    expect(height).toBe(sheet.rowFrames.length * sheet.frameHeight);
    if (name === 'fan') {
      // Any number of spin frames: the game counts them from the width.
      expect(width % sheet.frameWidth).toBe(0);
      expect(fanFrameCount(width)).toBeGreaterThanOrEqual(2);
    } else {
      expect(width).toBe(sheet.columns * sheet.frameWidth);
    }
    for (const frames of sheet.rowFrames) expect(frames).toBeLessThanOrEqual(sheet.columns);
  });

  it('fits every clip inside its sheet row', () => {
    for (const [clip, def] of Object.entries(TRAP_CLIPS) as Array<[TrapClipName, (typeof TRAP_CLIPS)[TrapClipName]]>) {
      const sheet = TRAP_SHEETS[def.sheet];
      expect(def.row, clip).toBeLessThan(sheet.rowFrames.length);
      expect(def.from + def.frames, clip).toBeLessThanOrEqual(sheet.rowFrames[def.row]!);
    }
    expect(trapFrame('rockHead', 2, 3)).toBe(2 * 5 + 3);
  });

  it('has a sheet for every trap kind, and debris frames for every box', () => {
    for (const kind of TRAP_KINDS) expect(TRAP_SHEETS[sheetForTrap(kind)]).toBeDefined();
    for (const variant of [1, 2, 3]) {
      const sheet = TRAP_SHEETS[sheetForTrap('box', variant)];
      expect(sheet.rowFrames[BOX_DEBRIS.row]).toBe(BOX_DEBRIS.pieces);
    }
  });

  it('stands the start, checkpoint and finish markers on the ground', () => {
    for (const name of ['start', 'checkpoint', 'finish'] as const) {
      const sheet = TRAP_SHEETS[name];
      expect(sheet.path, name).toBe(`sprites/markers/${name}.png`);
      expect(MARKER_ORIGIN[name].y, name).toBe(1); // bottom row on the ground
      expect(MARKER_ORIGIN[name].x, name).toBeGreaterThan(0);
      expect(MARKER_ORIGIN[name].x, name).toBeLessThan(1);
    }
    expect(FINISH_ART_HEIGHT).toBeLessThanOrEqual(TRAP_SHEETS.finish.frameHeight);
    // The checkpoint waves its flag after raising it; both clips come from the same sheet.
    expect(TRAP_CLIPS['checkpoint:flagOut'].loop).toBe(false);
    expect(TRAP_CLIPS['checkpoint:flagIdle'].loop).toBe(true);
  });

  it('draws each sprite over the collision body the server uses', () => {
    const inside = (name: keyof typeof TRAP_SHEETS, width: number, height: number) => {
      const s = TRAP_SHEETS[name];
      expect(s.bodyX + width, name).toBeLessThanOrEqual(s.frameWidth);
      expect(s.bodyY + height, name).toBeLessThanOrEqual(s.frameHeight);
    };
    inside('trampoline', TRAP_TUNING.trampoline.width, TRAP_TUNING.trampoline.height);
    inside('fallingPlatform', TRAP_TUNING.fallingPlatform.width, TRAP_TUNING.fallingPlatform.height);
    inside('fan', TRAP_TUNING.fan.width, TRAP_TUNING.fan.height);
    inside('rockHead', TRAP_TUNING.rockHead.size, TRAP_TUNING.rockHead.size);
    inside('spikeHead', TRAP_TUNING.spikeHead.size, TRAP_TUNING.spikeHead.size);
    for (const box of ['box1', 'box2', 'box3'] as const) inside(box, TRAP_TUNING.box.width, TRAP_TUNING.box.height);
    // The saw's body is a circle around the frame centre.
    expect(TRAP_SHEETS.saw.bodyX * 2).toBe(TRAP_SHEETS.saw.frameWidth);
    expect(TRAP_TUNING.saw.radius).toBeLessThanOrEqual(TRAP_SHEETS.saw.frameWidth / 2);
  });
});
