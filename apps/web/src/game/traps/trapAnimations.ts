import type * as Phaser from 'phaser';
import {
  TRAP_CLIPS,
  TRAP_SHEET_NAMES,
  TRAP_SHEETS,
  fanFrameCount,
  trapAnimKey,
  trapFrame,
  type TrapClipName,
  type TrapSheet,
  type TrapSheetName,
} from './trapArt';

/** Queues every trap sheet that isn't loaded yet (call from a scene's `preload`). */
export function queueTrapSheets(scene: Phaser.Scene, assetBase: string): void {
  for (const name of TRAP_SHEET_NAMES) {
    const { key, path, frameWidth, frameHeight } = TRAP_SHEETS[name];
    if (!scene.textures.exists(key)) scene.load.spritesheet(key, `${assetBase}/${path}`, { frameWidth, frameHeight });
  }
}

/**
 * Generates placeholder sheets (same grid) for sheets that failed to load, so every animation
 * key works without the art. Returns the sheets that use a placeholder.
 */
export function ensureTrapSheets(scene: Phaser.Scene, failedKeys: ReadonlySet<string>): TrapSheetName[] {
  const placeholders: TrapSheetName[] = [];
  for (const name of TRAP_SHEET_NAMES) {
    const sheet = TRAP_SHEETS[name];
    if (scene.textures.exists(sheet.key) && !failedKeys.has(sheet.key)) continue;
    if (scene.textures.exists(sheet.key)) scene.textures.remove(sheet.key);
    const canvas = placeholderSheet(sheet);
    const texture = scene.textures.addCanvas(sheet.key, canvas);
    if (texture) scene.textures.addSpriteSheet('', texture, { frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight });
    placeholders.push(name);
  }
  return placeholders;
}

/** Registers the trap animations once per game (the animation manager is global). */
export function registerTrapAnimations(scene: Phaser.Scene): void {
  for (const [clip, def] of Object.entries(TRAP_CLIPS) as Array<[TrapClipName, (typeof TRAP_CLIPS)[TrapClipName]]>) {
    const key = trapAnimKey(clip);
    if (scene.anims.exists(key)) continue;
    const sheet = TRAP_SHEETS[def.sheet];
    let frames: number = def.frames;
    if (def.sheet === 'fan') frames = fanFrameCount(scene.textures.get(sheet.key).getSourceImage().width) - def.from;
    scene.anims.create({
      key,
      frames: Array.from({ length: frames }, (_, i) => ({ key: sheet.key, frame: trapFrame(def.sheet, def.row, def.from + i) })),
      frameRate: def.frameRate,
      repeat: def.loop ? -1 : 0,
    });
  }
}

/** Flat-shaded stand-in frames: the body box, with a little variation per frame. */
function placeholderSheet(sheet: TrapSheet): HTMLCanvasElement {
  const { frameWidth: fw, frameHeight: fh, columns, rowFrames, placeholderColor } = sheet;
  const canvas = document.createElement('canvas');
  canvas.width = fw * columns;
  canvas.height = fh * rowFrames.length;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const hex = `#${placeholderColor.toString(16).padStart(6, '0')}`;
  rowFrames.forEach((count, row) => {
    for (let i = 0; i < count; i++) {
      const x = i * fw;
      const y = row * fh;
      ctx.fillStyle = hex;
      ctx.globalAlpha = row === 0 && i === 0 ? 1 : 0.6 + 0.4 * ((i % 2) as number);
      ctx.fillRect(x + 1, y + 1, fw - 2, fh - 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#1b1f2e';
      ctx.strokeRect(x + 1.5, y + 1.5, fw - 3, fh - 3);
      // A notch that moves with the frame, so spinning clips visibly animate.
      ctx.fillStyle = '#ffffff';
      const n = Math.max(1, count);
      ctx.fillRect(x + 2 + ((fw - 6) * i) / n, y + 2, 2, 2);
    }
  });
  return canvas;
}
