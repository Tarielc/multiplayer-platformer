import { CHARACTER_IDS, type CharacterId } from '@platformer/shared';
import type * as Phaser from 'phaser';
import {
  animKey,
  CHARACTER_ART,
  CHARACTER_SHEET,
  CLIP_NAMES,
  CLIPS,
  sheetFrame,
  type ClipName,
} from './characterArt';

/**
 * Makes sure the character sprite sheet texture exists. When the PNG failed to load (missing
 * file, wrong asset base), a placeholder sheet with the same grid is generated, so every
 * animation key still works and the template keeps booting with zero assets.
 *
 * Returns true when the placeholder is in use.
 */
export function ensureCharacterSheet(scene: Phaser.Scene, loadFailed: boolean): boolean {
  const { key, width, height, frameWidth, frameHeight } = CHARACTER_SHEET;
  if (scene.textures.exists(key) && !loadFailed) return false;
  if (scene.textures.exists(key)) scene.textures.remove(key);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    for (const id of CHARACTER_IDS) {
      for (const clip of CLIP_NAMES) {
        for (let i = 0; i < CLIPS[clip].frames; i++) {
          const frame = sheetFrame(id, clip, i);
          const x = (frame % CHARACTER_SHEET.columns) * frameWidth;
          const y = Math.floor(frame / CHARACTER_SHEET.columns) * frameHeight;
          drawPlaceholderFrame(ctx, x, y, id, clip, i);
        }
      }
    }
  }
  const texture = scene.textures.addCanvas(key, canvas);
  if (texture) scene.textures.addSpriteSheet('', texture, { frameWidth, frameHeight });
  return true;
}

/**
 * Registers every character × clip animation once per game (the animation manager is global,
 * so later scenes and restarts reuse them). A clip with `loopFrom` gets an `:intro` key that
 * plays the whole strip once and a `:loop` key for the looping tail; the controller chains them.
 */
export function registerCharacterAnimations(scene: Phaser.Scene): void {
  const { key } = CHARACTER_SHEET;
  for (const id of CHARACTER_IDS) {
    for (const clip of CLIP_NAMES) {
      const def = CLIPS[clip];
      const frames = (from: number) =>
        Array.from({ length: def.frames - from }, (_, i) => ({ key, frame: sheetFrame(id, clip, from + i) }));
      const timing = def.durationMs !== undefined ? { duration: def.durationMs } : { frameRate: def.frameRate ?? 10 };
      if (def.loopFrom !== undefined) {
        create(scene, animKey(id, clip, 'intro'), frames(0), timing, 0);
        const loopFrames = frames(def.loopFrom);
        create(scene, animKey(id, clip, 'loop'), loopFrames, loopTiming(def), -1);
      } else {
        create(scene, animKey(id, clip), frames(0), timing, def.loop ? -1 : 0);
      }
    }
  }
}

/** The looping tail keeps the full clip's frame rate. */
function loopTiming(def: (typeof CLIPS)[ClipName]): { frameRate: number } {
  if (def.frameRate !== undefined) return { frameRate: def.frameRate };
  return { frameRate: def.frames / ((def.durationMs ?? 1000) / 1000) };
}

function create(
  scene: Phaser.Scene,
  key: string,
  frames: Phaser.Types.Animations.AnimationFrame[],
  timing: { duration: number } | { frameRate: number },
  repeat: number,
): void {
  if (scene.anims.exists(key)) return;
  scene.anims.create({ key, frames, repeat, ...timing });
}

const hex = (color: number, alpha = 1) =>
  `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${alpha})`;

/** A readable stand-in: body blob facing right, with per-clip pose cues. */
function drawPlaceholderFrame(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  id: CharacterId,
  clip: ClipName,
  i: number,
): void {
  const { frameWidth: fw, frameHeight: fh } = CHARACTER_SHEET;
  const color = CHARACTER_ART[id].placeholderColor;
  let w = 20;
  let h = 26;
  let lift = 0;
  let alpha = 1;
  switch (clip) {
    case 'idle':
      h -= i % 4 === 0 ? 1 : 0;
      break;
    case 'run':
      lift = i % 4 === 1 || i % 4 === 2 ? 1 : 0;
      break;
    case 'jump':
      w -= 3;
      h += 2;
      break;
    case 'fall':
      w += 2;
      h -= 2;
      break;
    case 'death':
      alpha = Math.max(0, 1 - i / CLIPS.death.frames);
      h = Math.max(4, h - i * 2);
      break;
    default:
      break;
  }
  const x = ox + Math.round(fw / 2 - w / 2);
  const y = oy + fh - h - lift;
  ctx.fillStyle = hex(0x151827, alpha);
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = clip === 'hurt' && i % 2 === 0 ? hex(0xffffff, alpha) : hex(color, alpha);
  ctx.fillRect(x, y, w, h);
  // Eyes look right (sprites are flipped for facing left).
  ctx.fillStyle = hex(0xffffff, alpha);
  ctx.fillRect(x + w - 9, y + 6, 4, 5);
  ctx.fillRect(x + w - 4, y + 6, 3, 5);
  ctx.fillStyle = hex(0x151827, alpha);
  ctx.fillRect(x + w - 7, y + 8, 2, 2);
  ctx.fillRect(x + w - 3, y + 8, 2, 2);
  if (clip === 'attack' && i >= 2 && i <= 4) {
    // Slash arc in front of the body, where the real sheet draws it.
    ctx.strokeStyle = hex(0xffffff, 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ox + fw / 2 + 8, oy + fh - 14, 12 + (i - 2) * 2, -Math.PI / 2.5, Math.PI / 2.5);
    ctx.stroke();
  }
}
