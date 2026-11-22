import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHARACTER_IDS, COMBAT_TUNING, PLAYER_CONFIG } from '@platformer/shared';
import { describe, expect, it } from 'vitest';
import { animKey, CHARACTER_ART, CHARACTER_SHEET, CLIP_NAMES, CLIPS, clipDurationMs, sheetFrame } from './characterArt';

const SHEET_FILE = fileURLToPath(new URL(`../../../../../packages/shared/data/${CHARACTER_SHEET.path}`, import.meta.url));

describe('character art', () => {
  it('matches the PNG on disk (size from the IHDR header)', () => {
    const png = readFileSync(SHEET_FILE);
    expect(png.readUInt32BE(16)).toBe(CHARACTER_SHEET.width);
    expect(png.readUInt32BE(20)).toBe(CHARACTER_SHEET.height);
    expect(CHARACTER_SHEET.width).toBe(CHARACTER_SHEET.columns * CHARACTER_SHEET.frameWidth);
    expect(CHARACTER_SHEET.height).toBe(
      CHARACTER_IDS.length * CHARACTER_SHEET.rowsPerCharacter * CHARACTER_SHEET.frameHeight,
    );
  });

  it('gives every character a distinct block and every clip a distinct row that fits the sheet', () => {
    const blocks = CHARACTER_IDS.map((id) => CHARACTER_ART[id].block);
    expect(new Set(blocks).size).toBe(CHARACTER_IDS.length);
    const rows = CLIP_NAMES.map((clip) => CLIPS[clip].row);
    expect(new Set(rows).size).toBe(CLIP_NAMES.length);
    const lastFrame = (CHARACTER_SHEET.width / CHARACTER_SHEET.frameWidth) * (CHARACTER_SHEET.height / CHARACTER_SHEET.frameHeight);
    for (const id of CHARACTER_IDS) {
      for (const clip of CLIP_NAMES) {
        const def = CLIPS[clip];
        expect(def.row).toBeLessThan(CHARACTER_SHEET.rowsPerCharacter);
        expect(def.frames).toBeLessThanOrEqual(CHARACTER_SHEET.columns);
        expect(sheetFrame(id, clip, def.frames - 1)).toBeLessThan(lastFrame);
      }
    }
    expect(sheetFrame('ninja-frog', 'idle', 0)).toBe(3 * 7 * 11);
    expect(animKey('mask-dude', 'fall', 'loop')).toBe('mask-dude:fall:loop');
  });

  it('times gameplay clips from the combat tuning', () => {
    expect(clipDurationMs('attack')).toBe(COMBAT_TUNING.attack.durationMs);
    expect(clipDurationMs('hurt')).toBe(COMBAT_TUNING.hurt.stunMs);
    // The slash is drawn on frames 2-4; the hit window must overlap them.
    const frameMs = COMBAT_TUNING.attack.durationMs / CLIPS.attack.frames;
    expect(COMBAT_TUNING.attack.activeFromMs).toBeLessThan(5 * frameMs);
    expect(COMBAT_TUNING.attack.activeToMs).toBeGreaterThan(2 * frameMs);
  });

  it('finishes the death clip before the respawn', () => {
    expect(clipDurationMs('death')).toBeLessThanOrEqual(PLAYER_CONFIG.respawnDelayMs - 100);
  });

  it('only declares frame events on existing frames', () => {
    for (const clip of CLIP_NAMES) {
      for (const frame of Object.keys(CLIPS[clip].frameEvents ?? {})) {
        expect(Number(frame)).toBeLessThan(CLIPS[clip].frames);
      }
      const loopFrom = CLIPS[clip].loopFrom;
      if (loopFrom !== undefined) expect(loopFrom).toBeLessThan(CLIPS[clip].frames);
    }
  });
});
